/// <reference types="@cloudflare/workers-types" />

// Pitch-agent Worker (DMZ). Serves POST /api/chat and POST /api/lead for the public
// "AI Dylan" recruiter chatbot. Isolated from the portfolio Worker: it never holds the
// GITHUB_TOKEN, talks to Postgres only through the least-privilege pitch_runtime role
// (via Hyperdrive), and routes all inference through AI Gateway (rate limit + spend cap).
//
// Controls (see plan): data minimization (KB-only context), strict instruction/data
// separation + canary, retrieval-threshold gate (no relevant KB => no LLM), output leak
// filter, Turnstile on leads, and `no-store` on EVERY response.

import { Client } from "pg";
import {
  validateUserMessage,
  scanForInjection,
  buildMessages,
  scanOutput,
  REFUSAL_OFFTOPIC,
  SAFE_FALLBACK,
} from "../src/lib/chat-guard";
import facts from "../kb/facts.json";

export interface Env {
  AI: Ai;
  HYPERDRIVE: Hyperdrive;
  TURNSTILE_SECRET: string;
  IP_HMAC_KEY: string;
  AI_GATEWAY_ID: string;
  DISCORD_ALERT_WEBHOOK: string; // detection cron alert sink (secret); empty/unset = no alerts
}

const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
const GEN_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const GUARD_MODEL = "@cf/meta/llama-guard-3-8b";
const TOP_K = 5;
const SIM_THRESHOLD = 0.35;
const MAX_TOKENS = 450;
const TEMPERATURE = 0.3;

const FACTS = facts.facts as Record<string, { answer: string; route_to?: string }>;

// --- responses: no-store on every success AND error (never reuse the telemetry json()) ---
function noStore(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// All inference goes through AI Gateway (its model-name overloads are awkward to type, so the
// binding is called loosely here; the response shapes are validated at the call sites).
async function aiRun(env: Env, model: string, input: Record<string, unknown>): Promise<any> {
  return (env.AI as unknown as { run: (m: string, i: unknown, o: unknown) => Promise<unknown> }).run(model, input, {
    gateway: { id: env.AI_GATEWAY_ID },
  });
}

// Keyed HMAC of the client IP (truncated). Never store a raw IP; rotate IP_HMAC_KEY periodically.
async function hmacIp(ip: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(ip));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function verifyTurnstile(token: string, ip: string | null, secret: string): Promise<boolean> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

// Reputation-sensitive intents are answered deterministically from kb/facts.json (no LLM),
// so the bot never improvises on availability / contact / visa / compensation.
function detectFactIntent(msg: string): string | null {
  const m = msg.toLowerCase();
  if (/\b(visa|sponsor|sponsorship|citizen|work authorization)\b/.test(m)) return "work_authorization";
  if (/\b(salary|compensation|comp|pay|day rate|how much)\b/.test(m)) return "compensation";
  if (/\b(contact|reach him|reach dylan|get in touch|email him)\b/.test(m)) return "contact";
  if (/\b(available|availability|open to|start date|when can he start|hiring)\b/.test(m)) return "availability";
  return null;
}

// Llama Guard content classifier, run ONLY when the regex pre-filter already flagged the input
// (bounds latency/cost). Fail-open: a classifier error must not break the chat, since the
// retrieval gate + output filter are the real backstops.
async function llamaGuard(env: Env, msg: string): Promise<string> {
  try {
    const r = await aiRun(env, GUARD_MODEL, { messages: [{ role: "user", content: msg }] });
    const text = String(r?.response ?? "").trim().toLowerCase();
    if (text.startsWith("unsafe")) {
      const cat = text.split(/\s+/).slice(1).join(",").slice(0, 40);
      return cat ? `unsafe:${cat}` : "unsafe";
    }
    return "safe";
  } catch {
    return "safe";
  }
}

interface RetrievedChunk {
  id: number;
  chunk_text: string;
  sim: number;
}

async function retrieve(env: Env, vector: number[]): Promise<RetrievedChunk[]> {
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT id, chunk_text, 1 - (embedding <=> $1::vector) AS sim
       FROM approved_kb
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [`[${vector.join(",")}]`, TOP_K],
    );
    return rows.map((r: { id: number; chunk_text: string; sim: string }) => ({
      id: Number(r.id),
      chunk_text: r.chunk_text,
      sim: Number(r.sim),
    }));
  } finally {
    await client.end().catch(() => {});
  }
}

interface TurnLog {
  conversationId: string;
  ipHmac: string | null;
  intent: string | null;
  userMsg: string;
  answer: string;
  flagged: boolean;
  refused: boolean;
  guardVerdict: string;
  canaryHit: boolean;
  model: string;
  retrievedIds: number[] | null;
  promptTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

// Best-effort logging (called via ctx.waitUntil for chat; the conversation UUID is generated
// up front so we never depend on a RETURNING value for the response).
async function logTurn(env: Env, t: TurnLog): Promise<void> {
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  try {
    await client.connect();
    await client.query("INSERT INTO conversations (id, ip_hmac, intent) VALUES ($1,$2,$3)", [
      t.conversationId,
      t.ipHmac,
      t.intent,
    ]);
    await client.query(
      "INSERT INTO messages (conversation_id, role, content, flagged, guard_verdict) VALUES ($1,'user',$2,$3,$4)",
      [t.conversationId, t.userMsg, t.flagged, t.guardVerdict],
    );
    await client.query(
      `INSERT INTO messages
         (conversation_id, role, content, retrieved_ids, refused, canary_hit, model, prompt_tokens, output_tokens, latency_ms)
       VALUES ($1,'assistant',$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        t.conversationId,
        t.answer,
        t.retrievedIds,
        t.refused,
        t.canaryHit,
        t.model,
        t.promptTokens,
        t.outputTokens,
        t.latencyMs,
      ],
    );
  } finally {
    await client.end().catch(() => {});
  }
}

async function chat(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const start = Date.now();
  let body: { message?: unknown };
  try {
    body = (await request.json()) as { message?: unknown };
  } catch {
    return noStore({ error: "invalid json" }, 400);
  }

  const v = validateUserMessage(body.message);
  if (!v.ok) return noStore({ error: v.error }, 400);
  const userMsg = v.value;

  const ip = request.headers.get("CF-Connecting-IP");
  const ipHmac = ip ? await hmacIp(ip, env.IP_HMAC_KEY) : null;
  const conversationId = crypto.randomUUID();

  const inj = scanForInjection(userMsg);
  const guardVerdict = inj.flagged ? await llamaGuard(env, userMsg) : "safe";

  // 1) Deterministic reputation-sensitive intents -> facts.json verbatim, no LLM.
  const intent = detectFactIntent(userMsg);
  if (intent && FACTS[intent]) {
    const answer = FACTS[intent].answer;
    ctx.waitUntil(
      logTurn(env, mkLog({ conversationId, ipHmac, intent, userMsg, answer, flagged: inj.flagged, refused: false, guardVerdict, model: "deterministic", latencyMs: Date.now() - start })),
    );
    return noStore({ answer, conversationId, refused: false, blocked: false });
  }

  // 2) Unsafe input (classifier) -> refuse before generating.
  if (guardVerdict.startsWith("unsafe")) {
    ctx.waitUntil(
      logTurn(env, mkLog({ conversationId, ipHmac, intent: null, userMsg, answer: SAFE_FALLBACK, flagged: true, refused: true, guardVerdict, model: "refused", latencyMs: Date.now() - start })),
    );
    return noStore({ answer: SAFE_FALLBACK, conversationId, refused: true, blocked: true });
  }

  // 3) Embed + retrieve.
  let chunks: RetrievedChunk[];
  try {
    const emb = await aiRun(env, EMBED_MODEL, { text: [userMsg] });
    const vector = emb?.data?.[0] as number[] | undefined;
    if (!Array.isArray(vector)) throw new Error("embed failed");
    chunks = (await retrieve(env, vector)).filter((c) => c.sim >= SIM_THRESHOLD);
  } catch {
    ctx.waitUntil(
      logTurn(env, mkLog({ conversationId, ipHmac, intent: null, userMsg, answer: "(error)", flagged: inj.flagged, refused: true, guardVerdict, model: "error", latencyMs: Date.now() - start })),
    );
    return noStore({ error: "temporarily unavailable" }, 503);
  }

  // 4) Retrieval gate: nothing relevant -> canned refusal, NO generation (no hallucination surface).
  if (chunks.length === 0) {
    ctx.waitUntil(
      logTurn(env, mkLog({ conversationId, ipHmac, intent: null, userMsg, answer: REFUSAL_OFFTOPIC, flagged: inj.flagged, refused: true, guardVerdict, model: "refused", latencyMs: Date.now() - start })),
    );
    return noStore({ answer: REFUSAL_OFFTOPIC, conversationId, refused: true, blocked: false });
  }

  // 5) Generate from context only, with a per-request canary.
  const canary = "CANARY-" + crypto.randomUUID();
  const messages = buildMessages({ canary, contextChunks: chunks.map((c) => c.chunk_text), question: userMsg });
  let raw: string;
  let promptTokens: number | null = null;
  let outputTokens: number | null = null;
  try {
    const gen = await aiRun(env, GEN_MODEL, { messages, max_tokens: MAX_TOKENS, temperature: TEMPERATURE });
    raw = String(gen?.response ?? "");
    promptTokens = typeof gen?.usage?.prompt_tokens === "number" ? gen.usage.prompt_tokens : null;
    outputTokens = typeof gen?.usage?.completion_tokens === "number" ? gen.usage.completion_tokens : null;
  } catch {
    ctx.waitUntil(
      logTurn(env, mkLog({ conversationId, ipHmac, intent: null, userMsg, answer: "(error)", flagged: inj.flagged, refused: true, guardVerdict, model: "error", latencyMs: Date.now() - start })),
    );
    return noStore({ error: "temporarily unavailable" }, 503);
  }

  // 6) Output leak filter (canary first, then the chat-output denylist).
  const out = scanOutput(raw, canary);
  ctx.waitUntil(
    logTurn(env, {
      conversationId,
      ipHmac,
      intent: null,
      userMsg,
      answer: out.text,
      flagged: inj.flagged,
      refused: !out.safe,
      guardVerdict,
      canaryHit: out.canaryHit,
      model: GEN_MODEL,
      retrievedIds: chunks.map((c) => c.id),
      promptTokens,
      outputTokens,
      latencyMs: Date.now() - start,
    }),
  );
  return noStore({ answer: out.text, conversationId, refused: !out.safe, blocked: out.reason === "canary" });
}

// Small helper to fill TurnLog defaults for the no-generation paths.
function mkLog(p: {
  conversationId: string;
  ipHmac: string | null;
  intent: string | null;
  userMsg: string;
  answer: string;
  flagged: boolean;
  refused: boolean;
  guardVerdict: string;
  model: string;
  latencyMs: number;
}): TurnLog {
  return {
    ...p,
    canaryHit: false,
    retrievedIds: null,
    promptTokens: null,
    outputTokens: null,
  };
}

// Best-effort Discord notification on a new lead (reuses DISCORD_ALERT_WEBHOOK → #pitch-alerts).
// Never throws — a failed ping must not affect the already-saved lead. Sent as an embed (embeds
// don't trigger @mentions) with allowed_mentions locked down as belt-and-suspenders against a
// lead body containing @everyone/@here.
async function notifyLead(
  env: Env,
  lead: { name: string | null; email: string | null; company: string | null; role: string | null; message: string | null },
): Promise<void> {
  if (!env.DISCORD_ALERT_WEBHOOK) return;
  const f = (name: string, v: string | null, inline = true) => ({ name, value: (v ?? "—").slice(0, 1024) || "—", inline });
  await fetch(env.DISCORD_ALERT_WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: "📬 New lead via AI Dylan",
          color: 0x5ee892,
          fields: [
            f("Name", lead.name),
            f("Email", lead.email),
            f("Company", lead.company),
            f("Role", lead.role),
            f("Message", lead.message, false),
          ],
        },
      ],
      allowed_mentions: { parse: [] },
    }),
  }).catch(() => {});
}

async function lead(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return noStore({ error: "invalid json" }, 400);
  }

  const token = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
  const ip = request.headers.get("CF-Connecting-IP");
  if (!token || !(await verifyTurnstile(token, ip, env.TURNSTILE_SECRET))) {
    return noStore({ error: "verification failed" }, 403);
  }

  const s = (x: unknown, max: number): string | null =>
    typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null;
  const name = s(body.name, 120);
  const email = s(body.email, 200);
  const company = s(body.company, 160);
  const role = s(body.role, 160);
  const message = s(body.message, 2000);

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return noStore({ error: "invalid email" }, 400);
  if (!message && !email) return noStore({ error: "message or email required" }, 400);

  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  try {
    await client.connect();
    // Awaited (never ctx.waitUntil): a lead must not be lost.
    await client.query("INSERT INTO leads (name, email, company, role_title, message) VALUES ($1,$2,$3,$4,$5)", [
      name,
      email,
      company,
      role,
      message,
    ]);
  } catch (e) {
    console.error("lead insert failed:", e instanceof Error ? e.message : String(e));
    return noStore({ error: "could not save" }, 503);
  } finally {
    await client.end().catch(() => {});
  }
  // Real-time notification (best-effort, post-response): ping #pitch-alerts so a lead is never missed.
  ctx.waitUntil(notifyLead(env, { name, email, company, role, message }));
  return noStore({ ok: true });
}

// --- detection cron: scheduled anomaly alert + retention purge ---------------------------
// The per-request Llama Guard + canary checks are the real-time backstop; this is the
// after-the-fact alarm. Runs every 30 min (see wrangler.pitch.jsonc) over a 60-min window,
// so the windows overlap and a spike between runs is never missed (may double-alert — fine).
const ANOMALY_WINDOW_MIN = 60;
const FLAGGED_COUNT_ALERT = 10; // ≥ this many jailbreak-flagged inputs in the window
const REFUSED_RATE_ALERT = 0.5; // refusal fraction that trips an alert...
const REFUSED_MIN_VOLUME = 20; // ...but only once there's enough volume to be meaningful

interface AnomalyStats {
  flagged: number;
  refused: number;
  canary: number;
  total: number;
}

async function anomalyScan(env: Env): Promise<void> {
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  let stats: AnomalyStats;
  try {
    await client.connect();
    const { rows } = await client.query(
      "SELECT flagged, refused, canary, total FROM recent_anomaly_stats($1)",
      [ANOMALY_WINDOW_MIN],
    );
    const r = (rows[0] ?? {}) as { flagged?: string; refused?: string; canary?: string; total?: string };
    stats = { flagged: Number(r.flagged ?? 0), refused: Number(r.refused ?? 0), canary: Number(r.canary ?? 0), total: Number(r.total ?? 0) };
    // Retention purge on the same connection (90d conversations w/ cascade, 180d leads).
    // Best-effort: a purge error must NOT suppress the anomaly alert below (esp. the canary
    // signal), which is already fully computed from `stats`.
    await client.query("SELECT purge_expired()").catch(() => {});
  } finally {
    await client.end().catch(() => {});
  }

  const reasons: string[] = [];
  if (stats.canary > 0) reasons.push(`canary leaked in ${stats.canary} response(s) — system-prompt extraction attempt`);
  if (stats.flagged >= FLAGGED_COUNT_ALERT) reasons.push(`${stats.flagged} jailbreak-flagged inputs`);
  if (stats.total >= REFUSED_MIN_VOLUME && stats.refused / stats.total >= REFUSED_RATE_ALERT) {
    reasons.push(`high refusal rate: ${stats.refused}/${stats.total} turns`);
  }
  if (reasons.length === 0 || !env.DISCORD_ALERT_WEBHOOK) return;

  const content =
    `**pitch-agent anomaly** (last ${ANOMALY_WINDOW_MIN}m)\n` +
    reasons.map((x) => `• ${x}`).join("\n") +
    `\ntotals — flagged ${stats.flagged}, refused ${stats.refused}, canary ${stats.canary}, turns ${stats.total}`;
  await fetch(env.DISCORD_ALERT_WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  }).catch(() => {});
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/chat") return chat(request, env, ctx);
    if (request.method === "POST" && url.pathname === "/api/lead") return lead(request, env, ctx);
    return noStore({ error: "not found" }, 404);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(anomalyScan(env));
  },
};

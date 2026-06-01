/// <reference types="@cloudflare/workers-types" />

// Standalone Cloudflare Worker entry (Workers Static Assets).
// - Static asset paths are served directly by the platform (free, no Worker invocation).
// - Only unmatched paths reach here; we handle /api/telemetry.json and fall through to ASSETS.
//
// §8 boundary lives HERE, server-side: the raw GitHub response is fetched, mapped, and denylist-
// filtered on the server. The browser only ever receives already-sanitized JSON — no token, no raw
// event bytes, no api.github.com call from the client.
import { mapGitHubEvents, isForbidden, type FeedEvent } from '../src/lib/telemetry';
import seed from '../src/content/telemetry_seed.json';

export interface Env {
  ASSETS: Fetcher;
  GITHUB_TOKEN?: string; // optional public-read PAT (Cloudflare secret); never reaches the client
}

const CACHE = 'public, max-age=300, s-maxage=300';

// Templated, known-in-advance scheduled-job markers (NOT pulled from real runs — see §8). Merged
// into the feed so it reads as operational telemetry even when GitHub activity is quiet.
const CRON_MARKERS: FeedEvent[] = [
  { ts: '06:00', src: 'cron', cls: 'p', msg: 'daily pipeline → ok' },
  { ts: '03:00', src: 'cron', cls: 'p', msg: 'memory-consolidate → ok' },
];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': CACHE },
  });
}

async function telemetry(env: Env): Promise<Response> {
  try {
    // VERIFIED endpoint: Aquinas-Protocol is a USER account. cacheTtl caches the subrequest at
    // Cloudflare's edge so GitHub is hit ≤~12/hr regardless of traffic (well under the 60/hr cap).
    const res = await fetch('https://api.github.com/users/Aquinas-Protocol/events/public', {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'aquinas-portfolio-telemetry',
        ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
      },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) throw new Error(`github ${res.status}`);

    const events = mapGitHubEvents(await res.json()).slice(0, 12); // mapGitHubEvents already drops denylist hits
    const merged = [...events, ...CRON_MARKERS].filter((e) => !isForbidden(e.msg)).slice(0, 16);
    if (!merged.length) throw new Error('empty after filtering');
    return json({ events: merged });
  } catch {
    // Any failure (rate limit, offline, empty) → the sanitized committed seed. The feed never breaks.
    return json({ events: seed.events });
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/telemetry.json') return telemetry(env);
    return env.ASSETS.fetch(request);
  },
};

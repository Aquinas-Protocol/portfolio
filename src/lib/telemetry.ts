// Shared, environment-agnostic telemetry helpers: the §8 denylist + GitHub event mapping.
// Pure (no fetch / Workers / DOM globals) so it type-checks in both the browser/SSR program and
// the Worker program, and is unit-testable with plain node.

export type FeedClass = 'p' | 'c' | 'g' | 'a' | 'r';
export interface FeedEvent {
  ts: string;
  src: string;
  cls: FeedClass;
  msg: string;
}

// §8 denylist — applied to every outgoing telemetry string. A match DROPS the event entirely.
// Public commit/branch text is uncontrolled input; treat it as hostile.
export const DENYLIST: RegExp[] = [
  /[a-z]:\\users\\/i, // Windows user paths
  /\/sessions\//i, // Claude Code session paths
  /wiki\//i,
  /raw\//i,
  /second-brain[/\\]/i, // vault PATHS only — bare "second-brain" is a public repo name (allowed in feed)
  /discord[_-]?ops/i, // private system name
  /elev[_-]?broker/i,
  /uuid/i,
  /\bpipe\b/i,
  /localsystem/i,
  /(\d{1,3}\.){3}\d{1,3}/, // IPv4
  /\b([a-f0-9]{1,4}:){4,}[a-f0-9]{1,4}\b/i, // IPv6 (loose)
  /AIza|sk-|ghp_|github_pat_/, // token prefixes
  /[\w.+-]+@[\w-]+\.[\w.-]+/, // any email address
  /https?:\/\//i, // URLs
  /(?:\/[\w.-]+){2,}/, // unix multi-segment absolute paths
];

export function isForbidden(s: string): boolean {
  return DENYLIST.some((re) => re.test(s));
}

/** Build-time guard: throw if any feed string trips the denylist (used by the Zod seed schema). */
export function assertClean(events: { msg: string }[]): void {
  for (const e of events) {
    if (isForbidden(e.msg)) {
      throw new Error(`telemetry denylist violation in seed: ${JSON.stringify(e.msg)}`);
    }
  }
}

function hhmmUTC(iso: unknown): string {
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * Map a raw GitHub public-events payload to sanitized feed rows (used server-side by the Worker).
 * Post-Aug-2025 payloads are trimmed: PushEvent exposes only {ref, head}; CreateEvent {ref, ref_type}.
 * Any row that trips the denylist is dropped (not sanitized-in-place).
 */
export function mapGitHubEvents(raw: unknown): FeedEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: FeedEvent[] = [];
  for (const e of raw) {
    const full = String(e?.repo?.name ?? '');
    const repo = full.includes('/') ? full.split('/').pop()! : full;
    if (!repo) continue;
    const ts = hhmmUTC(e?.created_at);
    let msg = '';
    if (e?.type === 'PushEvent') {
      const branch = String(e?.payload?.ref ?? '').replace(/^refs\/heads\//, '');
      const sha = String(e?.payload?.head ?? '').slice(0, 7);
      msg = `${repo} · push ${branch}${sha ? ' · ' + sha : ''}`.trim();
    } else if (e?.type === 'CreateEvent') {
      msg = `${repo} · new ${e?.payload?.ref_type ?? 'ref'} ${e?.payload?.ref ?? ''}`.trim();
    } else if (e?.type === 'ReleaseEvent') {
      msg = `${repo} · release ${e?.payload?.release?.tag_name ?? ''}`.trim();
    } else {
      continue;
    }
    if (isForbidden(msg)) continue;
    out.push({ ts, src: 'github', cls: 'c', msg });
  }
  return out;
}

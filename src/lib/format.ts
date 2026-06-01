// Small formatting helpers shared by the telemetry Worker and components. Kept pure (no runtime
// globals) so the same module type-checks in both the browser/SSR program and the Worker program.

/** Truncate to n chars with an ellipsis. */
export function truncate(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** First 7 chars of a commit SHA. */
export function sha7(sha: string): string {
  return (sha || '').slice(0, 7);
}

/** ISO timestamp → "HH:MM" in UTC (the feed's compact time column). */
export function hhmmUTC(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

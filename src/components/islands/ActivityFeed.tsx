import { useEffect, useState } from 'react';
import seed from '../../content/telemetry_seed.json';
import { withBase } from '../../lib/url';

type Ev = { ts: string; src: string; cls: string; msg: string };

// Import only the small seed JSON (NOT lib/content, which would pull zod + all content into the
// client bundle). The seed renders immediately for good CLS; the live (already-sanitized) endpoint
// swaps in if reachable. On any failure (e.g. astro dev has no Worker) the seed stays.
export default function ActivityFeed() {
  const [events, setEvents] = useState<Ev[]>(seed.events as Ev[]);

  useEffect(() => {
    let cancelled = false;
    fetch(withBase('api/telemetry.json'), { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && Array.isArray(d.events) && d.events.length) setEvents(d.events as Ev[]);
      })
      .catch(() => {
        /* keep the seed */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = [...events, ...events]; // duplicated for the seamless CSS scroll (translateY 0 → -50%)

  return (
    <div className="actInner">
      {rows.map((e, i) => (
        <div className="actRow" key={i}>
          <span className="ts">{e.ts}</span>
          <span className={`src ${e.cls}`}>{e.src}</span>
          <span className="msg">{e.msg}</span>
        </div>
      ))}
    </div>
  );
}

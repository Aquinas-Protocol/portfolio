import { useState } from 'react';

type Agent = { name: string; role: string; turns: string; av: '' | 'cy' | 'am' };
type ChatLine = { who: string; whoCls?: '' | 'cy' | 'am'; msg?: string; typing?: string };

const TABS = [
  { key: 'council', label: 'COUNCIL', online: true },
  { key: 'scheduler', label: 'SCHEDULER', online: false },
  { key: 'log', label: 'LIVE LOG', online: false },
];

export default function FeaturedProjectTabs({ agents, chat }: { agents: Agent[]; chat: ChatLine[] }) {
  const [active, setActive] = useState('council');

  return (
    <div className="fRight">
      <div className="fTabs" role="tablist" aria-label="Featured system views">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            className={`fTab ${active === t.key ? 'act' : ''}`}
            onClick={() => setActive(t.key)}
          >
            {t.online && <span className="pn" aria-hidden="true" />}
            {t.label}
          </button>
        ))}
      </div>
      <div className="fBody">
        {active === 'council' && (
          <>
            <div className="council">
              {agents.map((a) => (
                <div className="ag" key={a.name}>
                  <div className={`av ${a.av}`} aria-hidden="true" />
                  <div className="name">{a.name}</div>
                  <div className="role">{a.role}</div>
                  <div className="stat">
                    <span className="d" aria-hidden="true" />
                    ONLINE
                  </div>
                  <div className="turns">
                    TURNS · <b>{a.turns}</b>
                  </div>
                </div>
              ))}
            </div>
            <div className="chatPrev">
              {chat.map((c, i) => (
                <div className="ln" key={i}>
                  <span className={`who ${c.whoCls ?? ''}`}>{c.who}</span>
                  {c.typing ? <span className="msg typing">{c.typing}</span> : <span className="msg">{c.msg}</span>}
                </div>
              ))}
            </div>
          </>
        )}
        {active === 'scheduler' && (
          <div className="tbd">// SCHEDULER · persisted cron jobs, idempotent retries — see Live Telemetry below</div>
        )}
        {active === 'log' && (
          <div className="tbd">// LIVE LOG · recent public activity streams in the telemetry feed below</div>
        )}
      </div>
    </div>
  );
}

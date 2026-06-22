import { useEffect, useRef, useState, type FormEvent } from 'react';
import { withBase } from '../../lib/url';

// Public Turnstile SITE key (not the secret) — set after provisioning the Turnstile widget.
const TURNSTILE_SITEKEY = '0x4AAAAAADpVTwC3Xv_04jgC';

const INTENTS = [
  'What has he built?',
  'Is he a fit for an AI-infra role?',
  "What's his availability?",
  'How do I reach him?',
];

const MAGIC_LINES = 7;
const LOCKOUT_AT = 2; // fire the Easter egg after this many genuine exploit-blocked replies

type Msg = { role: 'user' | 'bot'; text: string };

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
  }
}

let turnstilePromise: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (turnstilePromise) return turnstilePromise;
  turnstilePromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turnstile failed'));
    document.head.appendChild(s);
  });
  return turnstilePromise;
}

export default function PitchAgent() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [blocked, setBlocked] = useState(0);
  const [lock, setLock] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [lead, setLead] = useState({ name: '', email: '', company: '', role: '', message: '' });
  const [leadStatus, setLeadStatus] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const tsRef = useRef<HTMLDivElement>(null);
  const tsToken = useRef<string | null>(null);
  const tsWidget = useRef<string | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, sending, leadOpen]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Render Turnstile when the lead form opens.
  useEffect(() => {
    if (!leadOpen) return;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !tsRef.current || !window.turnstile || tsWidget.current) return;
        tsWidget.current = window.turnstile.render(tsRef.current, {
          sitekey: TURNSTILE_SITEKEY,
          theme: 'dark',
          callback: (t: string) => {
            tsToken.current = t;
          },
          'error-callback': () => {
            tsToken.current = null;
          },
          'expired-callback': () => {
            tsToken.current = null;
          },
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [leadOpen]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || sending || lock) return;
    setMsgs((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setSending(true);
    try {
      const res = await fetch(withBase('api/chat'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: q }),
      });
      const data = (await res.json()) as { answer?: string; refused?: boolean; blocked?: boolean };
      if (!res.ok || typeof data.answer !== 'string') throw new Error('bad response');
      setMsgs((m) => [...m, { role: 'bot', text: data.answer as string }]);
      if (data.refused) setLeadOpen(true);
      if (data.blocked) {
        const n = blocked + 1;
        setBlocked(n);
        if (n >= LOCKOUT_AT) setLock(true);
      }
    } catch {
      setMsgs((m) => [...m, { role: 'bot', text: "I'm offline right now — reach Dylan via the contact page." }]);
    } finally {
      setSending(false);
    }
  }

  async function submitLead(e: FormEvent) {
    e.preventDefault();
    if (!tsToken.current) {
      setLeadStatus('Please complete the verification.');
      return;
    }
    setLeadStatus('Sending…');
    try {
      const res = await fetch(withBase('api/lead'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...lead, turnstileToken: tsToken.current }),
      });
      if (res.ok) {
        setLeadStatus('Sent — Dylan reviews messages regularly.');
        setLead({ name: '', email: '', company: '', role: '', message: '' });
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setLeadStatus(d.error === 'invalid email' ? 'Please check your email address.' : 'Could not send — try the contact page.');
      }
      if (window.turnstile && tsWidget.current) {
        window.turnstile.reset(tsWidget.current);
        tsToken.current = null;
      }
    } catch {
      setLeadStatus('Could not send — try the contact page.');
    }
  }

  if (!open) {
    return (
      <button className="pa-launcher" onClick={() => setOpen(true)} aria-label="Open chat with AI Dylan">
        <span className="dotp" aria-hidden="true" />
        Ask AI Dylan
      </button>
    );
  }

  return (
    <div className="pa-panel" role="dialog" aria-label="AI Dylan chat">
      <div className="pa-head">
        <div>
          <div className="ttl">
            <span className="dotp" aria-hidden="true" />
            AI DYLAN
          </div>
          <div className="disc">An AI assistant trained on Dylan's public work — not Dylan himself.</div>
        </div>
        <button className="pa-x" onClick={() => setOpen(false)} aria-label="Close chat">
          ×
        </button>
      </div>

      {lock ? (
        <MagicWord
          onDismiss={() => {
            setLock(false);
            setBlocked(0);
          }}
        />
      ) : (
        <>
          <div className="pa-log" ref={logRef}>
            {msgs.length === 0 && (
              <div className="pa-msg bot">Ask me about Dylan's work, projects, and background — or pick a question below.</div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`pa-msg ${m.role}`}>
                {m.text}
              </div>
            ))}
            {sending && <div className="pa-typing">thinking</div>}
          </div>

          {msgs.length === 0 && (
            <div className="pa-chips">
              {INTENTS.map((q) => (
                <button key={q} onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}

          {leadOpen && (
            <form className="pa-lead" onSubmit={submitLead}>
              <div className="lh">Reach Dylan</div>
              <div className="row">
                <input placeholder="Name" value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} />
                <input placeholder="Email" type="email" value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} />
              </div>
              <div className="row">
                <input placeholder="Company" value={lead.company} onChange={(e) => setLead({ ...lead, company: e.target.value })} />
                <input placeholder="Role" value={lead.role} onChange={(e) => setLead({ ...lead, role: e.target.value })} />
              </div>
              <textarea placeholder="Message" value={lead.message} onChange={(e) => setLead({ ...lead, message: e.target.value })} />
              <div ref={tsRef} />
              <button className="send" type="submit">
                Send to Dylan
              </button>
              <div className="note">Logged for Dylan, who reviews messages regularly. Stored briefly; no tracking.</div>
              {leadStatus && <div className="status">{leadStatus}</div>}
            </form>
          )}

          <form
            className="pa-form"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about Dylan…"
              maxLength={500}
              aria-label="Your question"
            />
            <button type="submit" disabled={sending || !input.trim()}>
              Send
            </button>
          </form>
          {!leadOpen && (
            <button className="pa-reach" onClick={() => setLeadOpen(true)}>
              Reach Dylan directly →
            </button>
          )}
        </>
      )}
    </div>
  );
}

function MagicWord({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="pa-lock" role="alertdialog" aria-label="Access denied">
      <div className="pa-lock-head">AQUINAS // SYSTEM SECURITY INTERFACE · v4.0.5</div>
      <div>&gt; access main program</div>
      <div className="pa-deny">access: PERMISSION DENIED.</div>
      <div>&gt; access main security grid</div>
      <div className="pa-deny">access: PERMISSION DENIED. ...and...</div>
      <div className="pa-magic">
        {Array.from({ length: MAGIC_LINES }).map((_, i) => (
          <div key={i} style={{ animationDelay: `${i * 0.12}s` }}>
            YOU DIDN'T SAY THE MAGIC WORD!
          </div>
        ))}
      </div>
      <span className="pa-cursor" aria-hidden="true">
        ▊
      </span>
      <button className="pa-lock-dismiss" onClick={onDismiss}>
        dismiss
      </button>
    </div>
  );
}

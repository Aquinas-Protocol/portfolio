<!--
  Public generic resume served at /resume.pdf.
  Source of truth: second-brain/wiki/profile/master-resume.md (selection, IC-forward).
  Deliberately scrubbed for public hosting: no street address, no phone.
  Render:
    pandoc design/resume-public.md -f markdown -t html5 --standalone --embed-resources \
      --metadata title="" -c <vault>/content/.resume-style.css -o design/resume-public.html
    msedge --headless --print-to-pdf=public/resume.pdf --no-pdf-header-footer design/resume-public.html
-->

# Dylan Palumbo

Georgetown, TX (AZ relocation in motion) · [palumbo.d555@gmail.com](mailto:palumbo.d555@gmail.com) · [dylan-palumbo.com](https://dylan-palumbo.com) · [linkedin.com/in/dylan-palumbo](https://www.linkedin.com/in/dylan-palumbo) · [github.com/Aquinas-Protocol](https://github.com/Aquinas-Protocol)

**Senior IC · AI / agent infrastructure.** 10+ years of hands-on Python and systems work spanning independent IT consulting, U.S. Army leadership, and AMER-scale IT service delivery. Currently shipping production multi-agent AI infrastructure: a 6-agent Claude council with an admin-elevation broker, cron scheduler, multi-model fallback, and Mission Control dashboard (public mirror: [github.com/Aquinas-Protocol/domo](https://github.com/Aquinas-Protocol/domo)), built and operated solo as proof-of-work for senior IC engineering roles.

## Engineering Proof-of-Work

**Domo / discord-ops — production multi-agent council** ([repo](https://github.com/Aquinas-Protocol/domo) · [case study](https://dylan-palumbo.com/systems/discord-ops/))

- Python 3.12 + Claude Agent SDK + FastAPI + SQLite; 6 specialist agents, each with its own persona, model, and MCP tool allowlist; per-thread sub-agents; 1,501-test suite; 99.94% uptime over 30 days on self-hosted Windows infrastructure.
- Two-service privilege separation: unprivileged bot requests approved Windows admin operations from a LocalSystem broker via UUID-only named-pipe payloads, gated by human Approve/Deny.
- Safety as architecture: PreToolUse policy hook denies secret reads and protected writes even in autonomous mode; single-user auth gate at message receipt; schema-versioned SQLite with pre-migration backups.
- Zero-regression real-time migration to SSE push (bounded per-client mailboxes, drop-oldest + resync) behind a Playwright endpoint-parity golden contract: 6/6 parity, 93 backend tests green, zero functional loss.
- Read-only knowledge-vault MCP endpoint (Streamable-HTTP, bearer-gated) hardened by a 15-agent adversarial review: 12 confirmed findings fixed pre-commit.

**email-triage-ts — NestJS + TypeScript + DynamoDB pipeline with eval-gated LLM scorer** ([repo](https://github.com/Aquinas-Protocol/email-triage-ts))

- Single-table DynamoDB with conditional-write CAS state machine (failed compare-and-set maps to HTTP 409); crash-isolated out-of-process apply worker with post-mortem reconciliation; hexagonal ports so fixture adapters keep the 43-test suite hermetic and keyless.
- LLM spam scorer (Claude Haiku 4.5, pinned snapshot, strict tool use) behind a four-scorer evaluation harness: schema validation, precision/recall, numeric tolerance, LLM-as-judge. Measured at precision 0.938 / recall 0.750 / F1 0.833; a recorded prompt iteration lifted recall 0.45 → 0.75.
- CI-gated regression detection: GitHub Actions runs the eval harness keyless on PRs, posts metrics as a PR comment, and fails the build on schema regression or precision/recall drops.
- HMAC-signed opaque tokens ported bit-identical to the Python original, asserted by a frozen parity vector in CI.

**Public writing — "A threat model for a personal multi-agent system"** ([read](https://dylan-palumbo.com/writing/discord-ops-security-model/))

- Long-form engineering write-up mapping the discord-ops defensive architecture onto the OWASP LLM Top 10 (2025), with an explicit section on what the model does not defend against.

**Selected additional systems**

- **n8n-hris-provisioning** — human-gated new-hire provisioning in n8n: HRIS webhook, Slack approve/decline gate, idempotent Google Workspace + Slack + Notion legs, error lane; survived a 16-hour outage mid-approval ([repo](https://github.com/Aquinas-Protocol/n8n-hris-provisioning)).
- **voice-bridge** — MacBook-to-Windows voice dictation over RDP: Quartz CGEventTap hotkey suppression, clipboard + SendInput paste, heartbeat-armed down-alerts; hardened via a published Win32 heap-corruption RCA.
- **second-brain** — Karpathy-pattern knowledge vault (read-only raw/ vs curated wiki/) serving as shared agent memory, maintained by custom Claude Code skills.
- **Stadium** — Expo/React Native + TypeScript workout PWA, installable offline, in daily use ([live](https://aquinas-protocol.github.io/workout-app)).

## Professional Experience

### Regional Operations IT Manager — AMER · EOS IT Solutions · *Aug 2025 – May 2026*

- Led regional IT service delivery and asset management across 3 countries, directing 13 Service Desk and ITAM specialists through an MSP partnership.
- Oversaw ~1,970 tickets/month (17,718 across 9 months) at 95.3% CSAT, 98.6% time-to-first-response SLA, 91.1% time-to-resolution SLA in a multi-timezone environment.
- Directed lifecycle management for 1,410 enterprise IT assets at a 100% audit pass rate.
- Designed and delivered 5+ operational programs (dynamic service-desk allocation via Sheets + Jira JQL, walk-up support tracking, AV infrastructure monitoring, PTO continuity SOPs) improving SLA adherence and coverage.

### Infantryman (11B) / Acting Training Room NCO · U.S. Army, 1st Cavalry Division · *Jan 2021 – Jul 2025*

- Managed personnel readiness, scheduling, and operational reporting for 100+ personnel at company level.
- Led operational coordination during two multinational deployments (Operation Assure, Deter and Reinforce, Poland/Lithuania; Operation Allies Welcome).
- Awards: Army Achievement Medal, Good Conduct Medal, Armed Forces Service Medal, National Defense Service Medal, Meritorious Unit Commendation.

### Owner / IT Systems Consultant · RescueFix, Reno NV · *Jun 2014 – Jan 2021*

- Founded and operated an independent IT consulting and technician-tooling business: infrastructure support, security hardening, and custom software for individual and small-business clients.
- Built a multi-generation Windows technician console (AutoHotkey) wrapping system inventory, Sysinternals diagnostics, safe-mode operations, and per-machine logging; conceptual ancestor of today's Mission Control + elevation-broker pattern.
- Conducted security testing and vulnerability analysis; managed full business operations end to end.

*Earlier: Non-Conforming Material Technician (contract), Tesla Gigafactory (2018–2019) · Technology Manager, Merry Maids (2016–2018) · Technology Services Specialist, Office Depot (2013–2015).*

## Skills

- **Languages:** Python (primary, 10+ yr), TypeScript, PowerShell, bash, SQL
- **AI / agentic:** Claude Agent SDK, MCP server design, multi-agent orchestration, HITL approval gates, structured output (strict tool use), LLM eval harnesses (datasets, scorers, LLM-as-judge, regression CI), prompt versioning
- **Backend:** NestJS, FastAPI, asyncio, Pydantic, hexagonal architecture, Server-Sent Events
- **Storage:** SQLite (WAL, versioned migrations), DynamoDB (single-table, sparse GSI, conditional writes), PostgreSQL
- **Ops & infra:** Windows service operations (NSSM, Task Scheduler, LocalSystem privilege separation), Tailscale, OAuth flows, GitHub Actions, Jest, pytest
- **Security:** HMAC-signed opaque tokens, timing-safe comparison, SHA-256 audit trails, threat modeling (OWASP LLM Top 10)

## Education & Certifications

- **Southern New Hampshire University** — A.S. Computer Science, in progress · GPA 4.0
- **Truckee Meadows Community College** — coursework: C++, Java, Linux, software development · GPA 3.48
- **Anthropic Academy** (2026): AI Fluency (10/10) · Claude 101 · Claude Code 101 + in Action · MCP Intro + Advanced
- **AWS** (in progress): Certified Solutions Architect · Developer · SysOps Administrator

---
title: "Rebuilding a live dashboard with zero functional loss"
subtitle: "SSE push over bounded mailboxes, a golden-contract Playwright harness, and a restyle technique that changed no JavaScript"
author: Dylan Palumbo
date: 2026-07-16
tags: [sse, real-time, playwright, refactoring, asyncio, frontend, testing]
draft: true
---

<!--
evidence (staging note, all claims sourced from wiki/projects/domo-dashboard-overhaul-2026-07.md):
merged 2026-07-08 after 10 commits; 13 flat tabs -> grouped 5-section shell + live agent orbit;
3 production-critical views, zero functional loss; Playwright endpoint-parity harness, golden
contract of (method, url) per view, 6/6 green through every phase; EventBroadcaster with
publish_nowait via loop.call_soon_threadsafe (never blocks a DB write, never raises); bounded
per-subscriber mailboxes, drop-oldest + resync; GET /api/events holds no agent run slot;
background tick with timeout + backoff; ~185 existing rules restyled via scoped custom-property
remap with zero JS changes; XSS trust matrix + raw-innerHTML ledger fix; Inter + JetBrains Mono
self-hosted woff2, font-display: swap; 10 plan-review gaps folded in pre-implementation
(isViewBusy dirty-state guards, LIVE pill resync); 93 backend + 6 frontend-contract tests green;
all 13 views live-verified headless with a minted session cookie, zero console/page errors.
-->

**Source:** [github.com/Aquinas-Protocol/domo](https://github.com/Aquinas-Protocol/domo) — the MIT extraction of the private production system this post describes.

Mission Control is the local web dashboard for my six-agent automation platform: one FastAPI process, vanilla JavaScript, a single `app.js` and `styles.css`, no framework, no build step. In July I took it through a ground-up redesign from a high-fidelity design handoff: thirteen flat tabs became a grouped five-section shell, the landing page became a live "orbit" of the agent council, and the whole surface moved from manual-refresh polling to real-time push. It merged on 2026-07-08 after ten commits.

The paint is not the story. The story is the constraint I set before writing any code: **zero functional loss** on three production-critical views (an email-triage approval queue, a job-pipeline cockpit, and an ideas kanban). These views run my actual life, and each carries delicate behavior contracts: a two-step decisions-then-apply flow where the apply step is deliberately the only destructive action; untrusted email text that must only ever render through `textContent`; drag-and-drop with an optimistic lock. A redesign that broke any of that would cost more than it delivered.

## Build the net before the trapeze

The first artifact of the project was not a component or a stylesheet. It was a regression harness.

A Playwright harness drives the real static app in a headless browser against a fully mocked `/api`, records every `(method, url)` request the frontend fires, and asserts that each view produces exactly the same endpoint set as the pre-redesign app. That recording is committed as a golden contract file. Any phase of the redesign that silently dropped a call (say, a view that still renders beautifully but no longer fetches its decisions queue) fails immediately.

Endpoint parity is a proxy, not a proof, but it is a remarkably good proxy for a thin client. In an app where the server owns the state and the frontend is a renderer plus a set of fetches, "fires the same requests per view" catches the scariest class of regression, behavior that quietly disappears, at near-zero maintenance cost. The six contract tests were in place before the first visual change landed, and they stayed green through every phase.

## Replacing polling with push, without a framework

The real-time layer is Server-Sent Events over an in-process, dependency-free event bus. Three design decisions did most of the work:

**Publishing can never hurt the writers.** The bus exposes a non-blocking `publish_nowait` routed through `loop.call_soon_threadsafe`, so the synchronous SQLite writers can publish safely: emitting an event never blocks a database write and never raises into the caller. Events come from choke points that already existed (the task ledger and the domain stores publish deltas through an optionally injected bus), so nothing new learned how to write state.

**Slow consumers pay their own bill.** Every subscriber gets a bounded mailbox. On overflow the bus drops oldest and enqueues a `resync` marker, so a laggy browser tab reconciles from a fresh snapshot instead of backing memory up inside the server process.

**The stream is not a tenant.** The single `GET /api/events` stream deliberately does not hold an agent run slot. The dashboard observes the agents; it must never be able to starve them. Snapshot-style topics (agent status, usage) are owned by a background tick that polls with timeout and backoff, so one wedged upstream call cannot stall the bus.

On the client, an `EventSource` with topic dispatch feeds re-renders, guarded by dirty-state checks (`isViewBusy()`) so a live update never clobbers an open editor, an expanded row, or a focused input. The LIVE pill doubles as a click-to-resync escape hatch. None of these were afterthoughts: a code-grounded review of the plan flagged ten gaps up front (the dirty-state guards, the non-blocking publish, tick backoff, the parity harness itself), and all ten were folded in before implementation started.

## Restyling 185 rules by editing none of them

The most useful trick in the project cost almost nothing. The critical views were restyled with **zero JavaScript changes** by exploiting CSS custom-property inheritance: one scoped rule per view re-maps the design tokens (panel color, line color, radius) that the roughly 185 existing rules already consume. The whole view adopts the new aesthetic while every selector, every interaction handler, and every rendering path stays byte-identical.

That is what preserved the delicate contracts *by construction* rather than by re-testing: the two-step apply flow, the `textContent`-only rendering, the checkbox state carried in data attributes, the drag-and-drop optimistic lock. When a view's correctness lives in JavaScript you do not need to touch, the safest edit is the one that touches none of it.

## The cleanup you do while the hood is open

Two things earned their place in the same change. First, an explicit XSS trust matrix: untrusted email, idea, and agent text renders only via `textContent`; server-owned enums are escaped at the template boundary. Writing the matrix down surfaced a real pre-existing bug (raw-`innerHTML` interpolation of a few server fields in the ledger renderer), now fixed. Second, self-hosted fonts: Inter and JetBrains Mono bundled as local woff2 with `font-display: swap`, so typography is deterministic and works offline instead of silently falling back to whatever the OS ships.

## Verified live, not just green

The suite finished at 93 backend tests plus the 6 endpoint-parity contract tests, all green. Then every one of the thirteen views was driven headless against the *running* production system with a minted session cookie: zero console or page errors, the SSE stream confirmed connected, and the XSS fix confirmed against real data. One detail I am disproportionately pleased with: where the design prototype simplified a view from five KPIs to four, the shipped version kept the richer five, because the mandate was "don't degrade, improve if anything."

## What this does NOT prove

- **Endpoint parity is not pixel parity.** The harness catches lost behavior, not a broken layout or a mis-bound button that fires the right request from the wrong place. Live driving plus eyes covered that part, and that part is judgment, not proof.
- **The bus is in-process by design.** One process, one event loop. It would not survive a multi-process deployment without a real broker, and it does not pretend it would.
- **"Zero functional loss" is a scoped claim.** It covers the three critical views' contracts, verified by the harness. Everything else changed on purpose — that was the point of the redesign.

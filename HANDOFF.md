# Portfolio — Handoff

_Last updated: 2026-06-01. Owner: Dylan Palumbo. This doc lets a fresh instance pick up cold._

## TL;DR

A recruiter-facing "Live Telemetry" Mission Control portfolio. **Built, deployed, and live** at
**https://portfolio.machina-infastructure.workers.dev/**. Source: **https://github.com/Aquinas-Protocol/portfolio** (public, branch `main`). Local working copy: `C:\Users\Artemis\Documents\projects\portfolio-site` (NOT in the second-brain vault).

Spec lineage: `second-brain/portfolio-prd.md` (the PRD) + `second-brain/portfolio-reference.html` (the pixel ground-truth mock). Implementation plan: `~/.claude/plans/c-users-artemis-documents-second-brain-fancy-pixel.md`.

## Stack (as built — differs from the PRD on purpose)

- **Astro 6** (`output: 'static'`) + **Tailwind 4** (`@tailwindcss/vite`) + **React 19 islands** (`@astrojs/react`).
- **Deployed as Cloudflare Workers Static Assets** via a **hand-written `worker/index.ts`** — NOT the `@astrojs/cloudflare` adapter (see Decisions). Static pages are served free; only `/api/telemetry.json` invokes the Worker.
- Content is JSON in `src/content/`, validated by **Zod** in `src/lib/content.ts` (a typo fails `astro build`).
- Deploy = **Cloudflare Workers Builds** (Git push → Cloudflare builds on its Linux runners). Connected to the repo; auto-deploys on push to `main`.

## Key architecture decisions (and WHY — don't undo these blindly)

1. **No `@astrojs/cloudflare` adapter.** Its v13 build crashes (`write EOF`) on this Node 24 / Windows box while spawning `workerd`, and it dropped Cloudflare *Pages* support anyway. We ship pure-static Astro + a standalone Worker entry (`worker/index.ts`) that handles the one dynamic route and falls through to `env.ASSETS`.
2. **Local `wrangler` does not work on this machine** (Node 24 / Windows → `workerd` "write EOF" in `wrangler dev` / `types` / `deploy`). **Deploy via Workers Builds (cloud), not local `wrangler deploy`.** Type-check the Worker with `npm run check` (pure `tsc` + `@cloudflare/workers-types`, no workerd). On a Linux/macOS box or Node 22, local wrangler would work.
3. **`Aquinas-Protocol` is a GitHub User, not an Org.** Telemetry uses `https://api.github.com/users/Aquinas-Protocol/events/public` (`/orgs/...` 404s — verified).
4. **§8 telemetry safety is server-side.** `worker/index.ts` fetches GitHub, maps events, and applies the denylist (`src/lib/telemetry.ts`) **server-side**, caching the subrequest with `cf.cacheTtl`. The browser never calls GitHub and no token ships. On any failure it returns the sanitized committed seed (`src/content/telemetry_seed.json`, Zod-guarded against denylist hits at build).
5. **Reduced-motion: currently UN-gated.** The owner's machine has OS "Reduce motion" on and wanted the live look, so blink/pulse/scroll keyframes are unconditional. To respect visitors' `prefers-reduced-motion` instead, wrap the three `@keyframes` in `src/styles/keyframes.css` per the note in that file.

## Status vs the PRD

**Done & live:** all 12 routes (Overview, Systems index + 6 detail pages, Experience, Contact, Writing, 404), pixel-matched to the reference; JSON-driven content + Zod build guard; live server-sanitized GitHub activity feed; the two React islands (featured tabs + activity feed) hydrate; static/Worker split; branded favicon; `robots.txt`. Verified: visual parity (all routes screenshotted), §8 grep on `dist` (0 browser→GitHub calls, 0 tokens, 0 PII/paths/IPs), live telemetry pulling real public events.

**PRD acceptance items NOT yet verified:** Lighthouse (run on the live CDN URL, not localhost — PRD §10 targets: Perf ≥95 desk/≥90 mobile, A11y ≥95, BP ≥95, SEO ≥95) and a true mobile-viewport check (breakpoints are ported verbatim and pass at desktop width, but 375px emulation wasn't reliable with the available tooling).

## Open / remaining work

1. **Custom domain (owner chose this).** Owner wants a custom domain (e.g. `dylanpalumbo.dev`) but hasn't picked/acquired one yet. Path: buy via Cloudflare Registrar (at-cost) or connect an owned domain → in the dashboard, Worker → **Settings → Domains & Routes → Add custom domain** → then update `site` in `astro.config.mjs` (currently the placeholder `https://portfolio.workers.dev`) and push (fixes canonical/OG). `base` stays `/`.
2. **`public/og-default.png`** (1200×630 social-share image) — referenced in `<head>` but not authored. A screenshot of the hero works.
3. **"Left button tree does not scroll" (UNRESOLVED).** Owner reported this but it's not in `portfolio-reference.html` (the canonical mock we built from) — likely a `portfolio-c-v2.html` concept element. Needs the owner to point at which page/element, or confirm it's a scope-add.
4. **Hero copy just changed (deploying):** reframed from "shipping discord-ops" to "I run discord-ops … shipped its open-source core as Domo (MIT)" — option #1 of a discord-ops-vs-Domo canon discussion. The owner leaned toward keeping discord-ops as the flagship with Domo as the honest "shipped OSS" framing. If they later want to promote Domo to SYS-001/flagship (option #2), that's a `systems.json` + hero edit.
5. **Reduced-motion** (optional): re-scope to respect `prefers-reduced-motion` if desired (note in `keyframes.css`).

**Deferred (PRD out-of-scope v1):** Systems detail tabs beyond Overview, FilterBar search, the "+ New System"/"Export Manifest" buttons (visual-only), real Writing posts, dynamic per-page OG images.

## Gotchas / learnings (save the next instance time)

- **Tailwind class-name collisions.** Semantic class `ring` collided with Tailwind's `ring` utility (painted a 1px light box-shadow → a white box around each gauge). Fixed by renaming to `gaugeRing`. Watch other single-word class names that match Tailwind utilities (`block`, `flex`, `grid`, `table`, `fixed`, `ring`, …) — `ring` was the only collision found, but it's a real risk of mixing Tailwind with hand-written generic class names.
- **jsxDEV dev error.** React 19 + Vite 7 threw `jsxDEV is not a function` in `astro dev`, blanking the islands (prod was unaffected). Fixed via `vite.optimizeDeps.include` (the JSX runtimes) + `resolve.dedupe: ['react','react-dom']` in `astro.config.mjs`. Don't remove.
- **§8 denylist nuance:** `second-brain` is matched path-only (`/second-brain[/\\]/`) because it's a *public repo name* that legitimately appears in the feed; broadening it back to the bare word will wrongly drop real `second-brain` pushes.
- **CRLF warnings** on commit are harmless (Windows). Consider a `.gitattributes` with `* text=auto eol=lf` if they bother you.

## Commands

```
npm run dev        # frontend dev at localhost:4321 (telemetry API is Worker-only; feed falls back to seed in dev)
npm run build      # astro build → dist/
npm run preview    # serve the built dist (production islands)
npm run check      # type-check worker/index.ts (no workerd)
# Deploy: just `git push origin main` → Workers Builds rebuilds & deploys. (Local `wrangler deploy` is broken here.)
```

## Key files

- `worker/index.ts` — the Worker: routing + `/api/telemetry.json` (the §8 server boundary).
- `src/lib/telemetry.ts` — denylist + GitHub event mapping (shared, pure, unit-testable).
- `src/lib/content.ts` — Zod schemas + the build-time §8 seed guard.
- `src/content/*.json` — all editable content (profile, stats, systems, experience, channels, career_stats, telemetry_seed).
- `src/styles/{tokens,global,keyframes}.css` — design tokens + ported reference CSS + motion.
- `astro.config.mjs` — `site`/`base`/`output:static`, React, Tailwind 4 Vite plugin, the jsxDEV-fix `optimizeDeps`.
- `wrangler.jsonc` — Worker name `portfolio`, `assets` (dist) binding, compat flags.
- `README.md` — setup + deploy reference. This `HANDOFF.md` — current state + what's left.

## Cloudflare account

Account: `Machina.infastructure@gmail.com`. Worker name: `portfolio`. Workers Builds is connected to the GitHub repo (auto-deploy on push to `main`). Optional `GITHUB_TOKEN` secret raises the GitHub rate limit (site works without it).

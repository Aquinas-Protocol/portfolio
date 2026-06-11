# Portfolio — Dylan Palumbo

A "Live Telemetry" Mission Control dashboard that doubles as a recruiter-facing portfolio.
Built with **Astro 6** (static output) + **Tailwind 4** + **React 18/19 islands**, deployed as
**Cloudflare Workers Static Assets**. All content is JSON-driven (`src/content/`), validated by Zod
at build time.

## Commands

| Command | Action |
| :-- | :-- |
| `npm run dev` | Dev server at `localhost:4321` (frontend; the telemetry API is Worker-only) |
| `npm run build` | Build the static site to `./dist/` |
| `npm run preview` | Preview the built `dist/` (production islands) |
| `npm run check` | Type-check the Worker (`worker/index.ts`) with `@cloudflare/workers-types` |
| `npm run deploy` | `astro build && wrangler deploy` (see note below) |

## Architecture notes

- **Static site + one Worker route.** Every page prerenders to static HTML in `dist/` (served free as
  Cloudflare Static Assets). The only dynamic surface is `worker/index.ts`, which handles
  `GET /api/telemetry.json` and falls through to `env.ASSETS` for everything else.
- **Why Workers, not Pages.** `@astrojs/cloudflare` v13 (required by Astro 6) dropped Cloudflare Pages
  support. We deliberately do **not** use that adapter — on Node 24 / Windows its build crashes
  ("write EOF") spawning workerd. Instead the site is pure-static Astro + a hand-written Worker entry,
  which is simpler and fully in our control.
- **Local wrangler caveat (Node 24 / Windows).** `wrangler dev` / `wrangler types` / `wrangler deploy`
  spawn `workerd`, which crashes with "write EOF" on this toolchain. **Deploy via Cloudflare Workers
  Builds (Git integration)** instead — it builds on Cloudflare's Linux runners, sidestepping the local
  bug. (On a Linux/macOS box, or Node 22, `npm run deploy` works locally.)

## Telemetry feed (§8 safety)

The activity feed is fetched and **sanitized server-side** in the Worker:
`GET https://api.github.com/users/Aquinas-Protocol/events/public` → mapped to
`<repo> · <action> · <sha7>` rows → a denylist (`src/lib/telemetry.ts`) drops anything matching paths,
emails, IPs, tokens, or private system names → cached via `cf.cacheTtl` (≤~12 GitHub hits/hr). The
browser only ever receives already-sanitized JSON; it **never calls GitHub directly** and no token is
shipped. On any failure the Worker returns the committed, sanitized `src/content/telemetry_seed.json`.

`GITHUB_TOKEN` is optional (raises GitHub's rate limit). Set it as a Cloudflare secret in prod; locally
put it in `.dev.vars` (gitignored). The site works fine unauthenticated.

## Deploy (Cloudflare Workers Builds)

1. Push this repo to GitHub (`Aquinas-Protocol/portfolio`).
2. Cloudflare dashboard → **Workers & Pages → Create → Workers → Connect to Git** → pick the repo.
   Build command `npm run build`; the rest is read from `wrangler.jsonc`.
3. (Optional) Settings → Variables → add secret `GITHUB_TOKEN` (fine-grained, public-read only).
4. Every push to `main` auto-builds and deploys. Add a custom domain in the dashboard when ready —
   only `site` in `astro.config.mjs` needs updating (base stays `/`).

## Content

Edit JSON in `src/content/` (profile, stats, systems, experience, channels, career_stats, telemetry
seed). Zod schemas in `src/lib/content.ts` fail the build on a typo or shape mismatch.

## Known v1 gaps

- Systems detail tabs are content-driven (`detail.tabs` in `systems.json`, optional per system) — authored
  for discord-ops and email-triage-ts so far. The FilterBar search and the "+ New System" / "Export
  Manifest" buttons remain intentionally visual-only.
- `/resume.pdf` is rendered from `design/resume-public.md` (render commands in its header comment);
  re-render and commit when the master resume changes.

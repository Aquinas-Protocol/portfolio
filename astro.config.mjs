// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// Base stays '/'. Swap SITE to the real workers.dev subdomain or a custom domain at deploy time
// (only this constant changes — every internal URL routes through src/lib/url.ts `withBase`).
const SITE = 'https://dylan-palumbo.com'; // custom domain attached to the portfolio Worker (2026-06-02); workers.dev subdomain still serves too

// Pure-static output. The site deploys as Cloudflare Workers Static Assets; the one dynamic route
// (/api/telemetry.json) is served by a hand-written Worker entry (worker/index.ts), NOT an Astro
// on-demand route. We intentionally do NOT use @astrojs/cloudflare: on Node 24 / Windows its v13
// build crashes ("write EOF") while spawning workerd for its default KV-session setup. The standalone
// Worker keeps the §8 boundary server-side and is fully in our control. See plan §"On-demand split gate".
// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: '/',
  output: 'static',
  integrations: [react()],

  // Disable Shiki: the writing section's code blocks are styled by `.prose pre` in global.css to
  // match the site theme. Shiki's inline styles would otherwise override that. Re-enable (and pick a
  // theme) if a future post needs token-level syntax highlighting.
  markdown: { syntaxHighlight: false },

  vite: {
    plugins: [tailwindcss()],
    // React 19 + Vite 7: pre-bundle the JSX runtimes so `jsxDEV` resolves in `astro dev`.
    // Dev-only behaviour; the production build (which uses the `jsx` runtime) is unaffected.
    optimizeDeps: { include: ['react/jsx-dev-runtime', 'react/jsx-runtime', 'react', 'react-dom', 'react-dom/client'] },
    resolve: { dedupe: ['react', 'react-dom'] },
  },
});

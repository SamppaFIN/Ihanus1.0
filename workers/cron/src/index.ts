// Cloudflare Worker: cron-tikki joka 10 min (ks. wrangler.toml). Tunti ennen Vakio-kierroksen sulkeutumista
// käynnistää GitHub-workflow'n joka hakee tuoreet peliprosentit ja julkaisee UI:n.
// Koko logiikka on src/pipeline/cron-run.ts:ssä (testattu Nodessa); tämä tiedosto vain kytkee sen Workersiin.

import { runCron, type CronEnv } from '../../../src/pipeline/cron-run.js';

type Env = CronEnv;

// Workersin fetch tukee Cloudflare-välimuistia: sama Teksti-TV-sivu ei kuormita Yleä useammin kuin kerran minuutissa.
const cachedFetch: typeof fetch = (input, init) => fetch(input, { ...init, cf: { cacheTtl: 60, cacheEverything: true } } as RequestInit);

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(
      runCron(env, (url, init) => (String(url).startsWith('https://yle.fi') || env.YLE_BASE ? cachedFetch(url, init) : fetch(url, init))).then(
        (r) => console.log(JSON.stringify(r)),
        (e) => console.error('cron epäonnistui', String(e)),
      ),
    );
  },

  /** GET /status — mitä cron näkee juuri nyt (ei käynnistä mitään; token ei näy). */
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname !== '/status') return new Response('ihanus-cron: GET /status\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    const r = await runCron({ ...env, GITHUB_TOKEN: undefined }, cachedFetch);
    return Response.json({ ...r, note: 'Dry-run: workflow\'ta ei käynnistetä tästä osoitteesta.' }, { headers: { 'access-control-allow-origin': '*' } });
  },
};

// Cloudflare-cronin ydin (ajettavissa myös Nodessa testeissä): hae Teksti-TV 479, laske mitkä kierrokset ovat
// "tunti ennen sulkeutumista" -hetkessä ja käynnistä GitHub-workflow joka hakee tuoreen datan ja julkaisee sen.

import { fetchYleVakioAll } from '../scrape/yle-vakio.js';
import { dueRounds, parseOffsets, type Due, type OpenRound } from './cron-plan.js';

export interface CronEnv {
  /** Fine-grained PAT (Actions: write, vain tämä repo). Ilman sitä ei käynnistetä mitään, vain kirjataan. */
  GITHUB_TOKEN?: string;
  GITHUB_REPO: string;
  WORKFLOW: string;
  REF: string;
  REFRESH_BEFORE_MIN?: string;
  INTERVAL_MIN?: string;
  YLE_BASE?: string;
  /** Viive Teksti-TV-alasivujen välillä (ms), oletus 200 */
  FETCH_DELAY_MS?: string;
  GITHUB_API?: string;
  /** Valinnainen KV-tallennus kaksoislaukaisun estoon */
  STATE?: { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> };
}

export interface CronResult {
  at: string;
  rounds: Array<{ title: string; closesAt: string; minutesToClose: number }>;
  due: Due[];
  dispatched: boolean;
  skipped?: string;
}

export async function dispatchWorkflow(f: typeof fetch, env: CronEnv): Promise<{ ok: boolean; status: number }> {
  const api = env.GITHUB_API ?? 'https://api.github.com';
  const res = await f(`${api}/repos/${env.GITHUB_REPO}/actions/workflows/${env.WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'ihanus-cron',
      'content-type': 'application/json',
    },
    // Tunti ennen sulkeutumista haetaan peliprosenttien lisäksi myös tuoreet kertoimet
    body: JSON.stringify({ ref: env.REF, inputs: { odds: 'true' } }),
  });
  return { ok: res.status === 204, status: res.status };
}

export async function runCron(env: CronEnv, f: typeof fetch = fetch, now: Date = new Date()): Promise<CronResult> {
  const interval = Number(env.INTERVAL_MIN ?? 10) || 10;
  const offsets = parseOffsets(env.REFRESH_BEFORE_MIN);
  const pages = await fetchYleVakioAll(f, () => now, env.YLE_BASE ?? 'https://yle.fi/tekstitv/txt', Number(env.FETCH_DELAY_MS ?? 200));

  const open: OpenRound[] = pages
    .filter((p) => !p.parsed.closed && p.parsed.closesAt)
    .map((p) => ({ key: `${p.parsed.title}|${p.parsed.krs}`, title: p.parsed.title, closesAtMs: Date.parse(p.parsed.closesAt!) }))
    .filter((r) => r.closesAtMs > now.getTime());

  let due = dueRounds(open, now.getTime(), offsets, interval);
  const result: CronResult = {
    at: now.toISOString(),
    rounds: open.map((r) => ({ title: r.title, closesAt: new Date(r.closesAtMs).toISOString(), minutesToClose: Math.round((r.closesAtMs - now.getTime()) / 6000) / 10 })),
    due,
    dispatched: false,
  };

  if (env.STATE && due.length) {
    const fresh: Due[] = [];
    for (const d of due) {
      const k = `fired:${d.key}:${d.offsetMin}`;
      if (!(await env.STATE.get(k))) fresh.push(d);
    }
    due = fresh;
    result.due = due;
  }
  if (!due.length) return result;
  if (!env.GITHUB_TOKEN) {
    result.skipped = 'GITHUB_TOKEN puuttuu — ei käynnistetty';
    return result;
  }
  const r = await dispatchWorkflow(f, env);
  result.dispatched = r.ok;
  if (!r.ok) result.skipped = `GitHub vastasi ${r.status}`;
  else if (env.STATE) for (const d of due) await env.STATE.put(`fired:${d.key}:${d.offsetMin}`, result.at, { expirationTtl: 3 * 86400 });
  return result;
}

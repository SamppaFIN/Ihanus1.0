// Lukee data/coupons, data/sheets, data/odds → kirjoittaa web/data/rounds.json (UI:n lähde).
// Käyttö: npm run build:data [-- --budget 40] [-- --today 2026-11-09]

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRound, type OddsFile, type SheetFile } from '../pipeline/build-round.js';
import { DEFAULT_FUSE } from '../engine/prob.js';
import { DEFAULT_PRIZE_MODEL } from '../engine/prize.js';
import type { Coupon } from '../engine/types.js';

const root = new URL('../../', import.meta.url).pathname;
const arg = (name: string, d?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

const today = arg('today', new Date().toISOString().slice(0, 10))!;
const budgetEur = Number(arg('budget', '40'));

const readJson = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null);

const couponFiles = readdirSync(join(root, 'data/coupons')).filter((f) => f.endsWith('.json')).sort().reverse();
const rounds = couponFiles.map((f) => {
  const c = readJson<Coupon>(join(root, 'data/coupons', f))!;
  const sheet = readJson<SheetFile>(join(root, 'data/sheets', f));
  const odds = readJson<OddsFile>(join(root, 'data/odds', f));
  const t0 = Date.now();
  const r = buildRound(c, sheet, odds, { today, budgetEur });
  console.log(`${c.id}: ${r.status}, edge=${r.hasEdge}, polku=${r.path.length} askelta (${Date.now() - t0} ms)${r.noPathReason ? ' — ' + r.noPathReason : ''}`);
  return { ...r, oddsFetchedAt: odds?.fetchedAt ?? null };
});

mkdirSync(join(root, 'web/data'), { recursive: true });
const outPath = join(root, 'web/data/rounds.json');
const payload = {
  generatedAt: new Date().toISOString(),
  today,
  budgetEur,
  assumptions: {
    prize: DEFAULT_PRIZE_MODEL,
    fuse: DEFAULT_FUSE,
  },
  rounds,
};
// Ei kirjoiteta uudelleen jos vain aikaleima muuttuisi → ajastetut ajot eivät tee turhia committeja.
const prev = readJson<typeof payload>(outPath);
const strip = (o: typeof payload) => JSON.stringify({ ...o, generatedAt: '' });
if (prev && strip(prev) === strip(payload)) {
  console.log(`→ web/data/rounds.json ennallaan (${rounds.length} kierrosta)`);
} else {
  writeFileSync(outPath, JSON.stringify(payload, null, 1));
  console.log(`→ web/data/rounds.json (${rounds.length} kierrosta)`);
}

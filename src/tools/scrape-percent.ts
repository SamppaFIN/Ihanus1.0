// Hakee Ylen Teksti-TV:n sivun 479 (pelijakauma, vaihto, takuupotti/bonus) ja päivittää kuponkitiedoston.
// Käyttö:
//   npm run scrape:percent                       (hakee verkosta; pelipäivä päätellään otsikosta)
//   npm run scrape:percent -- --file fixtures/yle-479-lauantaivakio-2026-11-07.txt --date 2026-11-07
//   npm run scrape:percent -- --date 2026-11-14   (kierroksen päivä, jos eri kuin tänään)
// Exit-koodit: 0 = ok, 1 = virhe, 3 = sivulla ei ole Vakio-kohteita (esim. välikausi) → ei muutoksia.

import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchYleVakio, parseYleVakio } from '../scrape/yle-vakio.js';
import { couponId, findExisting, mergeYleIntoCoupon, playDateFor } from '../pipeline/merge-coupon.js';
import type { Coupon } from '../engine/types.js';

const root = new URL('../../', import.meta.url).pathname;
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const helsinkiToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date());

async function main() {
  const today = arg('date') ?? helsinkiToday();
  const file = arg('file');
  let raw: string;
  if (file) raw = readFileSync(file, 'utf8');
  else raw = (await fetchYleVakio()).raw;
  const page = parseYleVakio(raw);

  mkdirSync(join(root, 'data/raw'), { recursive: true });
  writeFileSync(join(root, 'data/raw', `yle-479-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`), raw);

  if (page.matches.length === 0) {
    console.error('Sivulta ei löytynyt Vakio-kohteita — ei muutoksia.');
    process.exit(3);
  }
  const dir = join(root, 'data/coupons');
  const all = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Coupon);
  // --date pakottaa pelipäivän; muuten päätellään otsikosta ja etsitään samaa kierrosta
  const date = arg('date') ?? playDateFor(page.title, today);
  const existing = findExisting(all, page, today);
  const id = existing?.id ?? couponId(date, page);
  const { coupon, created, warnings } = mergeYleIntoCoupon(existing, page, date);
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(coupon, null, 2) + '\n');

  mkdirSync(join(root, 'data/crowd-history'), { recursive: true });
  appendFileSync(
    join(root, 'data/crowd-history', `${id}.jsonl`),
    JSON.stringify({ t: new Date().toISOString(), snapshotTime: page.snapshotTime, turnoverEur: page.turnoverEur, closed: page.closed, crowd: page.matches.map((m) => m.percents) }) + '\n',
  );

  console.log(`${created ? 'Luotu' : 'Päivitetty'} ${id}: ${page.matches.length} ottelua, vaihto ${page.turnoverEur ?? '?'} €, jakauma ${page.snapshotTime ?? '?'}${page.closed ? ', kohde suljettu' : ''}`);
  for (const w of warnings) console.warn('  ⚠', w);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

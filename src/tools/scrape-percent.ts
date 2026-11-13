// Hakee Ylen Teksti-TV:n sivun 479 kaikki alasivut (pelijakauma, vaihto, rivihinta, sulkeutumisaika,
// takuupotti/bonus) ja päivittää kuponkitiedostot. Ei API-avaimia: julkinen staattinen HTML.
// Käyttö:
//   npm run scrape:percent                                   (hakee verkosta)
//   npm run scrape:percent -- --file fixtures/yle-479-lauantaivakio-2026-11-07.txt --date 2026-11-07
// Exit-koodit: 0 = ok, 1 = virhe, 3 = sivuilla ei ole Vakio-kohteita (esim. tauko) → ei muutoksia.

import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchYleVakioAll, parseYleVakio } from '../scrape/yle-vakio.js';
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
  const pages = file ? [{ raw: readFileSync(file, 'utf8'), parsed: parseYleVakio(readFileSync(file, 'utf8')) }] : await fetchYleVakioAll();

  mkdirSync(join(root, 'data/raw'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  pages.forEach((p, i) => writeFileSync(join(root, 'data/raw', `yle-479-${stamp}-${i + 1}.txt`), p.raw));

  // Ihanus on jalkapallopainotteinen: lätkä-, NHL- ja NFL-Vakiot ohitetaan (ei omaa mallia niille)
  const NOT_FOOTBALL = /lätkä|nhl|nfl|nba|koris|jääkiekko|pesis/i;
  const withMatches = pages.filter((p) => p.parsed.matches.length > 0 && !NOT_FOOTBALL.test(p.parsed.title));
  if (withMatches.length === 0) {
    console.error('Sivuilta ei löytynyt Vakio-kohteita — ei muutoksia.');
    process.exit(3);
  }

  const dir = join(root, 'data/coupons');
  mkdirSync(dir, { recursive: true });
  for (const { parsed: page } of withMatches) {
    const all = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Coupon);
    // pelipäivä: sulkeutumisajasta, muuten otsikosta; --date pakottaa
    const date = arg('date') ?? (page.closesAt ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date(page.closesAt)) : playDateFor(page.title, today));
    const existing = findExisting(all, page, today);
    const id = existing?.id ?? couponId(date, page);
    const { coupon, created, warnings } = mergeYleIntoCoupon(existing, page, date);
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(coupon, null, 2) + '\n');

    mkdirSync(join(root, 'data/crowd-history'), { recursive: true });
    appendFileSync(
      join(root, 'data/crowd-history', `${id}.jsonl`),
      JSON.stringify({ t: new Date().toISOString(), snapshotTime: page.snapshotTime, turnoverEur: page.turnoverEur, closed: page.closed, crowd: page.matches.map((m) => m.percents) }) + '\n',
    );
    console.log(`${created ? 'Luotu' : 'Päivitetty'} ${id}: ${page.matches.length} ottelua, vaihto ${page.turnoverEur ?? '?'} €, rivihinta ${page.rowPriceEur ?? '?'} €, jakauma ${page.snapshotTime ?? '?'}${page.closesAt ? ', päättyy ' + page.closesAt : ''}${page.closed ? ', suljettu' : ''}`);
    for (const w of warnings) console.warn('  ⚠', w);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

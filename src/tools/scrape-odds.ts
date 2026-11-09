// Hakee aamuisin 1X2-kertoimet (The Odds API, Pinnacle ensisijainen) kuponin otteluille → data/odds/<id>.json.
// Käyttö: THE_ODDS_API_KEY=... npm run scrape:odds [-- --id 2026-11-14-lauantaivakio-1] [-- --sports soccer_epl,soccer_efl_champ]
// Ilman --id käytetään uusinta kuponkia jolla ei ole kaikkia tuloksia.
// Exit: 0 ok, 2 = ei API-avainta, 1 = virhe.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SPORTS, fetchEvents, matchEvents, type OddsApiEvent } from '../scrape/odds-api.js';
import type { Coupon } from '../engine/types.js';

const root = new URL('../../', import.meta.url).pathname;
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const key = process.env.THE_ODDS_API_KEY;
  if (!key) {
    console.error('THE_ODDS_API_KEY puuttuu (GitHub-secret tai ympäristömuuttuja).');
    process.exit(2);
  }
  const dir = join(root, 'data/coupons');
  const id =
    arg('id') ??
    readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort()
      .reverse()
      .find((i) => !(JSON.parse(readFileSync(join(dir, `${i}.json`), 'utf8')) as Coupon).matches.every((m) => m.result));
  if (!id) {
    console.log('Ei avointa kuponkia.');
    return;
  }
  const coupon = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')) as Coupon;
  const sports = (arg('sports') ?? process.env.ODDS_SPORTS ?? DEFAULT_SPORTS.join(',')).split(',');
  const events: OddsApiEvent[] = [];
  for (const s of sports) {
    try {
      events.push(...(await fetchEvents(s, key)));
    } catch (e) {
      console.warn(`  ⚠ ${s}: ${(e as Error).message}`);
    }
  }
  const { matched, unmatched } = matchEvents(coupon.matches, events);
  mkdirSync(join(root, 'data/odds'), { recursive: true });
  writeFileSync(
    join(root, 'data/odds', `${id}.json`),
    JSON.stringify({ fetchedAt: new Date().toISOString(), source: `the-odds-api (${matched[0]?.bookmaker ?? 'ei osumia'} ensisijaisesti)`, matches: matched.map(({ n, odds, event }) => ({ n, odds, event })) }, null, 2) + '\n',
  );
  console.log(`${id}: kertoimet ${matched.length}/${coupon.matches.length} ottelulle.${unmatched.length ? ' Ei löytynyt: ' + unmatched.join(', ') : ''}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

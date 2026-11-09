// Aamun kertoimet ilman API-avainta: Playwright avaa BetExplorerin liigojen ottelulistat, lukee 1X2-kertoimet
// ja täsmäyttää ne kuponin otteluihin → data/odds/<id>.json.
//
// Käyttö:
//   npx playwright install chromium            (kerran)
//   npm run scrape:odds [-- --id <kuponki>] [-- --leagues england/championship,spain/laliga] [-- --debug]
//   npm run scrape:odds -- --html sivu.html     (jäsennä tallennettu sivu, ei verkkoa)
// --debug tallentaa jokaisen sivun HTML:n ja kuvakaappauksen kansioon data/raw/ (sivuston rakenne ei ole varmistettu).
// Exit: 0 ok (myös "ei kertoimia löytynyt"), 1 virhe.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { DEFAULT_LEAGUES, ROW_SNAPSHOT_SCRIPT, fixturesUrl, matchFixtures, parseRows, type OddsRow, type RowSnapshot } from '../scrape/odds-table.js';
import type { Coupon } from '../engine/types.js';

const root = new URL('../../', import.meta.url).pathname;
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Ikävahvistus / evästebanneri: yritetään painaa yleisimpiä painikkeita. Ei saa kaataa ajoa. */
async function dismissGates(page: Page): Promise<void> {
  const names = [/yli 18|18\+|over 18|i am 18|sou maior|maior de 18|sim\b/i, /hyväksy|accept all|accept|agree|i agree|ok\b/i];
  for (const re of names) {
    try {
      const btn = page.getByRole('button', { name: re }).first();
      if (await btn.isVisible({ timeout: 1500 })) await btn.click({ timeout: 2000 });
    } catch {
      /* ei porttia / ei painiketta */
    }
  }
}

async function snapshot(page: Page): Promise<RowSnapshot[]> {
  return (await page.evaluate(ROW_SNAPSHOT_SCRIPT)) as RowSnapshot[];
}

async function main() {
  const dir = join(root, 'data/coupons');
  const load = (i: string) => JSON.parse(readFileSync(join(dir, `${i}.json`), 'utf8')) as Coupon;
  // Ilman --id: kaikki avoimet kupongit (joissa on vielä tulos puuttumassa) — liigasivut haetaan vain kerran
  const ids = arg('id')
    ? [arg('id')!]
    : readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
        .sort()
        .filter((i) => !load(i).matches.every((m) => m.result));
  if (!ids.length) {
    console.log('Ei avointa kuponkia.');
    return;
  }
  const leagues = (arg('leagues') ?? DEFAULT_LEAGUES.join(',')).split(',');
  const debug = flag('debug');
  mkdirSync(join(root, 'data/raw'), { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/Helsinki', viewport: { width: 1280, height: 1800 } });
  const page = await ctx.newPage();
  const rows: OddsRow[] = [];
  try {
    const html = arg('html');
    if (html) {
      await page.setContent(readFileSync(html, 'utf8'));
      rows.push(...parseRows(await snapshot(page), 'file'));
    } else {
      for (const league of leagues) {
        try {
          await page.goto(fixturesUrl(league), { waitUntil: 'domcontentloaded', timeout: 30000 });
          await dismissGates(page);
          // Kertoimet täyttyvät JS:llä: odota että jokin solu sisältää desimaaliluvun (ei kaadeta jos ei tule)
          await page.waitForFunction(() => [...document.querySelectorAll('td')].some((td) => /^\d{1,3}[.,]\d{1,3}$/.test((td.textContent || '').trim()) || td.hasAttribute('data-odd')), undefined, { timeout: 12000 }).catch(() => {});
          const found = parseRows(await snapshot(page), league);
          console.log(`  ${league}: ${found.length} riviä kertoimineen`);
          rows.push(...found);
          if (debug) {
            const base = join(root, 'data/raw', `odds-${league.replace(/\W+/g, '-')}`);
            writeFileSync(`${base}.html`, await page.content());
            await page.screenshot({ path: `${base}.png`, fullPage: false });
          }
        } catch (e) {
          console.warn(`  ⚠ ${league}: ${(e as Error).message}`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  for (const id of ids) {
    const coupon = load(id);
    const { matched, unmatched } = matchFixtures(coupon.matches, rows);
    const outPath = join(root, 'data/odds', `${id}.json`);
    mkdirSync(join(root, 'data/odds'), { recursive: true });
    // Yhdistä aiempaan: uusi löytö korvaa, täsmäämättömät säilyvät edelliseltä ajolta
    const prev = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, 'utf8')) as { matches: Array<{ n: number }> }) : { matches: [] };
    const merged = [...prev.matches.filter((m) => !matched.some((x) => x.n === m.n)), ...matched].sort((a, b) => a.n - b.n);
    if (merged.length === 0) {
      console.log(`${id}: ei yhtään kerrointa (rivejä yhteensä ${rows.length}). Aja --debug nähdäksesi sivut.`);
      continue;
    }
    writeFileSync(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), source: 'betexplorer.com (Playwright, keskimääräiset kertoimet)', matches: merged }, null, 2) + '\n');
    console.log(`${id}: kertoimet ${matched.length}/${coupon.matches.length} ottelulle tästä ajosta (${merged.length} yhteensä).${unmatched.length ? ' Ei löytynyt: ' + unmatched.join(', ') : ''}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Aamun kertoimet ilman API-avainta: BetExplorerin päiväsivu (staattinen HTML, kaikki päivän ottelut) → 1X2-kertoimet
// → täsmäytys kuponin otteluihin → data/odds/<id>.json. Selainta ei tarvita.
//
// Käyttö:
//   npm run scrape:odds [-- --id <kuponki>] [-- --debug]
//   npm run scrape:odds -- --html sivu.html          (jäsennä tallennettu päiväsivu, ei verkkoa)
//   npm run scrape:odds -- --playwright [--leagues england/championship,spain/laliga]   (lisäksi liigojen ottelulistat selaimella;
//                                                    vaatii: npx playwright install chromium)
// --debug tallentaa päiväsivujen HTML:n kansioon data/raw/. Exit: 0 ok (myös "ei kertoimia löytynyt"), 1 virhe.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { DEFAULT_LEAGUES, ROW_SNAPSHOT_SCRIPT, dayPageUrl, fixturesUrl, matchFixtures, parseDayPage, parseRows, type OddsRow, type RowSnapshot } from '../scrape/odds-table.js';
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

/** Valinnainen lisälähde: liigojen ottelulistat selaimella (vain kun --playwright tai --leagues). */
async function scrapeLeaguePages(leagues: string[], debug: boolean): Promise<OddsRow[]> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/Helsinki', viewport: { width: 1280, height: 1800 } });
  const page = await ctx.newPage();
  const rows: OddsRow[] = [];
  try {
    for (const league of leagues) {
      try {
        await page.goto(fixturesUrl(league), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await dismissGates(page);
        await page.waitForFunction(() => [...document.querySelectorAll('td')].some((td) => td.hasAttribute('data-odd') || td.querySelector('[data-odd]')), undefined, { timeout: 12000 }).catch(() => {});
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
  } finally {
    await browser.close();
  }
  return rows;
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
        .filter((i) => {
          const c = load(i);
          if (c.matches.every((m) => m.result)) return false;
          // vain tulevat kierrokset (sulkeutuminen tulevaisuudessa tai, jos aikaa ei tiedetä, päivä tänään tai myöhemmin)
          return c.closesAt ? Date.parse(c.closesAt) > Date.now() : c.date >= new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date());
        });
  if (!ids.length) {
    console.log('Ei avointa kuponkia.');
    return;
  }
  const leagues = (arg('leagues') ?? DEFAULT_LEAGUES.join(',')).split(',');
  const debug = flag('debug');
  mkdirSync(join(root, 'data/raw'), { recursive: true });

  const rows: OddsRow[] = [];
  const html = arg('html');
  if (html) {
    rows.push(...parseDayPage(readFileSync(html, 'utf8')));
    console.log(`  ${html}: ${rows.length} riviä kertoimineen`);
  } else {
    // Päiväsivut: kuponkien pelipäivä ja sitä seuraava päivä (myöhäiset ottelut), jokainen päivä vain kerran
    const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' });
    const days = new Set<string>();
    for (const id of ids) {
      const c = load(id);
      const first = c.closesAt ? fmt.format(new Date(c.closesAt)) : c.date;
      days.add(first);
      days.add(fmt.format(new Date(Date.parse(`${first}T12:00:00Z`) + 86400000)));
    }
    for (const day of [...days].sort()) {
      const [y, m, d] = day.split('-').map(Number) as [number, number, number];
      try {
        // kohtelias tahti + yksi uusinta (429/5xx)
        let res = await fetch(dayPageUrl(y, m, d), { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Ihanus1.0; +https://github.com/SamppaFIN/Ihanus1.0)', 'accept-language': 'en' } });
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 5000));
          res = await fetch(dayPageUrl(y, m, d), { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Ihanus1.0; +https://github.com/SamppaFIN/Ihanus1.0)', 'accept-language': 'en' } });
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, 1500));
        const text = await res.text();
        const found = parseDayPage(text);
        console.log(`  ${day}: ${found.length} ottelua kertoimineen`);
        rows.push(...found);
        if (debug) writeFileSync(join(root, 'data/raw', `odds-day-${day}.html`), text);
      } catch (e) {
        console.warn(`  ⚠ ${day}: ${(e as Error).message}`);
      }
    }
    if (flag('playwright') || arg('leagues')) rows.push(...(await scrapeLeaguePages(leagues, debug)));
  }

  for (const id of ids) {
    const coupon = load(id);
    const { matched, unmatched } = matchFixtures(coupon.matches, rows);
    const outPath = join(root, 'data/odds', `${id}.json`);
    mkdirSync(join(root, 'data/odds'), { recursive: true });
    // Yhdistä aiempaan: uusi löytö korvaa, täsmäämättömät säilyvät edelliseltä ajolta
    const prev = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, 'utf8')) as { matches: Array<{ n: number }> }) : { matches: [] };
    // (vain järkevät vanhat kertoimet: kolmen kertoimen käänteislukujen summa 0,98–1,4 — muuten hylätään)
    const sane = (m: unknown) => {
      const o = (m as { odds?: number[] }).odds;
      if (!Array.isArray(o) || o.length !== 3 || o.some((x) => !(x > 1))) return false;
      const sum = o.reduce((t, x) => t + 1 / x, 0);
      return sum >= 0.98 && sum <= 1.4;
    };
    const merged = [...prev.matches.filter((m) => sane(m) && !matched.some((x) => x.n === m.n)), ...matched].sort((a, b) => a.n - b.n);
    if (merged.length === 0) {
      console.log(`${id}: ei yhtään kerrointa (rivejä yhteensä ${rows.length}). Aja --debug nähdäksesi sivut.`);
      continue;
    }
    writeFileSync(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), source: 'betexplorer.com (päiväsivu, keskimääräiset kertoimet)', matches: merged }, null, 2) + '\n');
    console.log(`${id}: kertoimet ${matched.length}/${coupon.matches.length} ottelulle tästä ajosta (${merged.length} yhteensä).${unmatched.length ? ' Ei löytynyt: ' + unmatched.join(', ') : ''}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

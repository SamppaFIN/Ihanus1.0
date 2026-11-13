// Kertoimet ilman API-avainta: Playwright lukee julkisen kerroinsivuston (BetExplorer) ottelulistat.
//
// Selaimessa ajetaan vain pieni, tyhmä serialisointi (ROW_SNAPSHOT_SCRIPT: jokaisen taulukkorivin solut),
// ja kaikki tulkinta on tässä tiedostossa puhtaina funktioina → testattavissa ilman selainta.
// DOM tarkistettu oikeasta sivusta 13.11.2026: <tr> = aika | nimipari (a.in-match) | tyhjä | bookmakers-lukumäärä |
// kolme td.table-main__odds (data-odd napissa). Tulkinta on silti rakenneriippumaton: nimipari "A - B" + data-odd-solut
// (tai tekstilukujen viimeiset kolme) + kertoimien järkevyystarkistus.

import { bestMatch, nameScore } from './names.js';
import type { CouponMatch } from '../engine/types.js';

export interface RowSnapshot {
  cells: Array<{ text: string; odd: string | null }>;
}

export interface OddsRow {
  home: string;
  away: string;
  odds: [number, number, number];
  /** Sivun näyttämä aika-teksti ("21.11. 13:30", "Today 20:00"), jos löytyi */
  when: string | null;
  league: string;
  /** Ottelun oma sivu (lähdelinkki), jos tiedetään */
  url?: string;
}

/** Ajetaan sivun kontekstissa (page.evaluate): rivit soluiksi. Ei tulkintaa. */
export const ROW_SNAPSHOT_SCRIPT = `
  [...document.querySelectorAll('tr')].map((tr) => ({
    cells: [...tr.querySelectorAll('td,th')].map((c) => ({
      text: (c.textContent || '').replace(/\\s+/g, ' ').trim(),
      odd: c.getAttribute('data-odd') || (c.querySelector('[data-odd]') && c.querySelector('[data-odd]').getAttribute('data-odd')) || null,
    })),
  }))
`;

const PAIR_RE = /^(.+?)\s+-\s+(.+)$/;
const LETTERS = /[A-Za-zÅÄÖåäö]/;
const NUM_RE = /^\d{1,3}([.,]\d{1,3})?$/;
const WHEN_RE = /(\d{1,2}\.\d{1,2}\.?(\s+\d{1,2}:\d{2})?|today|tomorrow|tänään|huomenna|\d{1,2}:\d{2})/i;

const toOdd = (s: string): number | null => {
  if (!NUM_RE.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return n > 1.0 && n < 200 ? n : null;
};

/** Yksi rivi → ottelu + kertoimet tai null (otsikkorivit, tulosrivit, rivit ilman kertoimia). */
export function parseRow(row: RowSnapshot, league: string): OddsRow | null {
  const pairCell = row.cells.find((c) => {
    const m = c.text.match(PAIR_RE);
    return m != null && LETTERS.test(m[1]!) && LETTERS.test(m[2]!);
  });
  if (!pairCell) return null;
  const m = pairCell.text.match(PAIR_RE)!;
  // BetExplorerin oikea rakenne (tarkistettu 13.11.2026): ottelun jälkeen on "bookmakers"-sarake, jonka teksti on
  // pelkkä kokonaisluku (esim. "9" = vedonvälittäjien määrä) ja vasta sen jälkeen kolme kerroinsolua (data-odd).
  // Siksi: jos data-odd-soluja on ≥ 3, käytetään vain niitä; muuten tekstiluvuista otetaan VIIMEISET kolme.
  const attr = row.cells.filter((c) => c !== pairCell && c.odd != null && toOdd(c.odd) != null).map((c) => toOdd(c.odd!)!);
  let odds: number[];
  if (attr.length >= 3) odds = attr.slice(0, 3);
  else {
    const txt = row.cells.filter((c) => c !== pairCell).map((c) => toOdd(c.text)).filter((v): v is number => v != null);
    odds = txt.length > 3 ? txt.slice(-3) : txt;
  }
  if (odds.length < 3) return null;
  // Järkevyystarkistus: 1X2-kertoimien käänteislukujen summa on käytännössä 1,0–1,35 (marginaali). Muu = väärät solut.
  const overround = 1 / odds[0]! + 1 / odds[1]! + 1 / odds[2]!;
  if (overround < 0.98 || overround > 1.4) return null;
  const whenCell = [...row.cells].reverse().find((c) => c !== pairCell && WHEN_RE.test(c.text) && toOdd(c.text) == null);
  // Ottelun tulos ("2:1") ei ole kerroin, ja pelatut ottelut jätetään pois: tulosrivillä on kolme lukua mutta myös tulos
  if (row.cells.some((c) => /^\d{1,2}:\d{1,2}$/.test(c.text))) return null;
  return {
    home: m[1]!.trim(),
    away: m[2]!.trim(),
    odds: [odds[0]!, odds[1]!, odds[2]!],
    when: whenCell?.text ?? null,
    league,
  };
}

export function parseRows(rows: readonly RowSnapshot[], league: string): OddsRow[] {
  return rows.map((r) => parseRow(r, league)).filter((x): x is OddsRow => x !== null);
}

export interface MatchedOdds {
  n: number;
  odds: [number, number, number];
  event: string;
  league: string;
  url?: string;
}

/**
 * Kuponin ottelut → rivit. Molempien joukkueiden pitää täsmätä (≥ 0,75) ja paras pari voittaa selvästi;
 * muuten ottelu jää täsmäämättä (ei arvata — väärä kerroin on pahempi kuin puuttuva).
 */
export function matchFixtures(matches: readonly CouponMatch[], rows: readonly OddsRow[]): { matched: MatchedOdds[]; unmatched: number[] } {
  const matched: MatchedOdds[] = [];
  const unmatched: number[] = [];
  for (const m of matches) {
    const scored = rows
      .map((r) => ({ r, s: Math.min(nameScore(m.home, r.home), nameScore(m.away, r.away)) }))
      .filter((x) => x.s >= 0.75)
      .sort((a, b) => b.s - a.s);
    const best = scored[0];
    const second = scored[1];
    if (best && (!second || best.s - second.s >= 0.1 || sameFixture(best.r, second.r))) {
      matched.push({ n: m.n, odds: best.r.odds, event: `${best.r.home} - ${best.r.away}`, league: best.r.league, ...(best.r.url ? { url: best.r.url } : {}) });
    } else unmatched.push(m.n);
  }
  return { matched, unmatched };
}

/**
 * BetExplorerin päiväsivu (https://www.betexplorer.com/?year=Y&month=M&day=D): kaikki päivän ottelut yhdellä
 * staattisella sivulla, ei selainta tarvita. Rakenne (tarkistettu 13.11.2026):
 *   <ul class="table-main__matchInfo" data-dt="15,11,2026,18,00"> … <a href="/football/<maa>/<sarja>/<a>-<b>/<id>/">
 *   <p class="particiantWidthMobile …">Koti</p> … <p …>Vieras</p> … kolme × data-odd (1, X, 2) …
 * Palauttaa vain jalkapallon (href alkaa /football/) rivit, joilla on kolme järkevää kerrointa.
 */
export function parseDayPage(html: string): OddsRow[] {
  const out: OddsRow[] = [];
  const seen = new Set<string>();
  for (const block of html.split('<ul class="table-main__matchInfo"').slice(1)) {
    const link = block.match(/href="(\/football\/([^"]+?)\/[^\/"]+\/[A-Za-z0-9]{6,12}\/)"/);
    if (!link) continue;
    // sivu toistaa saman ottelun (mobiili/työpöytä) → kerran per ottelu-URL
    if (seen.has(link[1]!)) continue;
    seen.add(link[1]!);
    const names = [...block.matchAll(/<p class="particiantWidthMobile[^"]*">\s*([^<]+?)\s*<\/p>/g)].map((m) => m[1]!.trim());
    if (names.length < 2) continue;
    const odds = [...block.matchAll(/data-odd="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1])).slice(0, 3);
    if (odds.length < 3 || odds.some((o) => !(o > 1.0 && o < 1000))) continue;
    const overround = 1 / odds[0]! + 1 / odds[1]! + 1 / odds[2]!;
    if (overround < 0.98 || overround > 1.4) continue;
    const dt = block.match(/data-dt="(\d{1,2}),(\d{1,2}),(\d{4}),(\d{1,2}),(\d{2})"/);
    out.push({
      home: decodeBasic(names[0]!),
      away: decodeBasic(names[1]!),
      odds: [odds[0]!, odds[1]!, odds[2]!],
      when: dt ? `${Number(dt[1])}.${Number(dt[2])}. ${String(dt[4]).padStart(2, '0')}:${dt[5]}` : null,
      league: link[2]!,
      url: `https://www.betexplorer.com${link[1]}`,
    });
  }
  return out;
}

const decodeBasic = (s: string): string => s.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');

export const dayPageUrl = (y: number, m: number, d: number): string => `https://www.betexplorer.com/?year=${y}&month=${m}&day=${d}`;

const sameFixture = (a: OddsRow, b: OddsRow) => a.home === b.home && a.away === b.away;

/** Oletusliigat (BetExplorer-polut): Vakion tyypillisimmät sarjat. Ohitettavissa --leagues. */
export const DEFAULT_LEAGUES = [
  'england/premier-league',
  'england/championship',
  'england/league-one',
  'england/league-two',
  'spain/laliga',
  'italy/serie-a',
  'germany/bundesliga',
  'france/ligue-1',
  'finland/veikkausliiga',
  'england/efl-trophy',
];

export const fixturesUrl = (league: string): string => `https://www.betexplorer.com/football/${league}/fixtures/`;

export { bestMatch };

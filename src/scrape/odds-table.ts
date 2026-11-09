// Kertoimet ilman API-avainta: Playwright lukee julkisen kerroinsivuston (BetExplorer) ottelulistat.
//
// Selaimessa ajetaan vain pieni, tyhmä serialisointi (ROW_SNAPSHOT_SCRIPT: jokaisen taulukkorivin solut),
// ja kaikki tulkinta on tässä tiedostossa puhtaina funktioina → testattavissa ilman selainta.
// HUOM: sivuston oikeaa DOM-rakennetta ei ole voitu tarkistaa kehitysympäristöstä (verkko rajattu);
// tulkinta on tehty tarkoituksella rakenneriippumattomaksi (nimipari "A - B" + kolme desimaalilukua riviltä).

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
  const odds: number[] = [];
  for (const c of row.cells) {
    if (c === pairCell) continue;
    const v = c.odd != null ? toOdd(c.odd) : toOdd(c.text);
    if (v != null) odds.push(v);
  }
  if (odds.length < 3) return null;
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
      matched.push({ n: m.n, odds: best.r.odds, event: `${best.r.home} - ${best.r.away}`, league: best.r.league });
    } else unmatched.push(m.n);
  }
  return { matched, unmatched };
}

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
];

export const fixturesUrl = (league: string): string => `https://www.betexplorer.com/football/${league}/fixtures/`;

export { bestMatch };

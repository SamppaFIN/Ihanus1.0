// Kertoimet The Odds API:sta (v4). Muoto perustuu palvelun dokumentaatioon (h2h-markkina,
// outcomes: joukkueen nimi tai "Draw") — EI ole testattu elävää rajapintaa vasten tästä ympäristöstä;
// muunnos on testattu dokumentaation mukaisella näytteellä.

import { bestMatch } from './names.js';
import type { CouponMatch } from '../engine/types.js';

export interface OddsApiEvent {
  id?: string;
  home_team: string;
  away_team: string;
  commence_time?: string;
  bookmakers: Array<{
    key: string;
    markets: Array<{ key: string; outcomes: Array<{ name: string; price: number }> }>;
  }>;
}

export interface MatchedOdds {
  n: number;
  odds: [number, number, number];
  event: string;
  bookmaker: string;
  commence?: string;
}

/** Kirjanpitäjän h2h-kertoimet [koti, tasa, vieras] tai null jos puuttuu. */
export function h2h(ev: OddsApiEvent, preferred: readonly string[]): { odds: [number, number, number]; bookmaker: string } | null {
  const order = [...preferred, ...ev.bookmakers.map((b) => b.key)];
  for (const key of order) {
    const b = ev.bookmakers.find((x) => x.key === key);
    const m = b?.markets.find((x) => x.key === 'h2h');
    if (!m) continue;
    const home = m.outcomes.find((o) => o.name === ev.home_team)?.price;
    const away = m.outcomes.find((o) => o.name === ev.away_team)?.price;
    const draw = m.outcomes.find((o) => o.name.toLowerCase() === 'draw')?.price;
    if (home && draw && away) return { odds: [home, draw, away], bookmaker: key };
  }
  return null;
}

export function matchEvents(
  matches: readonly CouponMatch[],
  events: readonly OddsApiEvent[],
  preferred: readonly string[] = ['pinnacle'],
): { matched: MatchedOdds[]; unmatched: number[] } {
  const homes = [...new Set(events.map((e) => e.home_team))];
  const aways = [...new Set(events.map((e) => e.away_team))];
  const matched: MatchedOdds[] = [];
  const unmatched: number[] = [];
  for (const m of matches) {
    const h = bestMatch(m.home, homes)?.candidate;
    const a = bestMatch(m.away, aways)?.candidate;
    const ev = h && a ? events.find((e) => e.home_team === h && e.away_team === a) : undefined;
    const o = ev ? h2h(ev, preferred) : null;
    if (ev && o) matched.push({ n: m.n, odds: o.odds, event: `${ev.home_team} - ${ev.away_team}`, bookmaker: o.bookmaker, commence: ev.commence_time });
    else unmatched.push(m.n);
  }
  return { matched, unmatched };
}

export const DEFAULT_SPORTS = ['soccer_epl', 'soccer_efl_champ', 'soccer_england_league1', 'soccer_england_league2'];

export async function fetchEvents(sport: string, apiKey: string, f: typeof fetch = fetch): Promise<OddsApiEvent[]> {
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${encodeURIComponent(apiKey)}&regions=eu&markets=h2h&oddsFormat=decimal`;
  const res = await f(url);
  if (!res.ok) throw new Error(`The Odds API ${sport}: HTTP ${res.status}`);
  return (await res.json()) as OddsApiEvent[];
}

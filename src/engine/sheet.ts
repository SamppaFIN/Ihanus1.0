// Tilastomalli käsintehdystä taulukosta (Samin paperimalli):
// joukkueen sijoitus ja ottelutilasto — viime kauden koti-/vierasosuus, tämän kauden
// kokonaistilasto ja kolme viimeistä ottelua. Tulos: 1X2-todennäköisyydet.
//
// Menetelmä (kaikki vakiot ovat säädettäviä, ks. SHEET_DEFAULTS):
//   rating = w·maaliero/peli (tämä kausi) + (1−w)·0.8·(maaliero/peli viime kauden venue-tilasto ± sarjanvaihtokorjaus) + muotobonus
//   w = pelatut / (pelatut + 9)               ← kauden alussa luotetaan viime kauteen
//   gd = rating(koti) − rating(vieras) + kotietu
//   λ_koti = 1.3 + gd/2,  λ_vieras = 1.3 − gd/2  → Poisson (Dixon–Coles) → 1X2
//   lopuksi 25 % kutistus sarjan keskiarvoon, koska otos on pieni.
//
// Eri sarjatasojen ottelut (esim. EFL Trophy: League One vs League Two): jos molemmilla joukkueilla on
// `tier`, ylempää sarjaa pelaavalle lisätään tierGap maalia/ottelu per sarjataso. Se on karkea,
// validoimaton oletus; ilman `tier`-kenttiä (kuten 24.10. taulukko) mikään ei muutu.

import { outcomeProbs } from './poisson.js';
import { normalize } from './prob.js';
import type { Triple } from './types.js';

export interface Record5 {
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
}

export interface TeamSheet {
  name: string;
  /** Viime kauden tilasto kotijoukkueelle KOTONA, vierasjoukkueelle VIERAISSA. null = ei luettavissa. */
  lastSeasonVenue: Record5 | null;
  /** Tämän kauden kokonaistilasto */
  thisSeason: Record5 | null;
  /** Viimeisten otteluiden pisteet (3/1/0), uusin viimeisenä */
  recentPts?: number[];
  /** Nousija/putoaja: viime kauden luvut ovat toisesta sarjasta */
  leagueChange?: 'promoted' | 'relegated' | null;
  /**
   * Sarjataso tällä kaudella (1 = Valioliiga, 2 = Championship, 3 = League One, 4 = League Two,
   * 5 = National League). Käytetään vain, kun molempien joukkueiden taso tiedetään.
   */
  tier?: number | null;
}

export const SHEET_DEFAULTS = {
  priorMatches: 9,
  lastSeasonKeep: 0.8,
  promotedAdj: -0.8,
  relegatedAdj: 0.6,
  formWeight: 0.08,
  avgPointsPerGame: 1.4,
  homeAdvantage: 0.3,
  /** Maalia/ottelu per sarjataso, kun joukkueet pelaavat eri sarjoissa (oletus, ei validoitu) */
  tierGap: 0.5,
  totalGoals: 2.6,
  shrinkToBase: 0.25,
  base: [0.43, 0.27, 0.3] as Triple,
};
export type SheetConfig = typeof SHEET_DEFAULTS;

const games = (r: Record5) => r.w + r.d + r.l;
const gdPerGame = (r: Record5) => (r.gf - r.ga) / Math.max(1, games(r));

export function teamRating(t: TeamSheet, cfg: SheetConfig = SHEET_DEFAULTS): number {
  const ts = t.thisSeason;
  const ls = t.lastSeasonVenue;
  const nTs = ts ? games(ts) : 0;
  const wTs = nTs / (nTs + cfg.priorMatches);
  const gTs = ts ? gdPerGame(ts) : 0;
  let gLs = ls ? gdPerGame(ls) : 0;
  if (ls && t.leagueChange === 'promoted') gLs += cfg.promotedAdj;
  if (ls && t.leagueChange === 'relegated') gLs += cfg.relegatedAdj;
  const form = t.recentPts && t.recentPts.length
    ? (t.recentPts.reduce((a, b) => a + b, 0) / t.recentPts.length - cfg.avgPointsPerGame) * cfg.formWeight
    : 0;
  return wTs * gTs + (1 - wTs) * cfg.lastSeasonKeep * gLs + form;
}

/** Sarjatasoero maalia/ottelu kotijoukkueen eduksi (0, jos jommankumman taso on tuntematon). */
export function tierEdge(home: TeamSheet, away: TeamSheet, cfg: SheetConfig = SHEET_DEFAULTS): number {
  if (home.tier == null || away.tier == null) return 0;
  return (away.tier - home.tier) * cfg.tierGap;
}

export function sheetProbs(home: TeamSheet, away: TeamSheet, cfg: SheetConfig = SHEET_DEFAULTS): Triple {
  const gd = Math.max(
    -1.8,
    Math.min(1.8, teamRating(home, cfg) - teamRating(away, cfg) + cfg.homeAdvantage + tierEdge(home, away, cfg)),
  );
  const half = cfg.totalGoals / 2;
  const raw = outcomeProbs(Math.max(0.3, half + gd / 2), Math.max(0.3, half - gd / 2));
  const k = 1 - cfg.shrinkToBase;
  return normalize([0, 1, 2].map((i) => k * raw[i]! + (1 - k) * cfg.base[i]!));
}

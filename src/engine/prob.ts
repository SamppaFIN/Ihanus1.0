// Todennäköisyyslaskennan perusosat: normalisointi, devig, sekoitukset ja
// lopullisen "oma todennäköisyys" -arvion muodostus.

import type { CouponMatch, Triple } from './types.js';

export function normalize(t: readonly number[]): Triple {
  const s = (t[0] ?? 0) + (t[1] ?? 0) + (t[2] ?? 0);
  if (!(s > 0)) return [1 / 3, 1 / 3, 1 / 3];
  return [(t[0] ?? 0) / s, (t[1] ?? 0) / s, (t[2] ?? 0) / s];
}

/** Prosentit (esim. 64, 21, 16) → osuudet jotka summaavat 1:een. Yle pyöristää, summa on 99–101. */
export function fromPercents(p: readonly number[]): Triple {
  return normalize(p);
}

/** Kertoimet → implisiittiset todennäköisyydet ilman marginaalia (suhteellinen poisto). */
export function devig(odds: readonly [number, number, number]): Triple {
  if (odds.some((o) => !(o > 1))) throw new Error(`Virheellinen kerroin: ${odds.join('/')}`);
  return normalize(odds.map((o) => 1 / o));
}

/** Kirjanpitäjän kate: Σ(1/kerroin) − 1 */
export function margin(odds: readonly [number, number, number]): number {
  return odds.reduce((s, o) => s + 1 / o, 0) - 1;
}

export function blendLinear(a: Triple, b: Triple, weightA: number): Triple {
  return normalize([0, 1, 2].map((i) => weightA * a[i]! + (1 - weightA) * b[i]!));
}

/**
 * Geometrinen sekoitus p^t · q^(1−t). t = 1 → pelkkä p, t = 0 → pelkkä q.
 * Käytetään kutistamaan oma arvio kohti pelijakaumaa: jakauma on sekin tietoa
 * (satoja tuhansia pelaajia), eikä oma malli saa oikeuttaa äärimmäisiä
 * poikkeamia pelkän pienen otoksen perusteella.
 */
export function geoMix(p: Triple, q: Triple, trust: number): Triple {
  return normalize([0, 1, 2].map((i) => Math.pow(Math.max(p[i]!, 1e-6), trust) * Math.pow(Math.max(q[i]!, 1e-6), 1 - trust)));
}

export interface FuseConfig {
  /** Tilastomallin paino kun myös markkina on saatavilla (Toni1.0: 0.35) */
  modelWeight: number;
  /**
   * Luottamus omaan perusarvioon suhteessa pelijakaumaan (0..1), lähteen laadun mukaan.
   * Markkina (Pinnacle-kertoimet) on tarkin lähde; yksittäinen käsin tehty taulukkomalli on heikko
   * ja optimoija hakee juuri niitä merkkejä joissa mallin virhe on suurin ("voittajan kirous"),
   * joten sitä kutistetaan vahvasti.
   */
  trust: { model: number; market: number; 'model+market': number };
}
export const DEFAULT_FUSE: FuseConfig = { modelWeight: 0.35, trust: { model: 0.4, market: 0.85, 'model+market': 0.85 } };

export interface Fused {
  /** Lopullinen arvio jonka kanssa rivit pisteytetään */
  p: Triple;
  /** Mistä arvio syntyi */
  basis: 'model+market' | 'market' | 'model' | 'crowd';
  /** Oma perusarvio ennen jakaumaan kutistamista */
  base: Triple | null;
}

/** trustScale < 1 antaa varovaisemman arvion (enemmän painoa pelijakaumalle) herkkyysanalyysiin. */
export function fuse(m: CouponMatch, cfg: FuseConfig = DEFAULT_FUSE, trustScale = 1): Fused {
  let base: Triple | null = null;
  let basis: Fused['basis'] = 'crowd';
  if (m.model && m.market) {
    base = blendLinear(m.model, m.market, cfg.modelWeight);
    basis = 'model+market';
  } else if (m.market) {
    base = m.market;
    basis = 'market';
  } else if (m.model) {
    base = m.model;
    basis = 'model';
  }
  if (!base || basis === 'crowd') {
    if (!m.crowd) throw new Error(`Ottelulla ${m.n} ei ole mitään todennäköisyyslähdettä`);
    return { p: m.crowd, basis: 'crowd', base: null };
  }
  const p = m.crowd ? geoMix(base, m.crowd, cfg.trust[basis] * trustScale) : base;
  return { p, basis, base };
}

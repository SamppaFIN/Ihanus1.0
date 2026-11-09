// Rivin ja järjestelmän odotusarvo pari-mutuel-potissa.
//
// Idea: voitto riippuu paitsi siitä osuuko rivi (oma todennäköisyys p) myös siitä
// kuinka moni muu osuu samaan luokkaan (pelijakauma q). Pari-mutuel-potti jaetaan
// kaikkien voittajien kesken, joten harvinainen osuma maksaa moninkertaisesti.
//
// Mallinnus (tarkka, ei otantaa):
//  1. Käydään läpi KAIKKI tulosvektorit o joilla järjestelmämme osuu vähintään 10 ottelua
//     (syvyyshaku, jossa katkaistaan kun pakollisia virheitä > 3). Näitä on tuhansia–satoja
//     tuhansia, ei 3^13 = 1,6 miljoonaa; Monte Carlo ei kelpaa koska 13 oikein -osuma on ~1/10 000
//     ja potti satoja tuhansia → EV-estimaatti heiluisi kohinasta.
//  2. Muiden rivien jakauma: jokainen muu rivi on riippumaton, merkki i valitaan q_i:n mukaan.
//     Muiden rivien odotettu määrä luokassa "13−j oikein" on  N · [x^j] Π_i (q_i(o_i) + (1−q_i(o_i))·x).
//  3. Omat rivimme (järjestelmä = tulo valinta-joukoista): [x^j] Π_i (hit_i + (|S_i|−hit_i)·x).
//  4. Muiden voittajien lkm K ~ Poisson(λ_j); meidän osuus E[pool / (omat + K)] (+ takuupotti).

import type { Triple } from './types.js';
import type { EvConfig } from './prize.js';

/** Valinta ottelua kohden bittimaskina: bit0 = '1', bit1 = 'X', bit2 = '2' */
export type Selection = number[];
const POP = [0, 1, 1, 2, 1, 2, 2, 3];
export const popcount = (m: number): number => POP[m & 7]!;
export const rowsOf = (s: Selection): number => s.reduce((a, m) => a * popcount(m), 1);

/** [x^0..x^3] kertoimet tulolle Π (a_i + b_i x), katkaistuna asteeseen 3 */
function polyProduct(a: ArrayLike<number>, b: ArrayLike<number>, n: number): [number, number, number, number] {
  let c0 = 1;
  let c1 = 0;
  let c2 = 0;
  let c3 = 0;
  for (let i = 0; i < n; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    c3 = c3 * ai + c2 * bi;
    c2 = c2 * ai + c1 * bi;
    c1 = c1 * ai + c0 * bi;
    c0 = c0 * ai;
  }
  return [c0, c1, c2, c3];
}

/**
 * Odotettu maksu yhtä meidän voittorivia kohden: E[pool / (omat + K)], K ~ Poisson(lambda).
 * Kun ainoa voittaja on yksin, takuupotti (jos on) korvaa jaetun potin.
 */
export function payoutPerWinningRow(pool: number, ours: number, lambda: number, guarantee = 0): number {
  if (ours <= 0) return 0;
  if (ours === 1) {
    // E[pool/(1+K)] = pool·(1−e^−λ)/λ; yksin voittaessa takuupotti korvaa potin (K = 0, todennäköisyys e^−λ)
    const base = lambda < 1e-9 ? pool : (pool * (1 - Math.exp(-lambda))) / lambda;
    return base + Math.exp(-lambda) * (Math.max(pool, guarantee) - pool);
  }
  if (lambda > 60) {
    const m = ours + lambda;
    return pool / m + (pool * lambda) / (m * m * m); // 2. kertaluvun korjaus
  }
  const kmax = Math.ceil(lambda + 12 * Math.sqrt(lambda) + 30);
  let pk = Math.exp(-lambda);
  let sum = 0;
  for (let k = 0; k <= kmax; k++) {
    const w = ours + k;
    const pay = w === 1 ? Math.max(pool, guarantee) : pool / w;
    sum += pk * pay;
    pk *= lambda / (k + 1);
  }
  return sum;
}

export interface SystemStats {
  rows: number;
  costEur: number;
  /** Odotettu voitto euroina (kaikki luokat) */
  evEur: number;
  /** evEur / costEur */
  roi: number;
  /** Rivin odotusarvo suhteessa keskimääräiseen riviin (1.0 = keskimääräinen rivi) */
  valueMultiple: number;
  /** Todennäköisyys saada vähintään luokka 13, 12, 11, 10 oikein */
  pAtLeast: [number, number, number, number];
}

export function evaluate(sel: Selection, p: Triple[], q: Triple[], cfg: EvConfig): SystemStats {
  const n = sel.length;
  const rows = rowsOf(sel);
  const cnt = new Float64Array(n);
  for (let i = 0; i < n; i++) cnt[i] = popcount(sel[i]!);
  // Polynomien tila syvyyksittäin: O = omat rivit, C = muiden pelaajien rivit (osuuksina)
  const O = new Float64Array((n + 1) * 4);
  const C = new Float64Array((n + 1) * 4);
  O[0] = 1;
  C[0] = 1;
  let ev = 0;
  const at = [0, 0, 0, 0];

  const rec = (i: number, prob: number, forced: number): void => {
    const o = i * 4;
    if (i === n) {
      let cum = 0;
      for (let j = 0; j < 4; j++) {
        const ours = O[o + j]!;
        cum += ours;
        if (cum > 0) at[j]! += prob;
        if (ours > 0) ev += prob * ours * payoutPerWinningRow(cfg.pools[j]!, ours, cfg.otherRows * C[o + j]!, j === 0 ? cfg.guaranteeEur : 0);
      }
      return;
    }
    const si = sel[i]!;
    const pi = p[i]!;
    const qi = q[i]!;
    const n4 = o + 4;
    for (let out = 0; out < 3; out++) {
      const pr = pi[out]!;
      if (pr <= 0) continue;
      const hit = (si >> out) & 1;
      const nf = forced + (hit ? 0 : 1);
      if (nf > 3) continue;
      const a = hit;
      const b = cnt[i]! - hit;
      const qa = qi[out]!;
      const qb = 1 - qa;
      for (let j = 0; j < 4; j++) {
        O[n4 + j] = O[o + j]! * a + (j > 0 ? O[o + j - 1]! * b : 0);
        C[n4 + j] = C[o + j]! * qa + (j > 0 ? C[o + j - 1]! * qb : 0);
      }
      rec(i + 1, prob * pr, nf);
    }
  };
  rec(0, 1, 0);

  const costEur = rows * cfg.rowPriceEur;
  return {
    rows,
    costEur,
    evEur: ev,
    roi: costEur > 0 ? ev / costEur : 0,
    valueMultiple: rows > 0 ? ev / rows / cfg.avgRowEv : 0,
    pAtLeast: at as SystemStats['pAtLeast'],
  };
}

/** Toteutuneet osumat: montako riviä osui luokkiin 13, 12, 11, 10 oikein tuloksella `result` (indeksit 0|1|2). */
export function hitCounts(sel: Selection, result: number[]): [number, number, number, number] {
  const n = sel.length;
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const hit = (sel[i]! >> result[i]!) & 1;
    a[i] = hit;
    b[i] = popcount(sel[i]!) - hit;
  }
  return polyProduct(a, b, n);
}

/** Muiden pelaajien odotettu voittajamäärä luokittain tietylle tulokselle — vertailu toteutuneisiin voittajiin kalibrointia varten. */
export function expectedOtherWinners(q: Triple[], result: number[], otherRows: number): [number, number, number, number] {
  const n = q.length;
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const qi = q[i]![result[i]!]!;
    a[i] = qi;
    b[i] = 1 - qi;
  }
  const c = polyProduct(a, b, n);
  return c.map((x) => x * otherRows) as [number, number, number, number];
}

import { describe, expect, it } from 'vitest';
import { devig, fromPercents, fuse, geoMix, margin, normalize } from '../engine/prob.js';
import { outcomeProbs } from '../engine/poisson.js';
import { sheetProbs, SHEET_DEFAULTS, type TeamSheet } from '../engine/sheet.js';
import { evConfigFor, DEFAULT_PRIZE_MODEL } from '../engine/prize.js';
import {
  evaluate,
  expectedOtherWinners,
  hitCounts,
  payoutPerWinningRow,
  rowsOf,
  type Selection,
} from '../engine/ev.js';
import { optimize, describeSelection } from '../engine/optimize.js';
import type { Coupon, CouponMatch, Triple } from '../engine/types.js';

const sum = (t: readonly number[]) => t.reduce((a, b) => a + b, 0);

describe('prob', () => {
  it('devig palauttaa summan 1 ja marginaali on positiivinen', () => {
    const odds: [number, number, number] = [2.1, 3.4, 3.6];
    const p = devig(odds);
    expect(sum(p)).toBeCloseTo(1, 12);
    expect(margin(odds)).toBeGreaterThan(0);
    expect(p[0]).toBeGreaterThan(p[1]);
  });

  it('devig hylkkää kertoimen ≤ 1', () => {
    expect(() => devig([1, 3, 4])).toThrow();
  });

  it('fromPercents normalisoi Ylen pyöristetyt prosentit', () => {
    const p = fromPercents([64, 21, 16]); // summa 101
    expect(sum(p)).toBeCloseTo(1, 12);
    expect(p[0]).toBeCloseTo(64 / 101, 12);
  });

  it('normalize kestää nollavektorin', () => {
    expect(normalize([0, 0, 0])).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('geoMix: trust 1 → p, trust 0 → q', () => {
    const p: Triple = [0.5, 0.3, 0.2];
    const q: Triple = [0.2, 0.3, 0.5];
    expect(geoMix(p, q, 1)[0]).toBeCloseTo(0.5, 9);
    expect(geoMix(p, q, 0)[2]).toBeCloseTo(0.5, 9);
    const mid = geoMix(p, q, 0.5);
    expect(mid[0]).toBeCloseTo(mid[2], 9);
  });

  it('fuse: ilman omaa tietoa p = pelijakauma, muuten kutistaa kohti jakaumaa', () => {
    const base: CouponMatch = { n: 1, home: 'A', away: 'B', crowd: [0.6, 0.25, 0.15] };
    expect(fuse(base)).toMatchObject({ basis: 'crowd', p: [0.6, 0.25, 0.15] });
    const withMarket = fuse({ ...base, market: [0.4, 0.3, 0.3] });
    expect(withMarket.basis).toBe('market');
    expect(withMarket.p[0]).toBeGreaterThan(0.4);
    expect(withMarket.p[0]).toBeLessThan(0.6);
    expect(sum(withMarket.p)).toBeCloseTo(1, 12);
  });

  it('fuse heittää jos mitään lähdettä ei ole', () => {
    expect(() => fuse({ n: 1, home: 'A', away: 'B', crowd: null })).toThrow();
  });
});

describe('poisson', () => {
  it('summa 1 ja kotietu nostaa kotivoittoa', () => {
    const even = outcomeProbs(1.3, 1.3, -0.05);
    const homeish = outcomeProbs(1.6, 1.0, -0.05);
    expect(sum(even)).toBeCloseTo(1, 9);
    expect(even[0]).toBeCloseTo(even[2], 9);
    expect(homeish[0]).toBeGreaterThan(homeish[2]);
  });
});

describe('sheet', () => {
  const strong: TeamSheet = {
    name: 'Vahva',
    lastSeasonVenue: { w: 15, d: 2, l: 2, gf: 41, ga: 11 },
    thisSeason: { w: 6, d: 0, l: 1, gf: 11, ga: 5 },
    recentPts: [3, 3],
  };
  const weak: TeamSheet = {
    name: 'Heikko',
    lastSeasonVenue: { w: 4, d: 5, l: 10, gf: 17, ga: 31 },
    thisSeason: { w: 1, d: 2, l: 4, gf: 7, ga: 10 },
    recentPts: [3, 0, 1],
  };

  it('vahva koti vs heikko vieras → kotivoitto todennäköisin, summa 1', () => {
    const p = sheetProbs(strong, weak, SHEET_DEFAULTS);
    expect(sum(p)).toBeCloseTo(1, 9);
    expect(p[0]).toBeGreaterThan(p[1]);
    expect(p[0]).toBeGreaterThan(p[2]);
  });

  it('tiedoton joukkue ei kaada laskentaa', () => {
    const none: TeamSheet = { name: '?', lastSeasonVenue: null, thisSeason: null };
    const p = sheetProbs(none, none, SHEET_DEFAULTS);
    expect(sum(p)).toBeCloseTo(1, 9);
    expect(p[0]).toBeGreaterThan(p[2]); // kotietu
  });
});

describe('ev: polynomi ja osumat', () => {
  const n = 13;
  const all: Selection = Array(n).fill(0b111);

  it('täysi järjestelmä: osumat luokissa 13..10 = C(13,j)·2^j', () => {
    const res = Array(n).fill(0);
    const c = hitCounts(all, res);
    expect(rowsOf(all)).toBe(3 ** 13);
    expect(c[0]).toBe(1);
    expect(c[1]).toBe(13 * 2);
    expect(c[2]).toBe(78 * 4);
    expect(c[3]).toBe(286 * 8);
  });

  it('yksittäinen rivi: täysosuma [1,0,0,0], yksi virhe [0,1,0,0]', () => {
    const row: Selection = Array(n).fill(0b001);
    expect(hitCounts(row, Array(n).fill(0))).toEqual([1, 0, 0, 0]);
    const r = Array(n).fill(0);
    r[4] = 2;
    expect(hitCounts(row, r)).toEqual([0, 1, 0, 0]);
  });

  it('muiden odotettu voittajamäärä: q=1 oikealla merkillä → kaikki rivit täysosumia', () => {
    const q: Triple[] = Array(n).fill([1, 0, 0]);
    const w = expectedOtherWinners(q, Array(n).fill(0), 1000);
    expect(w[0]).toBeCloseTo(1000, 6);
    expect(w[1]).toBeCloseTo(0, 6);
  });

  it('muiden odotettu voittajamäärä summautuu binomiodotukseen', () => {
    // jokaisella ottelulla oikea merkki 0.5 → P(13 oikein) = 0.5^13
    const q: Triple[] = Array(n).fill([0.5, 0.25, 0.25]);
    const w = expectedOtherWinners(q, Array(n).fill(0), 1_000_000);
    expect(w[0]).toBeCloseTo(1_000_000 * 0.5 ** 13, 6);
    expect(w[1]).toBeCloseTo(1_000_000 * 13 * 0.5 ** 12 * 0.5, 4);
  });
});

describe('ev: maksu per voittorivi', () => {
  it('λ = 0 → koko potti jaetaan omille riveille', () => {
    expect(payoutPerWinningRow(1000, 1, 0)).toBeCloseTo(1000, 9);
    expect(payoutPerWinningRow(1000, 4, 0)).toBeCloseTo(250, 9);
  });

  it('takuupotti korvaa jaetun potin vain kun voittaja on yksin', () => {
    expect(payoutPerWinningRow(1000, 1, 0, 5000)).toBeCloseTo(5000, 9);
    // ours=2 → ei koskaan yksin
    expect(payoutPerWinningRow(1000, 2, 0, 5000)).toBeCloseTo(500, 9);
  });

  it('laskee λ:n kasvaessa ja vastaa suuren λ:n approksimaatiota rajalla', () => {
    let prev = Infinity;
    for (const l of [0, 0.5, 2, 10, 40, 59]) {
      const v = payoutPerWinningRow(1000, 1, l);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
    const exactish = payoutPerWinningRow(1000, 1, 59.9); // Poisson-summa
    const approx = payoutPerWinningRow(1000, 1, 60.1); // approksimaatio
    expect(approx / exactish).toBeGreaterThan(0.97);
    expect(approx / exactish).toBeLessThan(1.0);
  });

  it('E[1/(1+K)] = (1−e^−λ)/λ suljettu muoto', () => {
    const l = 3.7;
    expect(payoutPerWinningRow(1, 1, l)).toBeCloseTo((1 - Math.exp(-l)) / l, 9);
  });
});

function toyCoupon(over: Partial<Coupon> = {}): Coupon {
  return {
    id: 'toy',
    date: '2026-01-01',
    label: 'toy',
    turnoverEur: 500_000,
    guaranteeEur: null,
    bonusPoolEur: null,
    rowPriceEur: 0.25,
    source: 'test',
    matches: [],
    ...over,
  };
}

describe('ev: evaluate (tarkka enumerointi)', () => {
  const n = 13;
  const p: Triple[] = Array.from({ length: n }, (_, i): Triple => (i % 3 === 0 ? [0.5, 0.28, 0.22] : i % 3 === 1 ? [0.3, 0.3, 0.4] : [0.42, 0.3, 0.28]));
  const q: Triple[] = p.map((t) => normalize([t[0] * 1.3, t[1] * 0.8, t[2] * 0.9]));
  const cfg = evConfigFor(toyCoupon(), DEFAULT_PRIZE_MODEL);

  it('on deterministinen (ei satunnaisuutta)', () => {
    const sel: Selection = p.map((t) => (t[0] >= t[2] ? 1 : 4));
    expect(evaluate(sel, p, q, cfg).evEur).toBe(evaluate(sel, p, q, cfg).evEur);
  });

  it('EV on lineaarinen potissa (ei takuuta)', () => {
    const sel: Selection = Array(n).fill(0b001);
    const base = evaluate(sel, p, q, cfg).evEur;
    const doubled = evaluate(sel, p, q, { ...cfg, pools: cfg.pools.map((x) => x * 2) as typeof cfg.pools }).evEur;
    expect(doubled / base).toBeCloseTo(2, 9);
  });

  it('kun muita pelaajia ei ole, EV = Σ potti_j · P(osuma luokkaan j) (analyyttinen)', () => {
    const lone = { ...cfg, otherRows: 1e-12 };
    const sel: Selection = p.map((t) => (t[0] >= t[2] ? 1 : 4));
    let c = [1, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const hit = sel[i] === 1 ? p[i]![0] : p[i]![2];
      const nc = [0, 0, 0, 0];
      for (let j = 0; j < 4; j++) {
        nc[j]! += c[j]! * hit;
        if (j + 1 < 4) nc[j + 1]! += c[j]! * (1 - hit);
      }
      c = nc;
    }
    const expected = c.reduce((s, pj, j) => s + pj * lone.pools[j]!, 0);
    expect(evaluate(sel, p, q, lone).evEur / expected).toBeCloseTo(1, 9);
  });

  it('täsmää raakaan 3^n-bruteforceen (omat rivit ja muiden rivit eksplisiittisesti)', () => {
    const m = 6;
    const pp: Triple[] = [[0.5, 0.3, 0.2], [0.3, 0.3, 0.4], [0.6, 0.25, 0.15], [0.35, 0.3, 0.35], [0.45, 0.3, 0.25], [0.2, 0.3, 0.5]];
    const qq: Triple[] = [[0.6, 0.25, 0.15], [0.25, 0.3, 0.45], [0.7, 0.2, 0.1], [0.3, 0.3, 0.4], [0.5, 0.28, 0.22], [0.3, 0.3, 0.4]];
    const c2 = { ...cfg, otherRows: 40, pools: [1000, 300, 90, 25] as typeof cfg.pools, guaranteeEur: 400 };
    const sel: Selection = [0b011, 0b100, 0b001, 0b110, 0b010, 0b101];
    const rowsOfSel: number[][] = [];
    const enumRows = (i: number, cur: number[]) => {
      if (i === m) return void rowsOfSel.push(cur.slice());
      for (let s = 0; s < 3; s++) if ((sel[i]! >> s) & 1) enumRows(i + 1, [...cur, s]);
    };
    enumRows(0, []);
    const all: number[][] = [];
    const enumAll = (i: number, cur: number[]) => {
      if (i === m) return void all.push(cur.slice());
      for (let s = 0; s < 3; s++) enumAll(i + 1, [...cur, s]);
    };
    enumAll(0, []);
    let ev = 0;
    for (const o of all) {
      const po = o.reduce((a, s, i) => a * pp[i]![s]!, 1);
      const ours = [0, 0, 0, 0];
      for (const r of rowsOfSel) {
        const mis = r.reduce((a, s, i) => a + (s === o[i] ? 0 : 1), 0);
        if (mis < 4) ours[mis]!++;
      }
      const lam = [0, 0, 0, 0];
      for (const r of all) {
        const mis = r.reduce((a, s, i) => a + (s === o[i] ? 0 : 1), 0);
        if (mis < 4) lam[mis]! += c2.otherRows * r.reduce((a, s, i) => a * qq[i]![s]!, 1);
      }
      for (let j = 0; j < 4; j++) {
        if (ours[j]! > 0) ev += po * ours[j]! * payoutPerWinningRow(c2.pools[j]!, ours[j]!, lam[j]!, j === 0 ? c2.guaranteeEur : 0);
      }
    }
    expect(evaluate(sel, pp, qq, c2).evEur).toBeCloseTo(ev, 9);
  });

  it('arvokerroin: sama todennäköisyys mutta vähemmän pelattu rivi on arvokkaampi', () => {
    const sel: Selection = Array(n).fill(0b001);
    const crowdLoves: Triple[] = Array(n).fill([0.7, 0.15, 0.15]);
    const crowdIgnores: Triple[] = Array(n).fill([0.2, 0.4, 0.4]);
    const pTrue: Triple[] = Array(n).fill([0.5, 0.25, 0.25]);
    const a = evaluate(sel, pTrue, crowdLoves, cfg);
    const b = evaluate(sel, pTrue, crowdIgnores, cfg);
    expect(b.valueMultiple).toBeGreaterThan(a.valueMultiple * 3);
  });

  it('pAtLeast on kumulatiivinen ja täsmää binomiin yhdellä rivillä', () => {
    const sel: Selection = Array(n).fill(0b001);
    const pTrue: Triple[] = Array(n).fill([0.5, 0.25, 0.25]);
    const s = evaluate(sel, pTrue, q, cfg);
    for (let j = 1; j < 4; j++) expect(s.pAtLeast[j]!).toBeGreaterThanOrEqual(s.pAtLeast[j - 1]!);
    expect(s.pAtLeast[0]).toBeCloseTo(0.5 ** 13, 12);
    const binom = (k: number) => {
      let c = 1;
      for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
      return c;
    };
    const p10 = [0, 1, 2, 3].reduce((a, k) => a + binom(k) * 0.5 ** (n - k) * 0.5 ** k, 0);
    expect(s.pAtLeast[3]).toBeCloseTo(p10, 12);
  });

  it('yksi rivi: arvokerroin on positiivinen ja toistettava', () => {
    const sel: Selection = Array(n).fill(0b001);
    const x = evaluate(sel, p, q, cfg);
    const y = evaluate(sel, p, q, cfg);
    expect(x.valueMultiple).toBe(y.valueMultiple);
    expect(x.valueMultiple).toBeGreaterThan(0);
  });
});

describe('optimize', () => {
  const n = 13;
  const p: Triple[] = Array.from({ length: n }, (_, i): Triple => (i % 2 ? [0.36, 0.3, 0.34] : [0.55, 0.26, 0.19]));
  const q: Triple[] = Array.from({ length: n }, (_, i): Triple => (i % 2 ? [0.2, 0.2, 0.6] : [0.75, 0.15, 0.1]));
  const cfg = evConfigFor(toyCoupon(), DEFAULT_PRIZE_MODEL);
  const steps = optimize(p, q, cfg, { maxCostEur: 6 });

  it('alkaa yhdestä rivistä ja kasvaa budjettiin asti', () => {
    expect(steps[0]!.stats.rows).toBe(1);
    expect(steps.length).toBeGreaterThan(2);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.stats.rows).toBeGreaterThan(steps[i - 1]!.stats.rows);
      expect(steps[i]!.stats.costEur).toBeLessThanOrEqual(6 + 1e-9);
    }
  });

  it('valinnat ovat edellisen laajennuksia (vain lisäyksiä)', () => {
    for (let i = 1; i < steps.length; i++) {
      for (let m = 0; m < n; m++) {
        expect(steps[i]!.selection[m]! & steps[i - 1]!.selection[m]!).toBe(steps[i - 1]!.selection[m]);
      }
    }
  });

  it('järjestelmän P(≥10 oikein) kasvaa askel askeleelta', () => {
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.stats.pAtLeast[3]).toBeGreaterThanOrEqual(steps[i - 1]!.stats.pAtLeast[3] - 0.01);
    }
  });

  it('describeSelection tuottaa merkkijonot', () => {
    const d = describeSelection(steps[0]!.selection);
    expect(d).toHaveLength(n);
    expect(d.every((s) => /^[1X2]+$/.test(s))).toBe(true);
  });
});

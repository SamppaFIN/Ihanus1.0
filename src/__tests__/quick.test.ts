import { describe, expect, it } from 'vitest';
import { quickTake, QUICK, type QuickInput } from '../pipeline/quick.js';
import type { TeamSheet } from '../engine/sheet.js';

const team = (name: string, tier: number, venue: [number, number, number, number, number], ov: [number, number, number, number, number], league: string): TeamSheet => ({
  name,
  tier,
  lastSeasonVenue: { w: 10, d: 6, l: 7, gf: 30, ga: 28 },
  thisSeason: { w: ov[0], d: ov[1], l: ov[2], gf: ov[3], ga: ov[4] },
  leagueChange: null,
  info: { league, pos: 5, venue: { w: venue[0], d: venue[1], l: venue[2], gf: venue[3], ga: venue[4] } },
});

const base = (o: Partial<QuickInput>): QuickInput => ({
  home: 'Koti',
  away: 'Vieras',
  p: [0.5, 0.27, 0.23],
  crowd: [0.5, 0.27, 0.23],
  market: null,
  ...o,
});

describe('quickTake', () => {
  it('antaa aina kolme merkkiä järjestyksessä 1, X, 2 ja rajaa perustelujen määrän', () => {
    const q = quickTake(base({}));
    expect(q.signs.map((s) => s.sign)).toEqual(['1', 'X', '2']);
    for (const s of q.signs) {
      expect(s.pros.length).toBeLessThanOrEqual(QUICK.maxPros);
      expect(s.cons.length).toBeLessThanOrEqual(QUICK.maxCons);
      for (const t of [...s.pros, ...s.cons]) expect(t.length).toBeGreaterThan(5);
    }
  });

  it('todennäköisin merkki saa tagin ja yhteenvedon', () => {
    const q = quickTake(base({ p: [0.6, 0.22, 0.18] }));
    expect(q.signs[0]!.tags.map((t) => t.text)).toContain('todennäköisin');
    expect(q.summary).toMatch(/^Todennäköisin: kotivoitto \(60 %\)/);
  });

  it('lähes tasan kärjessä: ei väitetä yhtä todennäköisimmäksi', () => {
    const q = quickTake(base({ p: [0.38, 0.24, 0.38] }));
    expect(q.signs[0]!.tags[0]!.text).toBe('yksi todennäköisimmistä');
    expect(q.signs[2]!.tags[0]!.text).toBe('yksi todennäköisimmistä');
    expect(q.summary).toMatch(/^Todennäköisimmät: kotivoitto ja vierasvoitto/);
  });

  it('aliarvostettu merkki: puoltaa-rivi kertoo pelaajien osuuden, ylipelattu suosikki: vastaan-rivi', () => {
    const q = quickTake(base({ p: [0.66, 0.19, 0.15], crowd: [0.82, 0.11, 0.07] }));
    expect(q.signs[1]!.tags.map((t) => t.text)).toContain('pelaajat aliarvostavat');
    expect(q.signs[1]!.pros.join(' ')).toContain('Vain 11 % pelaajista veikkaa tätä');
    expect(q.signs[0]!.tags.map((t) => t.text)).toContain('ylipelattu');
    expect(q.signs[0]!.cons.join(' ')).toContain('82 % pelaajista veikkaa tätä');
    expect(q.summary).toContain('Pelaajat aliarvostavat: tasapeli');
    expect(q.summary).toContain('Ylipelattu: kotivoitto');
  });

  it('kertoimet mukaan perusteluihin vain kun ne on annettu', () => {
    const none = quickTake(base({}));
    expect(none.signs.flatMap((s) => [...s.pros, ...s.cons]).some((t) => t.startsWith('Kertoimet'))).toBe(false);
    const withOdds = quickTake(base({ market: [0.7, 0.17, 0.13] }));
    expect(withOdds.signs[0]!.pros.join(' ')).toContain('Kertoimet antavat 70 %');
    expect(withOdds.signs[2]!.cons.join(' ')).toContain('Kertoimet antavat vain 13 %');
  });

  it('koti-/vierastilasto: voitoton vieras puoltaa kotivoittoa ja on vastaan vierasvoittoa', () => {
    const q = quickTake(base({
      home: 'Crewe',
      away: 'Wigan',
      homeSheet: team('Crewe', 4, [3, 4, 0, 12, 8], [5, 7, 2, 17, 17], 'League Two'),
      awaySheet: team('Wigan', 3, [0, 1, 6, 4, 12], [3, 2, 9, 11, 22], 'League One'),
    }));
    expect(q.signs[0]!.pros).toContain('Wigan: ei yhtään voittoa 7 vierasottelussa');
    expect(q.signs[2]!.cons).toContain('Wigan: ei yhtään voittoa 7 vierasottelussa');
    // ylempi sarja puoltaa vierasta ja on vastaan kotivoittoa
    expect(q.signs[2]!.pros.join(' ')).toContain('Wigan pelaa ylemmässä sarjassa (League One vs League Two)');
    expect(q.signs[0]!.cons.join(' ')).toContain('Wigan pelaa ylemmässä sarjassa');
    // tasapelihakuinen kotijoukkue puoltaa tasapeliä
    expect(q.signs[1]!.pros).toContain('Crewe: 4 tasapeliä 7 kotiottelussa');
  });

  it('tappioton vieras on vastaan kotivoittoa; liian pieni otos (alle 4 ottelua) ei tuota väitteitä', () => {
    const a = quickTake(base({
      homeSheet: team('Koti', 3, [3, 1, 3, 10, 10], [5, 4, 4, 20, 20], 'League One'),
      awaySheet: team('Vieras', 3, [2, 5, 0, 11, 6], [5, 7, 1, 21, 12], 'League One'),
    }));
    expect(a.signs[0]!.cons).toContain('Vieras: ei yhtään tappiota 7 vierasottelussa');
    const tiny = quickTake(base({
      homeSheet: team('Koti', 3, [0, 0, 2, 0, 5], [5, 4, 4, 20, 20], 'League One'),
      awaySheet: team('Vieras', 3, [2, 0, 0, 5, 1], [5, 4, 4, 20, 20], 'League One'),
    }));
    expect(tiny.signs.flatMap((s) => [...s.pros, ...s.cons]).some((t) => /vierasottelussa|kotiottelussa/.test(t))).toBe(false);
  });

  it('merkki, jolle ei löydy perusteita, saa neutraalin rivin eikä jää tyhjäksi', () => {
    const q = quickTake(base({ p: [0.5, 0.27, 0.23], crowd: [0.5, 0.27, 0.23] }));
    const empty = q.signs.filter((s) => !s.pros.length && !s.cons.length);
    expect(empty.length).toBeGreaterThan(0);
    for (const s of empty) expect(s.note).toMatch(/^Ei erityistä puolesta tai vastaan: oma arvio \d+ %, pelaajista \d+ % veikkaa tätä$/);
    for (const s of q.signs.filter((x) => x.pros.length || x.cons.length)) expect(s.note).toBeUndefined();
  });

  it('ilman joukkuetaulukkoa (esim. vain kertoimet) toimii ja antaa perustelut luvuista', () => {
    const q = quickTake(base({ market: [0.5, 0.27, 0.23], homeSheet: null, awaySheet: null }));
    expect(q.signs[0]!.pros.length).toBeGreaterThan(0);
  });
});

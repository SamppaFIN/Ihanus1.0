// Käsin syötettyjen datatiedostojen eheys: virheet täällä veisivät koko laskennan harhaan.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Coupon } from '../engine/types.js';

const dir = new URL('../../data/coupons/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe.each(files)('data/coupons/%s', (f) => {
  const c = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Coupon;

  it('id vastaa tiedostonimeä, päivämäärä ISO', () => {
    expect(`${c.id}.json`).toBe(f);
    expect(c.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.id.startsWith(c.date)).toBe(true);
  });

  it('ottelut numeroitu 1..n, nimet täytetty', () => {
    c.matches.forEach((m, i) => {
      expect(m.n).toBe(i + 1);
      expect(m.home.length).toBeGreaterThan(1);
      expect(m.away.length).toBeGreaterThan(1);
    });
  });

  it('pelijakaumat summaavat ≈ 1 ja ovat positiivisia', () => {
    for (const m of c.matches) {
      if (!m.crowd) continue;
      expect(m.crowd[0] + m.crowd[1] + m.crowd[2]).toBeGreaterThan(0.998);
      expect(m.crowd[0] + m.crowd[1] + m.crowd[2]).toBeLessThan(1.002);
      expect(Math.min(...m.crowd)).toBeGreaterThan(0);
    }
  });

  it('tulokset ovat 1/X/2 ja joko kaikilla tai ei yhdelläkään', () => {
    const rs = c.matches.map((m) => m.result);
    if (rs.every((r) => !r)) return;
    expect(rs.every((r) => r === '1' || r === 'X' || r === '2')).toBe(true);
  });

  it('vaihto, rivin hinta ja potit järkeviä', () => {
    expect(c.rowPriceEur).toBeGreaterThan(0);
    if (c.turnoverEur != null) expect(c.turnoverEur).toBeGreaterThan(1000);
    if (c.prizes) {
      const eurs = c.prizes.map((p) => p.eur);
      for (let i = 1; i < eurs.length; i++) expect(eurs[i]!).toBeLessThan(eurs[i - 1]!); // 13 > 12 > 11 > 10
    }
  });
});

describe('data/sheets', () => {
  const sdir = new URL('../../data/sheets/', import.meta.url);
  const sfiles = readdirSync(sdir).filter((f) => f.endsWith('.json'));
  it.each(sfiles)('%s viittaa olemassa olevaan kuponkiin ja ottelunumerot täsmäävät', (f) => {
    const sheet = JSON.parse(readFileSync(new URL(f, sdir), 'utf8')) as { couponId: string; matches: Array<{ n: number; home: any; away: any }> };
    expect(files).toContain(`${sheet.couponId}.json`);
    const c = JSON.parse(readFileSync(new URL(`${sheet.couponId}.json`, dir), 'utf8')) as Coupon;
    expect(sheet.matches).toHaveLength(c.matches.length);
    sheet.matches.forEach((m, i) => {
      expect(m.n).toBe(i + 1);
      for (const t of [m.home, m.away]) {
        if (!t) continue;
        for (const r of [t.lastSeasonVenue, t.thisSeason]) if (r) expect(r.w + r.d + r.l).toBeGreaterThan(0);
      }
    });
    // nimet täsmäävät kuponkiin
    sheet.matches.forEach((m, i) => {
      if (m.home) expect(c.matches[i]!.home.startsWith(m.home.name.slice(0, 4))).toBe(true);
      if (m.away) expect(c.matches[i]!.away.startsWith(m.away.name.slice(0, 4))).toBe(true);
    });
  });
});

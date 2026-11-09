import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseYleVakio } from '../scrape/yle-vakio.js';
import { couponId, findExisting, mergeYleIntoCoupon, playDateFor, slug } from '../pipeline/merge-coupon.js';
import { h2h, matchEvents, type OddsApiEvent } from '../scrape/odds-api.js';
import { buildRound } from '../pipeline/build-round.js';
import type { Coupon } from '../engine/types.js';

const fx = (f: string) => readFileSync(new URL(`../../fixtures/${f}`, import.meta.url), 'utf8');
const data = <T>(f: string): T => JSON.parse(readFileSync(new URL(`../../data/${f}`, import.meta.url), 'utf8')) as T;

describe('merge-coupon', () => {
  const page = parseYleVakio(fx('yle-479-lauantaivakio-2026-11-07.txt'));

  it('slug ja id', () => {
    expect(slug('Lauantaivakio 1')).toBe('lauantaivakio-1');
    expect(couponId('2026-11-07', page)).toBe('2026-11-07-lauantaivakio-1');
  });

  it('luo uuden kupongin sivusta', () => {
    const r = mergeYleIntoCoupon(null, page, '2026-11-07');
    expect(r.created).toBe(true);
    expect(r.coupon.matches).toHaveLength(13);
    expect(r.coupon.turnoverEur).toBe(645440);
    expect(r.coupon.bonusPoolEur).toBe(300000);
    expect(r.coupon.rowPriceEur).toBe(0.25);
    expect(r.warnings).toEqual([]);
  });

  it('päivitys säilyttää tulokset, voitonjaon ja käsin täydennetyt nimet', () => {
    const existing = data<Coupon>('coupons/2026-11-07-lauantaivakio-1.json');
    const r = mergeYleIntoCoupon(existing, page, '2026-11-07');
    expect(r.created).toBe(false);
    expect(r.coupon.prizes).toEqual(existing.prizes);
    expect(r.coupon.matches[2]!.result).toBe('1');
    expect(r.coupon.matches[2]!.away).toBe('Manchester C'); // ei palaa Ylen "Mancheste.C"-muotoon
    expect(r.coupon.matches[2]!.crowd![0]).toBeCloseTo(15 / 100, 2);
    expect(r.warnings).toEqual([]);
  });

  it('12 ottelun kierros varoittaa', () => {
    const sun = parseYleVakio(fx('yle-479-sunnuntaivakio-2026-11-08.txt'));
    const r = mergeYleIntoCoupon(null, sun, '2026-11-08');
    expect(r.coupon.guaranteeEur).toBe(50000);
    expect(r.warnings.join(' ')).toMatch(/12 ottelua/);
  });
});

describe('playDateFor / findExisting', () => {
  it('Lauantaivakio: seuraava lauantai (to 12.11. ja la 14.11. → 14.11.; su 15.11. → 21.11.)', () => {
    expect(playDateFor('Lauantaivakio 1', '2026-11-12')).toBe('2026-11-14');
    expect(playDateFor('Lauantaivakio 1', '2026-11-14')).toBe('2026-11-14');
    expect(playDateFor('Lauantaivakio 1', '2026-11-15')).toBe('2026-11-21');
    expect(playDateFor('Sunnuntaivakio 2', '2026-11-14')).toBe('2026-11-15');
    expect(playDateFor('Keskiviikkovakio', '2026-11-09')).toBe('2026-11-11');
    expect(playDateFor('Jokumuu', '2026-11-09')).toBe('2026-11-09');
  });

  it('sama kierros löytyy sunnuntaina vaikka pelipäivä olisi lauantai; uusi kierrosnumero ei', () => {
    const c = data<Coupon>('coupons/2026-11-07-lauantaivakio-1.json');
    const page = parseYleVakio(fx('yle-479-lauantaivakio-2026-11-07.txt'));
    expect(findExisting([c], page, '2026-11-08')?.id).toBe(c.id);
    expect(findExisting([c], { ...page, krs: 46 }, '2026-11-08')).toBeNull();
    expect(findExisting([c], page, '2026-12-01')).toBeNull();
  });
});

describe('odds-api', () => {
  const ev = (home: string, away: string, prices: [number, number, number], book = 'pinnacle'): OddsApiEvent => ({
    home_team: home,
    away_team: away,
    commence_time: '2026-11-14T15:00:00Z',
    bookmakers: [{ key: book, markets: [{ key: 'h2h', outcomes: [{ name: home, price: prices[0] }, { name: 'Draw', price: prices[1] }, { name: away, price: prices[2] }] }] }],
  });

  it('h2h palauttaa [koti, tasa, vieras] ja suosii pinnaclea', () => {
    const e = ev('Arsenal', 'Hull City', [1.2, 7, 15]);
    e.bookmakers.unshift({ key: 'x', markets: [{ key: 'h2h', outcomes: [{ name: 'Arsenal', price: 1.1 }, { name: 'Draw', price: 6 }, { name: 'Hull City', price: 12 }] }] });
    expect(h2h(e, ['pinnacle'])).toEqual({ odds: [1.2, 7, 15], bookmaker: 'pinnacle' });
  });

  it('täsmäyttää Ylen katkaistut nimet tapahtumiin', () => {
    const events = [ev('Arsenal', 'Hull City', [1.2, 7, 15]), ev('Nottingham Forest', 'Manchester City', [5, 4, 1.6]), ev('Middlesbrough', 'Watford', [2, 3.3, 3.8])];
    const coupon = data<Coupon>('coupons/2026-11-07-lauantaivakio-1.json');
    const m = [coupon.matches[0]!, coupon.matches[2]!, { ...coupon.matches[3]!, home: 'Watford', away: 'Middlesbrou' }];
    const r = matchEvents(m, events);
    expect(r.matched.map((x) => x.n)).toEqual([1, 3]);
    expect(r.unmatched).toEqual([4]); // Watford–Middlesbrough on tapahtumissa toisin päin → ei arvata
  });
});

describe('buildRound', () => {
  it('7.11. (ei omaa dataa) → ei polkua, selitys annettu, kalibrointi laskettu', () => {
    const r = buildRound(data<Coupon>('coupons/2026-11-07-lauantaivakio-1.json'), null, null, { today: '2026-11-09', budgetEur: 20 });
    expect(r.status).toBe('played');
    expect(r.hasEdge).toBe(false);
    expect(r.path).toHaveLength(0);
    expect(r.noPathReason).toMatch(/Ei omaa dataa/);
    expect(r.calibration!.expectedWinners[0]).toBeGreaterThan(0.5);
    expect(r.calibration!.impliedWinners![1]).toBeGreaterThan(20);
  });

  it('24.10. (taulukko) → polku jossa jokaisella askeleella hits ja varovainen arvio ≤ perusarvio', () => {
    const c = data<Coupon>('coupons/2026-10-24-lauantaivakio.json');
    const sheet = data<any>('sheets/2026-10-24-lauantaivakio.json');
    const r = buildRound(c, sheet, null, { today: '2026-11-09', budgetEur: 20 });
    expect(r.hasEdge).toBe(true);
    expect(r.path.length).toBeGreaterThan(3);
    for (const s of r.path) {
      expect(s.hits).toHaveLength(4);
      expect(s.valueMultipleLow).toBeLessThanOrEqual(s.valueMultiple + 1e-9);
      expect(s.costEur).toBeLessThanOrEqual(20 + 1e-9);
    }
    // ottelut 12 ja 13: ei taulukkoa → perustuu pelijakaumaan
    expect(r.matches[11]!.basis).toBe('crowd');
    expect(r.matches[0]!.basis).toBe('model');
  });
});

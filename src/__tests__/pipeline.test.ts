import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseYleVakio } from '../scrape/yle-vakio.js';
import { couponId, findExisting, mergeYleIntoCoupon, playDateFor, slug } from '../pipeline/merge-coupon.js';
import { matchFixtures, parseDayPage, parseRow, parseRows, type RowSnapshot } from '../scrape/odds-table.js';
import { devig } from '../engine/prob.js';
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

describe('odds-table (ilman API-avainta)', () => {
  const snap = (...cells: Array<string | [string, string]>): RowSnapshot => ({ cells: cells.map((c) => (Array.isArray(c) ? { text: c[0], odd: c[1] } : { text: c, odd: null })) });

  it('lukee rivin: nimipari + kolme kerrointa + aika (teksti- ja data-odd-muodot)', () => {
    const textual = parseRow(snap('Manchester City - Fulham', '1.45', '4.80', '7,00', '21.11. 13:30'), 'england/premier-league');
    expect(textual).toMatchObject({ home: 'Manchester City', away: 'Fulham', odds: [1.45, 4.8, 7], when: '21.11. 13:30' });
    const attr = parseRow(snap('QPR - Lincoln', ['', '2.10'], ['', '3.40'], ['', '3.60']), 'x');
    expect(attr?.odds).toEqual([2.1, 3.4, 3.6]);
  });

  it('BetExplorerin oikea rakenne: bookmakers-lukumäärä ("9") ei ole kerroin; data-odd-solut voittavat', () => {
    const real: RowSnapshot = {
      cells: [
        { text: 'Today 20:30', odd: null },
        { text: 'Leganes - Burgos CF', odd: null },
        { text: '', odd: null },
        { text: '9', odd: null }, // table-main__bs
        { text: '', odd: '2.34' },
        { text: '', odd: '3.02' },
        { text: '', odd: '3.04' },
      ],
    };
    expect(parseRow(real, 'spain/laliga2')?.odds).toEqual([2.34, 3.02, 3.04]);
    // pelkät tekstit: viimeiset kolme lukua, edessä oleva kokonaisluku hylätään
    const textual = parseRow(snap('Leganes - Burgos CF', '9', '2.34', '3.02', '3.04', 'Today 20:30'), 'x');
    expect(textual?.odds).toEqual([2.34, 3.02, 3.04]);
    // jos kolmatta kerrointa ei löydy ([9, 2.34, 3.02]), käänteislukujen summa paljastaa virheen → hylätään
    expect(parseRow(snap('Leganes - Burgos CF', '9', '2.34', '3.02', 'Today 20:30'), 'x')).toBeNull();
  });

  it('hylkää: otsikkorivi, rivi ilman kertoimia (JS ei ehtinyt), pelattu ottelu (tulos), liian vähän lukuja', () => {
    expect(parseRow(snap('', '1', 'X', '2', ''), 'x')).toBeNull();
    expect(parseRow(snap('Millwall - QPR', '', '', '', '21.11. 13:30'), 'x')).toBeNull();
    expect(parseRow(snap('Birmingham - Swansea', '2:1', '1.90', '3.50', '4.00', '07.11.'), 'x')).toBeNull();
    expect(parseRow(snap('Bolton - Portsmouth', '2.20', '3.30'), 'x')).toBeNull();
  });

  it('täsmäyttää kuponin Yle-nimet BetExplorer-nimiin; epäselvä ja tuntematon jäävät pois', () => {
    const coupon = data<Coupon>('coupons/2026-11-07-lauantaivakio-1.json');
    const rows = parseRows(
      [
        snap('Nottingham - Manchester City', '5.50', '4.40', '1.55', 'Today 17:00'),
        snap('West Brom - Millwall', '2.30', '3.20', '3.30', 'Today 17:00'),
        snap('Sheffield Utd - Charlton', '2.0', '3.4', '3.8', 'Today 17:00'), // väärin päin → ei saa täsmätä ottelun 11 kanssa
        snap('Watford - Middlesbrough', '2.9', '3.1', '2.5', 'Today 17:00'),
        snap('Cardiff - Burnley', '2.7', '3.3', '2.6', 'Today 17:00'),
      ],
      'england/championship',
    );
    const { matched, unmatched } = matchFixtures(coupon.matches, rows);
    const by = Object.fromEntries(matched.map((m) => [m.n, m.odds]));
    expect(by[3]).toEqual([5.5, 4.4, 1.55]); // Nottingham – Manchester C
    expect(by[7]).toEqual([2.3, 3.2, 3.3]); // West Bromwi – Millwall
    expect(by[4]).toEqual([2.9, 3.1, 2.5]); // Watford – Middlesbrou
    expect(by[10]).toEqual([2.7, 3.3, 2.6]);
    expect(unmatched).toContain(11);
    expect(unmatched).toContain(1);
  });

  it('BetExplorerin päiväsivu (oikea rakenne 13.11.2026): kaikki Sunnuntaivakio 2:n 12 ottelua kertoimineen ja lähdelinkkeineen', () => {
    const html = fx('betexplorer-day-2026-11-15.html');
    const rows = parseDayPage(html);
    expect(rows.length).toBe(13); // 12 vakio-ottelua + yksi muu (Liga MX) — duplikaatit yhdistetty
    const coupon = data<Coupon>('coupons/2026-11-15-sunnuntaivakio-2.json');
    const { matched, unmatched } = matchFixtures(coupon.matches, rows);
    expect(unmatched).toEqual([]); // suomenkieliset maanimet (Tshekki, Kypros…) ja MVV→Maastricht täsmäävät
    const by = Object.fromEntries(matched.map((m) => [m.n, m]));
    expect(by[2]!.odds).toEqual([1.7, 4.08, 4.29]);
    expect(by[2]!.url).toBe('https://www.betexplorer.com/football/europe/uefa-nations-league/spain-england/zs0jyKt4/');
    expect(by[3]!.event).toBe('Croatia - Czech Republic');
    expect(by[8]!.event).toBe('Tenerife - Ceuta');
    expect(by[10]!.event).toBe('Eibar - Cadiz CF');
    expect(by[12]!.event).toBe('Maastricht - Vitesse');
    expect(by[12]!.odds).toEqual([2.95, 3.55, 2.12]);
  });

  it('devig toimii skreipatuilla kertoimilla (summa 1, marginaali > 0)', () => {
    const p = devig([2.1, 3.4, 3.6]);
    expect(p[0] + p[1] + p[2]).toBeCloseTo(1, 12);
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

describe('buildRound: Futisvakio 6 (12 ottelua, EFL Trophy)', () => {
  const coupon = data<Coupon>('coupons/2026-11-10-futisvakio-6.json');
  const odds = data<NonNullable<Parameters<typeof buildRound>[2]>>('odds/2026-11-10-futisvakio-6.json');
  const r = buildRound(coupon, null, odds, { today: '2026-11-09', budgetEur: 20 });

  it('avoin kierros ilman polkua ja ilman keksittyä pottia', () => {
    expect(r.status).toBe('open');
    expect(r.matches).toHaveLength(12);
    expect(r.path).toEqual([]);
    expect(r.pools).toBeNull();
    expect(r.noPathReason).toContain('12 ottelua');
    expect(r.rowPriceEur).toBe(0.1);
    expect(r.rowPriceEstimated).toBe(false);
  });

  it('jokaisella ottelulla on selitys, ja jokaisella faktalla on oma linkki', () => {
    for (const m of r.matches) {
      expect(m.explain.headline.length).toBeGreaterThan(5);
      expect(m.explain.sources.some((s) => /Yle Teksti-TV/.test(s.label))).toBe(true);
      for (const f of m.explain.facts) expect(f.url).toMatch(/^https:\/\//);
    }
    expect(r.links.length).toBeGreaterThanOrEqual(2);
  });

  it('Leicester–Walsall: kertoimista tuleva arvio ja kertoimen lähde linkitettynä', () => {
    const m = r.matches[0]!;
    expect(m.basis).toBe('market');
    expect(m.explain.sources.map((s) => s.url)).toContain(odds.matches[0]!.url);
    // muilla otteluilla ei ole kertoimia → ei väitetä etua
    expect(r.matches[1]!.explain.headline).toBe('Ei omaa tietoa tästä ottelusta');
  });
});

describe('buildRound: Futisvakio 6 taulukkomallilla (paperitaulukon vastine)', () => {
  const coupon = data<Coupon>('coupons/2026-11-10-futisvakio-6.json');
  const odds = data<NonNullable<Parameters<typeof buildRound>[2]>>('odds/2026-11-10-futisvakio-6.json');
  const sheet = data<NonNullable<Parameters<typeof buildRound>[1]>>('sheets/2026-11-10-futisvakio-6.json');
  const r = buildRound(coupon, sheet, odds, { today: '2026-11-09', budgetEur: 20 });

  it('11 ottelulle oma arvio taulukosta, Ipswich U21 -ottelulle ei', () => {
    const own = r.matches.filter((m) => m.basis !== null && m.basis !== 'crowd');
    expect(own).toHaveLength(11);
    expect(r.matches[11]!.explain.headline).toBe('Ei omaa tietoa tästä ottelusta');
    expect(r.matches[0]!.basis).toBe('model+market');
    for (const m of r.matches.slice(1, 11)) expect(m.basis).toBe('model');
  });

  it('jokaisella taulukko-ottelulla on lähteistetyt taulukkofaktat ja linkki sheet-tiedostoon', () => {
    for (const m of r.matches.slice(0, 11)) {
      const t = m.explain.facts.filter((f) => /^Sports Mole/.test(f.label));
      expect(t.length).toBeGreaterThanOrEqual(2);
      for (const f of t) expect(f.url).toMatch(/^https:\/\/www\.sportsmole\.co\.uk\/football\//);
      expect(m.explain.sources.some((s) => /data\/sheets\/2026-11-10-futisvakio-6\.json$/.test(s.url ?? ""))).toBe(true);
    }
  });

  it('pikakatsaus: jokaisella taulukko-ottelulla 1/X/2 perusteluineen, Ipswich U21 -ottelulla ei', () => {
    for (const m of r.matches.slice(0, 11)) {
      expect(m.explain.quick).not.toBeNull();
      expect(m.explain.quick!.summary.length).toBeGreaterThan(10);
      expect(m.explain.quick!.signs).toHaveLength(3);
      // jokaiselle merkille löytyy jokin perustelu
      for (const sg of m.explain.quick!.signs) expect(sg.pros.length + sg.cons.length > 0 || Boolean(sg.note)).toBe(true);
    }
    expect(r.matches[11]!.explain.quick).toBeNull();
    // joukkuetaulukkoa ei vuodateta näkymään
    expect(JSON.stringify(r)).not.toContain('"homeSheet"');
  });

  it('sarjataso näkyy: League One -kotijoukkue on suosikki League Two -vierasta vastaan samalla tilastolla', () => {
    // Plymouth (L1) – Swindon (L2) ja Bristol Rovers (L2) – Reading (L1)
    const plymouth = r.matches[6]!;
    const bristol = r.matches[7]!;
    expect(plymouth.p![0]).toBeGreaterThan(plymouth.p![2]);
    expect(bristol.p![2]).toBeGreaterThan(bristol.p![0]);
  });
});

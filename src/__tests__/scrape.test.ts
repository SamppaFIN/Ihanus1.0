import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractPre, parseYleVakio, yleTextUrl } from '../scrape/yle-vakio.js';
import { bestMatch, nameScore } from '../scrape/names.js';

const fx = (f: string) => readFileSync(new URL(`../../fixtures/${f}`, import.meta.url), 'utf8');

describe('parseYleVakio', () => {
  it('lukee Lauantaivakion: otsikko, vaihto, bonus, 13 ottelua', () => {
    const p = parseYleVakio(fx('yle-479-lauantaivakio-2026-11-07.txt'));
    expect(p.title).toBe('Lauantaivakio 1');
    expect(p.krs).toBe(45);
    expect(p.turnoverEur).toBe(645440);
    expect(p.bonusPoolEur).toBe(300000);
    expect(p.guaranteeEur).toBeNull();
    expect(p.snapshotTime).toBe('16.58');
    expect(p.closed).toBe(true);
    expect(p.matches).toHaveLength(13);
    expect(p.matches[0]).toMatchObject({ n: 1, home: 'Arsenal', away: 'Hull', percents: [89, 8, 3] });
    expect(p.matches[2]).toMatchObject({ home: 'Nottingham', away: 'Mancheste.C', percents: [15, 21, 64] });
    expect(p.matches[12]).toMatchObject({ n: 13, home: 'Oxford U', away: 'Stevenage', percents: [50, 26, 24] });
  });

  it('lukee Sunnuntaivakion: takuupotti, headerTime, 12 ottelua, ei-M-rivit', () => {
    const p = parseYleVakio(fx('yle-479-sunnuntaivakio-2026-11-08.txt'));
    expect(p.title).toBe('Sunnuntaivakio 2');
    expect(p.headerTime).toBe('15.00');
    expect(p.turnoverEur).toBe(88770);
    expect(p.guaranteeEur).toBe(50000);
    expect(p.bonusPoolEur).toBeNull();
    expect(p.matches).toHaveLength(12);
    const genoa = p.matches[7]!;
    expect(genoa).toMatchObject({ home: 'Genoa', away: 'Milan', flag: false, percents: [19, 26, 54] });
    expect(p.matches[0]!.flag).toBe(true);
  });

  it('crowd summautuu 1:een vaikka prosentit pyöristetty', () => {
    const p = parseYleVakio(fx('yle-479-lauantaivakio-2026-11-07.txt'));
    for (const m of p.matches) expect(m.crowd[0] + m.crowd[1] + m.crowd[2]).toBeCloseTo(1, 12);
  });

  it('tyhjä / vieras sivu ei kaada: 0 ottelua', () => {
    const p = parseYleVakio('Uutiset\n 1. Jotain - Muuta 5 3 2 ');
    expect(p.matches).toHaveLength(0);
    expect(p.turnoverEur).toBeNull();
  });
});

describe('parseYleVakio: sulkeutumisaika, rivihinta, alasivu', () => {
  const now = new Date('2026-11-09T10:00:00Z');
  it('Sunnuntaivakio 2 (alasivu 2/8): päättyy su 8.11. klo 14.58 (Suomen talviaika → 12:58 UTC), rivihinta 0,10 €, pelinumero 2', () => {
    const p = parseYleVakio(fx('yle-479-sunnuntaivakio-2-sub2-2026-11-08.txt'), now);
    expect(p.closesAt).toBe('2026-11-08T12:58:00.000Z');
    expect(p.rowPriceEur).toBe(0.1);
    expect(p.pelinumero).toBe(2);
    expect(p.sub).toEqual({ n: 2, of: 8 });
    expect(p.turnoverEur).toBe(31198);
    expect(p.matches).toHaveLength(12);
  });
  it('Sunnuntaivakio 3: eri kierros samalla sivulla', () => {
    const p = parseYleVakio(fx('yle-479-sunnuntaivakio-3-sub3-2026-11-08.txt'), now);
    expect(p.title).toBe('Sunnuntaivakio 3');
    expect(p.closesAt).toBe('2026-11-08T16:13:00.000Z');
    expect(p.matches[0]).toMatchObject({ home: 'Mancheste.U', away: 'Aston Villa' });
    expect(p.matches[6]).toMatchObject({ home: 'SC Freiburg', away: 'Union Berli' });
  });
  it('1. alasivu ilman alariviä: closesAt ja rivihinta null', () => {
    const p = parseYleVakio(fx('yle-479-lauantaivakio-2026-11-07.txt'), now);
    expect(p.closesAt).toBeNull();
    expect(p.rowPriceEur).toBeNull();
  });
  it('kesäaika: 28.7. klo 14.58 → 11:58 UTC; joulu→tammi-vuosiraja', () => {
    const t = (day: string, nowIso: string) => parseYleVakio(` 15.00 Lauantaivakio 1 KRS 30  2/3\n Pelaaminen päättyy la ${day} klo 14.58\n 1. A - B 40 30 30\n`, new Date(nowIso)).closesAt;
    expect(t('25.07.', '2026-07-24T10:00:00Z')).toBe('2026-07-25T11:58:00.000Z');
    expect(t('02.01.', '2026-12-30T10:00:00Z')).toBe('2027-01-02T12:58:00.000Z');
  });
});

describe('extractPre', () => {
  it('poimii <pre>-lohkon ja purkaa entiteetit', () => {
    const html = '<html><body><pre class="x"> 1. A &amp; B - C   <span class="y">M</span> 40 30 30\n</pre></body></html>';
    expect(extractPre(html)).toBe(' 1. A & B - C   M 40 30 30\n');
  });
  it('yleTextUrl', () => {
    expect(yleTextUrl()).toBe('https://yle.fi/tekstitv/txt/479_0001.htm');
    expect(yleTextUrl(478, 3)).toBe('https://yle.fi/tekstitv/txt/478_0003.htm');
  });
});

describe('nimien täsmäytys', () => {
  const epl = ['Manchester City', 'Manchester United', 'Middlesbrough', 'West Bromwich Albion', 'West Ham United', 'Newcastle United', 'Sheffield United', 'Sheffield Wednesday', 'AFC Wimbledon', 'Nottingham Forest', 'Wolverhampton Wanderers', 'Oxford United', 'Lincoln City', 'Cardiff City', 'Charlton Athletic', 'Crewe Alexandra'];

  it.each([
    ['Mancheste.C', 'Manchester City'],
    ['Middlesbrou', 'Middlesbrough'],
    ['West Bromwi', 'West Bromwich Albion'],
    ['Newcastle U', 'Newcastle United'],
    ['Sheffield U', 'Sheffield United'],
    ['AFC Wimbled', 'AFC Wimbledon'],
    ['Nottingham', 'Nottingham Forest'],
    ['Oxford U', 'Oxford United'],
    ['Lincoln C', 'Lincoln City'],
    ['Cardiff C', 'Cardiff City'],
    ['Charlton', 'Charlton Athletic'],
    ['Crewe', 'Crewe Alexandra'],
    ['West Ham', 'West Ham United'],
    ['Wolves', 'Wolverhampton Wanderers'],
    ['Cardiff C', 'Cardiff City'],
  ])('%s → %s', (yle, expected) => {
    expect(bestMatch(yle, epl)?.candidate).toBe(expected);
  });

  it('Yle "Cardiff C" = BetExplorer "Cardiff", mutta "Manchester C" ei ole "Manchester United"', () => {
    expect(nameScore('Cardiff C', 'Cardiff')).toBeGreaterThanOrEqual(0.95);
    expect(nameScore('Mancheste.C', 'Manchester United')).toBeLessThan(0.75);
    expect(bestMatch('Mancheste.C', ['Manchester City', 'Manchester United', 'Leeds'])?.candidate).toBe('Manchester City');
  });

  it('epäselvä nimi → null (ei arvata)', () => {
    expect(bestMatch('Manchester', epl)).toBeNull();
  });

  it('tuntematon joukkue → null', () => {
    expect(bestMatch('IF Gnistan', epl)).toBeNull();
  });

  it('nameScore on 1 täsmälleen samalle', () => {
    expect(nameScore('Arsenal', 'Arsenal')).toBe(1);
  });
});

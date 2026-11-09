import { describe, expect, it } from 'vitest';
import { explainMatch, signName, type ExplainContext, type ExplainMatch } from '../pipeline/explain.js';

const ctx = (o: Partial<ExplainContext> = {}): ExplainContext => ({
  status: 'open',
  couponId: '2026-11-14-lauantaivakio-1',
  couponSource: 'Yle Teksti-TV 479 (pelijakauma 16.58)',
  fromSheet: false,
  odds: null,
  ...o,
});
const match = (o: Partial<ExplainMatch> = {}): ExplainMatch => ({
  home: 'Arsenal',
  away: 'Chelsea',
  crowd: [0.7, 0.18, 0.12],
  crowdEstimated: false,
  market: null,
  model: null,
  p: null,
  basis: 'crowd',
  ratio: null,
  result: null,
  ...o,
});
const text = (e: { headline: string; lines: string[] }) => [e.headline, ...e.lines].join('\n');

describe('explainMatch', () => {
  it('aliarvostettu merkki nostetaan otsikkoon ja selitetään numeroin', () => {
    // pelaajat: tasapeli 8 %, oma arvio 24 %
    const m = match({ crowd: [0.7, 0.08, 0.22], p: [0.55, 0.24, 0.21], basis: 'market', ratio: [0.55 / 0.7, 3, 0.21 / 0.22] });
    const e = explainMatch(m, ctx({ odds: { league: 'england/premier-league', event: 'Arsenal - Chelsea' } }));
    expect(e.tone).toBe('good');
    expect(e.headline).toContain('tasapeli');
    expect(text(e)).toContain('vain 8 % pelaajista');
    expect(text(e)).toContain('24 %');
    expect(text(e)).toContain('haettu ottelu: Arsenal - Chelsea');
    // ylipelattu suosikki mainitaan myös
    expect(text(e)).toContain('Kotivoitto: 70 % pelaajista veikkaa sitä, mutta meidän arviomme on vain 55 %');
  });

  it('ylipelattu suosikki otsikkoon kun mikään ei ole selvästi aliarvostettu', () => {
    const m = match({ crowd: [0.8, 0.12, 0.08], p: [0.6, 0.2, 0.2], basis: 'market', ratio: [0.75, 1.1, 1.05] });
    const e = explainMatch(m, ctx());
    expect(e.tone).toBe('warn');
    expect(e.headline).toContain('Suosikki (kotivoitto) on ylipelattu');
  });

  it('samaa mieltä: ei keksitä etua', () => {
    const m = match({ crowd: [0.5, 0.3, 0.2], p: [0.52, 0.29, 0.19], basis: 'model', ratio: [1.04, 0.97, 0.95] });
    const e = explainMatch(m, ctx({ fromSheet: true }));
    expect(e.tone).toBe('neutral');
    expect(text(e)).toContain('ei synny erityistä etua');
  });

  it('ei omaa dataa: sanotaan suoraan ettei etua etsitä', () => {
    const e = explainMatch(match(), ctx());
    expect(e.headline).toBe('Ei omaa tietoa tästä ottelusta');
    expect(text(e)).toContain('Pelaajat veikkaavat: kotivoitto 70 %, tasapeli 18 %, vierasvoitto 12 %');
    expect(text(e)).toContain('eikä tästä ottelusta etsitä etua');
  });

  it('pelaajien osuudet puuttuvat', () => {
    const e = explainMatch(match({ crowd: null }), ctx());
    expect(e.headline).toContain('ei ole vielä saatu');
    expect(e.sources).toEqual([]);
  });

  it('arvioidut pelaajaosuudet merkitään', () => {
    const e = explainMatch(match({ crowdEstimated: true }), ctx());
    expect(text(e)).toContain('arvioitu, ei luettu suoraan');
  });

  it('pelatun ottelun tulos kerrotaan, ja aliarvostettu tulos mainitaan', () => {
    const m = match({ crowd: [0.7, 0.08, 0.22], p: [0.55, 0.24, 0.21], basis: 'market', ratio: [0.79, 3, 0.95], result: 'X' });
    const e = explainMatch(m, ctx({ status: 'played' }));
    expect(text(e)).toContain('Oikea tulos oli tasapeli. Pelaajat olivat aliarvostaneet tätä merkkiä.');
    expect(signName('1', m)).toBe('kotivoitto (Arsenal)');
  });

  it('lähdelinkit: Yle, BetExplorer-liigasivu, taulukko GitHubissa', () => {
    const m = match({ p: [0.5, 0.3, 0.2], basis: 'model+market', ratio: [1, 1, 1] });
    const e = explainMatch(m, ctx({ fromSheet: true, odds: { league: 'england/championship' } }));
    const urls = e.sources.map((s) => s.url);
    expect(urls).toContain('https://yle.fi/tekstitv/txt/479_0001.htm');
    expect(urls).toContain('https://www.betexplorer.com/football/england/championship/fixtures/');
    expect(urls).toContain('https://github.com/SamppaFIN/Ihanus1.0/blob/main/data/sheets/2026-11-14-lauantaivakio-1.json');
    for (const s of e.sources) expect(s.what.length).toBeGreaterThan(3);
  });

  it('lähde ilman verkko-osoitetta (paperitaulukko) näytetään silti, ilman linkkiä', () => {
    const e = explainMatch(match(), ctx({ couponSource: 'Samin paperitaulukko + Veikkauksen tiedote' }));
    expect(e.sources).toEqual([{ label: 'Samin paperitaulukko + Veikkauksen tiedote', what: 'pelaajien osuudet' }]);
  });

  it('vanhan kierroksen Yle-linkkiin tulee huomautus', () => {
    const e = explainMatch(match(), ctx({ status: 'played' }));
    expect(e.sources[0]!.note).toContain('poistunut sivulta');
  });

  it('lähteistetyt tosiasiat kulkevat mukana, ja yksittäisen kertoimen lähde saa oman linkin', () => {
    const facts = [{ text: 'Leicester voitti 6–1.', label: 'Football Web Pages', url: 'https://www.footballwebpages.co.uk/efl-trophy/20260922' }];
    const m = match({ facts, p: [0.72, 0.16, 0.12], basis: 'market', ratio: [0.88, 1.45, 1.7] });
    const e = explainMatch(m, ctx({ odds: { url: 'https://example.test/ennakko', label: 'Ennakko 9.11.' } }));
    expect(e.facts).toEqual(facts);
    const bet = e.sources.find((x) => x.label === 'Ennakko 9.11.')!;
    expect(bet.url).toBe('https://example.test/ennakko');
    expect(bet.what).toBe('vedonvälittäjän kertoimet');
  });

  it('avoimen kierroksen ottelu ilman dataa kertoo että kertoimet haetaan automaattisesti', () => {
    const open = explainMatch(match(), ctx({ status: 'open' }));
    expect(text(open)).toContain('haetaan automaattisesti');
    const played = explainMatch(match(), ctx({ status: 'played' }));
    expect(text(played)).not.toContain('haetaan automaattisesti');
  });

  it('selitys on selkokielinen: ei asiantuntijatermejä', () => {
    const m = match({ crowd: [0.7, 0.08, 0.22], p: [0.55, 0.24, 0.21], basis: 'model+market', ratio: [0.79, 3, 0.95], result: '1' });
    const t = text(explainMatch(m, ctx({ fromSheet: true, odds: { league: 'england/premier-league' }, status: 'played' })));
    for (const bad of ['devig', 'arvokerroin', 'ratio', 'EV', 'Poisson', 'enumer', 'Monte', 'kutist']) expect(t).not.toContain(bad);
  });
});

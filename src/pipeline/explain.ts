// Ottelukohtainen selkokielinen selitys: mitä data sanoo, missä pelaajat ovat eri mieltä ja mistä luvut tulevat.
// Tarkoituksella ilman termistöä (ei "devig", "arvokerroin", "EV"): lukija voi olla joku, joka ei ole nähnyt
// todennäköisyyslaskentaa. Puhdas funktio → testattavissa, ei verkkoa.

import type { MatchFact, Sign, Triple } from '../engine/types.js';
import { fixturesUrl } from '../scrape/odds-table.js';

export interface SourceLink {
  label: string;
  /** Puuttuu kun lähde ei ole verkossa (esim. Samin paperitaulukko) */
  url?: string;
  /** Mitä tietoa tästä lähteestä tuli */
  what: string;
  note?: string;
}

export interface MatchExplain {
  headline: string;
  /** good = pelaajat aliarvostavat jotain merkkiä, warn = suosikki on ylipelattu, neutral = ei erityistä */
  tone: 'good' | 'warn' | 'neutral';
  lines: string[];
  /** Lähteistetyt taustatiedot: yksi lause, yksi linkki */
  facts: MatchFact[];
  sources: SourceLink[];
}

export interface ExplainMatch {
  home: string;
  away: string;
  crowd: Triple | null;
  crowdEstimated: boolean;
  market: Triple | null;
  model: Triple | null;
  p: Triple | null;
  basis: 'model' | 'market' | 'model+market' | 'crowd' | null;
  ratio: Triple | null;
  result: Sign | null;
  facts?: MatchFact[];
}

export interface ExplainContext {
  status: 'open' | 'closed' | 'played';
  couponId: string;
  /** Kuponkitiedoston source-kenttä: kertoo mistä pelaajien osuudet tulivat */
  couponSource: string;
  /** Oma arvio tuli data/sheets-taulukosta */
  fromSheet: boolean;
  odds: { league?: string; event?: string; url?: string; label?: string } | null;
}

const SIGNS: Sign[] = ['1', 'X', '2'];
const REPO = 'https://github.com/SamppaFIN/Ihanus1.0';

/** Oma arvio katsotaan "aliarvostetuksi" kun se on vähintään 15 % pelaajien arviota suurempi ja merkki ei ole täysin harvinainen. */
const UNDER_RATIO = 1.15;
const OVER_RATIO = 0.87;

const pc = (x: number) => `${Math.round(x * 100)} %`;

export function signName(s: Sign, m: Pick<ExplainMatch, 'home' | 'away'>): string {
  return s === '1' ? `kotivoitto (${m.home})` : s === '2' ? `vierasvoitto (${m.away})` : 'tasapeli';
}
const signShort = (s: Sign) => (s === '1' ? 'kotivoitto' : s === '2' ? 'vierasvoitto' : 'tasapeli');

const triple = (t: Triple) => `kotivoitto ${pc(t[0])}, tasapeli ${pc(t[1])}, vierasvoitto ${pc(t[2])}`;

export function explainMatch(m: ExplainMatch, ctx: ExplainContext): MatchExplain {
  const sources = sourceLinks(m, ctx);
  const facts = m.facts ?? [];
  const lines: string[] = [];

  if (!m.crowd) {
    return {
      headline: 'Pelaajien osuuksia ei ole vielä saatu',
      tone: 'neutral',
      lines: ['Yle Teksti-TV ei ole vielä näyttänyt tämän ottelun pelijakaumaa. Se päivittyy yleensä muutamaa tuntia ennen kierroksen sulkeutumista.'],
      facts,
      sources,
    };
  }

  // Ei omaa tietoa: ei väitetä mitään etua
  if (!m.p || m.basis === 'crowd' || m.basis == null) {
    lines.push(`Pelaajat veikkaavat: ${triple(m.crowd)}.${m.crowdEstimated ? ' Nämä osuudet on arvioitu, ei luettu suoraan.' : ''}`);
    lines.push('Tästä ottelusta ei ole kertoimia eikä omaa taulukkoa, joten emme tiedä ovatko pelaajat oikeassa. Laskenta pitää heidän arviotaan oikeana, eikä tästä ottelusta etsitä etua.');
    if (ctx.status === 'open') lines.push('Kertoimet haetaan automaattisesti kierroksen päivän aamuna ja vielä tuntia ennen sulkeutumista. Kun ne löytyvät, tähän ilmestyy oma arvio.');
    if (m.result) lines.push(resultLine(m));
    return { headline: 'Ei omaa tietoa tästä ottelusta', tone: 'neutral', lines, facts, sources };
  }

  const p = m.p;
  const q = m.crowd;
  const ratio = m.ratio ?? (p.map((x, i) => x / q[i]!) as Triple);

  const under = SIGNS.map((s, i) => ({ s, i })).filter(({ i }) => ratio[i]! >= UNDER_RATIO && p[i]! >= 0.1);
  const over = SIGNS.map((s, i) => ({ s, i })).filter(({ i }) => ratio[i]! <= OVER_RATIO && q[i]! >= 0.3);
  const bestUnder = under.sort((a, b) => ratio[b.i]! - ratio[a.i]!)[0];
  const favCrowd = q.indexOf(Math.max(...q));

  let headline: string;
  let tone: MatchExplain['tone'];
  if (bestUnder) {
    headline = `Pelaajat aliarvostavat tässä: ${signShort(bestUnder.s)}`;
    tone = 'good';
  } else if (over.some((o) => o.i === favCrowd)) {
    headline = `Suosikki (${signShort(SIGNS[favCrowd]!)}) on ylipelattu`;
    tone = 'warn';
  } else {
    headline = 'Pelaajat ja meidän arvio ovat samaa mieltä';
    tone = 'neutral';
  }

  const top = p.indexOf(Math.max(...p));
  lines.push(`Meidän arvio: ${triple(p)}. Todennäköisin tulos on ${signShort(SIGNS[top]!)}, noin ${Math.round(p[top]! * 10)} kertaa kymmenestä.`);
  const fromOdds = m.basis === 'market' || m.basis === 'model+market';
  const fromModel = m.basis === 'model' || m.basis === 'model+market';
  const basisParts = [
    fromOdds ? `vedonvälittäjien kertoimista${ctx.odds?.event ? ` (haettu ottelu: ${ctx.odds.event})` : ''}` : null,
    fromModel ? 'joukkueiden tilastotaulukosta (tämän ja viime kauden tulokset, kotona ja vieraissa)' : null,
  ].filter(Boolean);
  lines.push(`Arvio on laskettu ${basisParts.join(' ja ')}. Varmuuden vuoksi sitä on vedetty kohti pelaajien arviota, koska yksittäinen lähde voi olla väärässä.`);
  lines.push(`Pelaajat veikkaavat: ${triple(q)}.${m.crowdEstimated ? ' Nämä osuudet on arvioitu, ei luettu suoraan.' : ''}`);

  for (const { s, i } of under) {
    lines.push(`${cap(signShort(s))}: vain ${pc(q[i]!)} pelaajista veikkaa sitä, vaikka sen mahdollisuus on meidän arviomme mukaan ${pc(p[i]!)}. Jos tämä tulee ja koko rivisi osuu, voitto jaetaan harvempien kesken.`);
  }
  for (const { s, i } of over) {
    lines.push(`${cap(signShort(s))}: ${pc(q[i]!)} pelaajista veikkaa sitä, mutta meidän arviomme on vain ${pc(p[i]!)}. Jos tämä tulee ja rivisi osuu, joudut jakamaan voiton monen kanssa.`);
  }
  if (!under.length && !over.length) lines.push('Erot ovat pieniä, joten tästä ottelusta ei synny erityistä etua. Se on silti mukana, koska kuponki tarvitsee merkin jokaiseen otteluun.');

  if (m.result) lines.push(resultLine(m));
  lines.push('Tämä on arvio, ei lupaus: ottelu voi päättyä miten tahansa.');
  return { headline, tone, lines, facts, sources };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function resultLine(m: ExplainMatch): string {
  const r = m.result!;
  const i = SIGNS.indexOf(r);
  let extra = '';
  if (m.ratio && m.basis && m.basis !== 'crowd' && m.ratio[i]! >= UNDER_RATIO) extra = ' Pelaajat olivat aliarvostaneet tätä merkkiä.';
  else if (m.crowd && m.crowd[i]! >= 0.5) extra = ' Tämän merkin veikkasi yli puolet pelaajista.';
  return `Oikea tulos oli ${signName(r, m)}.${extra}`;
}

export function sourceLinks(m: ExplainMatch, ctx: ExplainContext): SourceLink[] {
  const out: SourceLink[] = [];
  if (m.crowd) {
    if (/Yle Teksti-TV/i.test(ctx.couponSource)) {
      out.push({
        label: 'Yle Teksti-TV, sivu 479',
        url: 'https://yle.fi/tekstitv/txt/479_0001.htm',
        what: 'pelaajien osuudet (peliprosentit)',
        note: ctx.status === 'played' ? 'Kierros on jo poistunut sivulta; luvut näkyvät vain tallennetusta datasta.' : 'Eri kierrokset ovat sivun alasivuilla.',
      });
    } else {
      out.push({ label: ctx.couponSource, what: 'pelaajien osuudet' });
    }
  }
  if (ctx.odds) {
    out.push({
      label: ctx.odds.label ?? (ctx.odds.league ? `BetExplorer, ${ctx.odds.league.replace('/', ' / ')}` : 'BetExplorer'),
      url: ctx.odds.url ?? (ctx.odds.league ? fixturesUrl(ctx.odds.league) : 'https://www.betexplorer.com/football/'),
      what: ctx.odds.url ? 'vedonvälittäjän kertoimet' : 'vedonvälittäjien kertoimet (keskiarvo)',
    });
  }
  if (ctx.fromSheet) {
    out.push({ label: 'Tilastotaulukko (sheet)', url: `${REPO}/blob/main/data/sheets/${ctx.couponId}.json`, what: 'joukkueiden tämän ja viime kauden tulokset; lähteet taulukon note-kentässä' });
  }
  return out;
}

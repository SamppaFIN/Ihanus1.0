// Pikakatsaus: ottelun jokaiselle merkille (1, X, 2) lyhyet perustelut "puoltaa" ja "vastaan",
// jotta kokonaiskuva näkyy yhdellä silmäyksellä ilman että selitystä tarvitsee avata.
// Puhdas funktio: syötteenä oma arvio, pelaajien osuudet, kertoimet ja (jos on) joukkuetaulukko.
// Perustelut ovat sääntöpohjaisia ja kertovat vain sen, mikä datasta oikeasti näkyy; mitään ei keksitä.

import type { Sign, Triple } from '../engine/types.js';
import type { Record5, TeamSheet } from '../engine/sheet.js';

export interface QuickTag {
  text: string;
  tone: 'good' | 'warn' | 'neutral';
}

export interface QuickSign {
  sign: Sign;
  label: string;
  tags: QuickTag[];
  pros: string[];
  cons: string[];
  /** Kun mikään ei puolla eikä ole vastaan: neutraali rivi, jotta merkki ei jää tyhjäksi */
  note?: string;
}

export interface QuickTake {
  summary: string;
  signs: QuickSign[];
}

export interface QuickInput {
  home: string;
  away: string;
  p: Triple;
  crowd: Triple;
  market: Triple | null;
  homeSheet?: TeamSheet | null;
  awaySheet?: TeamSheet | null;
}

const SIGNS: Sign[] = ['1', 'X', '2'];
const LABEL: Record<Sign, string> = { '1': 'Kotivoitto', X: 'Tasapeli', '2': 'Vierasvoitto' };

export const QUICK = {
  /** Sama raja kuin selityksessä: oma arvio ≥ 15 % suurempi kuin pelaajien */
  underRatio: 1.15,
  overRatio: 0.87,
  /** Vähintään näin monta ottelua koti-/vierastilastossa, ennen kuin siitä sanotaan mitään */
  minVenueGames: 4,
  strongVenueWinShare: 0.55,
  weakVenueWinShare: 0.3,
  drawHeavyShare: 0.4,
  ppgGap: 0.4,
  lastSeasonGap: 0.7,
  leaderTie: 0.02,
  maxPros: 3,
  maxCons: 2,
};

const pc = (x: number) => `${Math.round(x * 100)} %`;
const fmt1 = (x: number) => x.toFixed(1).replace('.', ',');
const games = (r: Record5) => r.w + r.d + r.l;
const ppg = (r: Record5) => (3 * r.w + r.d) / Math.max(1, games(r));
const cnt = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
const word = (s: Sign) => (s === '1' ? 'kotivoitto' : s === '2' ? 'vierasvoitto' : 'tasapeli');

interface Side {
  name: string;
  sheet: TeamSheet | null | undefined;
  /** kotijoukkueella kotona, vierasjoukkueella vieraissa */
  place: 'kotiottelussa' | 'vierasottelussa';
}

function venueLines(s: Side) {
  const v = s.sheet?.info?.venue;
  if (!v || games(v) < QUICK.minVenueGames) return null;
  const n = games(v);
  const where = s.place;
  return {
    winShare: v.w / n,
    drawShare: v.d / n,
    lossShare: v.l / n,
    wins: `${s.name}: ${cnt(v.w, 'voitto', 'voittoa')} ${n} ${where}`,
    draws: `${s.name}: ${cnt(v.d, 'tasapeli', 'tasapeliä')} ${n} ${where}`,
    losses: `${s.name}: ${cnt(v.l, 'tappio', 'tappiota')} ${n} ${where}`,
    noWin: `${s.name}: ei yhtään voittoa ${n} ${where}`,
    unbeaten: `${s.name}: ei yhtään tappiota ${n} ${where}`,
    w: v.w,
    d: v.d,
    l: v.l,
    n,
  };
}

export function quickTake(i: QuickInput): QuickTake {
  const { p, crowd: q, market } = i;
  const H: Side = { name: i.home, sheet: i.homeSheet, place: 'kotiottelussa' };
  const A: Side = { name: i.away, sheet: i.awaySheet, place: 'vierasottelussa' };
  const hv = venueLines(H);
  const av = venueLines(A);
  const top = p.indexOf(Math.max(...p));
  // Lähes tasapeli kärjessä (alle 2 prosenttiyksikköä): kumpaakaan ei kutsuta yksin todennäköisimmäksi
  const leaders = SIGNS.map((_, k) => k).filter((k) => p[k]! >= p[top]! - QUICK.leaderTie);

  // Taulukon kokonaisvertailu (vain jos sarjatasot eivät ole eri)
  const hs = H.sheet;
  const as = A.sheet;
  const sameTier = hs?.tier == null || as?.tier == null || hs.tier === as.tier;
  const ppgGap = hs?.thisSeason && as?.thisSeason && sameTier ? ppg(hs.thisSeason) - ppg(as.thisSeason) : null;
  const tierGap = hs?.tier != null && as?.tier != null ? as.tier - hs.tier : 0; // >0: kotijoukkue ylemmässä sarjassa
  const leagueNote = hs?.info && as?.info ? ` (${tierGap > 0 ? hs.info.league : as.info.league} vs ${tierGap > 0 ? as.info.league : hs.info.league})` : '';
  const lastGap = hs?.lastSeasonVenue && as?.lastSeasonVenue && !hs.leagueChange && !as.leagueChange && sameTier
    ? ppg(hs.lastSeasonVenue) - ppg(as.lastSeasonVenue)
    : null;
  const closeMatch = Math.abs(p[0] - p[2]) <= 0.08;

  const signs: QuickSign[] = SIGNS.map((s, k) => {
    const pros: string[] = [];
    const cons: string[] = [];
    const tags: QuickTag[] = [];
    const ratio = p[k]! / q[k]!;
    const under = ratio >= QUICK.underRatio && p[k]! >= 0.1;
    const over = ratio <= QUICK.overRatio && q[k]! >= 0.3;

    // 1) Oma arvio ja kertoimet
    if (leaders.includes(k)) {
      tags.push({ text: leaders.length > 1 ? 'yksi todennäköisimmistä' : 'todennäköisin', tone: 'neutral' });
      pros.push(`Oma arvio: ${pc(p[k]!)} — ${leaders.length > 1 ? 'yksi ottelun todennäköisimmistä lopputuloksista' : 'ottelun todennäköisin lopputulos'}`);
    } else if (p[k]! >= 0.3) {
      pros.push(`Oma arvio: ${pc(p[k]!)}`);
    } else if (p[k]! < 0.2) {
      cons.push(`Oma arvio vain ${pc(p[k]!)}`);
    }
    if (p[k]! < 0.15 && !under) tags.push({ text: 'epätodennäköinen', tone: 'neutral' });
    if (market) {
      if (market[k]! >= 0.4) pros.push(`Kertoimet antavat ${pc(market[k]!)}`);
      else if (market[k]! < 0.15) cons.push(`Kertoimet antavat vain ${pc(market[k]!)}`);
    }

    // 2) Mitä pelaajat veikkaavat
    if (under) {
      tags.push({ text: 'pelaajat aliarvostavat', tone: 'good' });
      pros.push(`Vain ${pc(q[k]!)} pelaajista veikkaa tätä (oma arvio ${pc(p[k]!)}), joten voitto jaetaan harvempien kesken`);
    }
    if (over) {
      tags.push({ text: 'ylipelattu', tone: 'warn' });
      cons.push(`${pc(q[k]!)} pelaajista veikkaa tätä (oma arvio ${pc(p[k]!)}), joten voitto jaetaan monen kanssa`);
    }

    // 3) Joukkueiden tiedot
    if (s === '1') {
      if (hv && hv.winShare >= QUICK.strongVenueWinShare) pros.push(hv.wins);
      if (hv && hv.winShare <= QUICK.weakVenueWinShare) cons.push(`${H.name}: vain ${cnt(hv.w, 'voitto', 'voittoa')} ${hv.n} kotiottelussa`);
      if (av && av.w === 0) pros.push(av.noWin);
      if (av && av.lossShare >= QUICK.strongVenueWinShare) pros.push(av.losses);
      if (av && av.l === 0) cons.push(av.unbeaten);
      if (av && av.winShare >= QUICK.strongVenueWinShare) cons.push(av.wins);
      if (tierGap > 0) pros.push(`${H.name} pelaa ylemmässä sarjassa${leagueNote}`);
      if (tierGap < 0) cons.push(`${A.name} pelaa ylemmässä sarjassa${leagueNote}`);
      if (ppgGap != null && ppgGap >= QUICK.ppgGap) pros.push(`Tällä kaudella ${H.name} on kerännyt enemmän pisteitä (${fmt1(ppg(hs!.thisSeason!))} vs ${fmt1(ppg(as!.thisSeason!))} per ottelu)`);
      if (ppgGap != null && ppgGap <= -QUICK.ppgGap) cons.push(`Tällä kaudella ${A.name} on kerännyt enemmän pisteitä (${fmt1(ppg(as!.thisSeason!))} vs ${fmt1(ppg(hs!.thisSeason!))} per ottelu)`);
      if (lastGap != null && lastGap >= QUICK.lastSeasonGap) pros.push(`Viime kaudella ${H.name} keräsi kotona ${fmt1(ppg(hs!.lastSeasonVenue!))} ja ${A.name} vieraissa ${fmt1(ppg(as!.lastSeasonVenue!))} pistettä per ottelu`);
    } else if (s === '2') {
      if (av && av.winShare >= QUICK.strongVenueWinShare) pros.push(av.wins);
      if (av && av.l === 0) pros.push(av.unbeaten);
      if (av && av.w === 0) cons.push(av.noWin);
      if (av && av.winShare <= QUICK.weakVenueWinShare && av.w > 0) cons.push(`${A.name}: vain ${cnt(av.w, 'voitto', 'voittoa')} ${av.n} vierasottelussa`);
      if (hv && hv.winShare <= QUICK.weakVenueWinShare) pros.push(`${H.name}: vain ${cnt(hv.w, 'voitto', 'voittoa')} ${hv.n} kotiottelussa`);
      if (hv && hv.lossShare >= QUICK.strongVenueWinShare) pros.push(hv.losses);
      if (hv && hv.winShare >= QUICK.strongVenueWinShare) cons.push(hv.wins);
      if (tierGap < 0) pros.push(`${A.name} pelaa ylemmässä sarjassa${leagueNote}`);
      if (tierGap > 0) cons.push(`${H.name} pelaa ylemmässä sarjassa${leagueNote}`);
      if (ppgGap != null && ppgGap <= -QUICK.ppgGap) pros.push(`Tällä kaudella ${A.name} on kerännyt enemmän pisteitä (${fmt1(ppg(as!.thisSeason!))} vs ${fmt1(ppg(hs!.thisSeason!))} per ottelu)`);
      if (ppgGap != null && ppgGap >= QUICK.ppgGap) cons.push(`Tällä kaudella ${H.name} on kerännyt enemmän pisteitä (${fmt1(ppg(hs!.thisSeason!))} vs ${fmt1(ppg(as!.thisSeason!))} per ottelu)`);
      if (lastGap != null && lastGap <= -QUICK.lastSeasonGap) pros.push(`Viime kaudella ${A.name} keräsi vieraissa ${fmt1(ppg(as!.lastSeasonVenue!))} ja ${H.name} kotona ${fmt1(ppg(hs!.lastSeasonVenue!))} pistettä per ottelu`);
    } else {
      if (closeMatch) pros.push('Joukkueet ovat arviossamme lähes yhtä vahvat');
      if (hv && hv.drawShare >= QUICK.drawHeavyShare) pros.push(hv.draws);
      if (av && av.drawShare >= QUICK.drawHeavyShare) pros.push(av.draws);
      if (Math.max(p[0], p[2]) >= 0.6) cons.push('Toinen joukkue on selvä suosikki, tasapeli on epätodennäköisempi');
    }

    const out: QuickSign = {
      sign: s,
      label: LABEL[s],
      tags,
      pros: dedupe(pros).slice(0, QUICK.maxPros),
      cons: dedupe(cons).slice(0, QUICK.maxCons),
    };
    if (!out.pros.length && !out.cons.length) out.note = `Ei erityistä puolesta tai vastaan: oma arvio ${pc(p[k]!)}, pelaajista ${pc(q[k]!)} veikkaa tätä`;
    return out;
  });

  return { summary: summaryOf(i, signs, leaders), signs };
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

const joinFi = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ja ${xs[xs.length - 1]}`);

function summaryOf(i: QuickInput, signs: QuickSign[], leaders: number[]): string {
  const { p, crowd: q } = i;
  const parts: string[] = [];
  const lead = leaders.map((k) => word(SIGNS[k]!));
  parts.push(
    leaders.length > 1
      ? `Todennäköisimmät: ${joinFi(lead)} (noin ${pc(p[leaders[0]!]!)}).`
      : `Todennäköisin: ${lead[0]} (${pc(p[leaders[0]!]!)}).`,
  );
  const has = (k: number, tag: string) => signs[k]!.tags.some((t) => t.text === tag);
  const value = SIGNS.map((_, k) => k).filter((k) => has(k, 'pelaajat aliarvostavat'));
  if (value.length) {
    parts.push(`Pelaajat aliarvostavat: ${joinFi(value.map((k) => `${word(SIGNS[k]!)} (arvio ${pc(p[k]!)}, pelaajat ${pc(q[k]!)})`))}.`);
  }
  const over = leaders.filter((k) => has(k, 'ylipelattu'));
  if (over.length) parts.push(`Ylipelattu: ${joinFi(over.map((k) => `${word(SIGNS[k]!)} (${pc(q[k]!)} pelaajista veikkaa)`))}.`);
  return parts.join(' ');
}

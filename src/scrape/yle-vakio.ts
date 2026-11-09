// Ylen Teksti-TV sivu 479: Vakion kohteet, pelijakauma (peliprosentit), vaihto ja takuupotti/bonus.
// Sivu on staattista HTML:ää jossa on yksi <pre>-tekstilohko → tavallinen HTTP-haku riittää,
// Playwrightia ei tarvita.

import type { Triple } from '../engine/types.js';
import { fromPercents } from '../engine/prob.js';

export interface YleMatch {
  n: number;
  home: string;
  away: string;
  /** Prosentit sellaisenaan lähteestä (summa 99–101) */
  percents: [number, number, number];
  crowd: Triple;
  /** Rivin "M"-merkintä (merkitys Ylen sivulla ei ole dokumentoitu) */
  flag: boolean;
}

export interface YleVakioPage {
  title: string; // esim. "Lauantaivakio 1"
  krs: number | null;
  /** Kellonaika otsikkorivillä (esim. "15.00"), jos on */
  headerTime: string | null;
  /** Pelijakauman päivityshetki (esim. "16.58") */
  snapshotTime: string | null;
  turnoverEur: number | null;
  guaranteeEur: number | null;
  bonusPoolEur: number | null;
  /** "KOHDE SULJETTU" */
  closed: boolean;
  /** "Pelaaminen päättyy su 08.11. klo 14.58" → UTC-ISO (vaatii `now`-viitteen vuoden päättelyyn), muuten null */
  closesAt: string | null;
  /** "Pelinumero 2" */
  pelinumero: number | null;
  /** "Rivihinta 0,10 €" — luetaan sivulta; null jos riviä ei ole (esim. suljetun kohteen 1. alasivu) */
  rowPriceEur: number | null;
  /** Alasivu "2/8" otsikkorivillä */
  sub: { n: number; of: number } | null;
  matches: YleMatch[];
}

const eur = (s: string): number => Number(s.replace(/\s+/g, ''));

const MATCH_RE = /^\s*(\d{1,2})\.\s+(.+?)\s+-\s+(.+?)\s+(M\s+)?(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*$/;

/** Suomen aika → UTC-millisekunnit (huomioi kesäajan; kaksi iteraatiota riittää). */
export function helsinkiToUtcMs(y: number, mo: number, d: number, hh: number, mm: number): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Helsinki', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
  const offsetAt = (utc: number): number => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(utc)).map((x) => [x.type, Number(x.value)])) as Record<string, number>;
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!) - utc;
  };
  const wall = Date.UTC(y, mo - 1, d, hh, mm);
  let utc = wall - offsetAt(wall);
  utc = wall - offsetAt(utc);
  return utc;
}

function closingIso(day: number, month: number, hh: number, mm: number, now: Date): string {
  const nowYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Helsinki', year: 'numeric' }).format(now));
  let ms = helsinkiToUtcMs(nowYear, month, day, hh, mm);
  if (ms < now.getTime() - 200 * 86400000) ms = helsinkiToUtcMs(nowYear + 1, month, day, hh, mm); // joulu → tammi
  return new Date(ms).toISOString();
}

export function parseYleVakio(text: string, now: Date = new Date()): YleVakioPage {
  const lines = text.replace(/\r/g, '').split('\n');
  const page: YleVakioPage = {
    title: '',
    krs: null,
    headerTime: null,
    snapshotTime: null,
    turnoverEur: null,
    guaranteeEur: null,
    bonusPoolEur: null,
    closed: /KOHDE SULJETTU/i.test(text),
    closesAt: null,
    pelinumero: null,
    rowPriceEur: null,
    sub: null,
    matches: [],
  };

  for (const line of lines) {
    const head = line.match(/^\s*(?:(\d{1,2}[.:]\d{2})\s+)?([A-Za-zÅÄÖåäö]*vakio(?:\s+\d+)?)\s+KRS\s+(\d+)/i);
    if (head && !page.title) {
      page.headerTime = head[1] ?? null;
      page.title = head[2]!.trim();
      page.krs = Number(head[3]);
      const sub = line.match(/(\d+)\/(\d+)\s*$/);
      if (sub) page.sub = { n: Number(sub[1]), of: Number(sub[2]) };
      continue;
    }
    const end = line.match(/Pelaaminen\s+päättyy\s+\S+\s+(\d{1,2})\.(\d{1,2})\.\s+klo\s+(\d{1,2})[.:](\d{2})/i);
    if (end) {
      page.closesAt = closingIso(Number(end[1]), Number(end[2]), Number(end[3]), Number(end[4]), now);
      continue;
    }
    const num = line.match(/Pelinumero\s+(\d+)/i);
    const price = line.match(/Rivihinta\s+(\d+(?:[.,]\d+)?)\s*€/i);
    if (num || price) {
      if (num) page.pelinumero = Number(num[1]);
      if (price) page.rowPriceEur = Number(price[1]!.replace(',', '.'));
      continue;
    }
    const jak = line.match(/Pelijakauma\s+(\d{1,2}[.:]\d{2}),?\s*vaihto\s+([\d\s]+?)\s*€/i);
    if (jak) {
      page.snapshotTime = jak[1]!;
      page.turnoverEur = eur(jak[2]!);
      continue;
    }
    const tak = line.match(/Takuupotti\s+([\d\s]+?)\s*e\b/i);
    if (tak) {
      page.guaranteeEur = eur(tak[1]!);
      continue;
    }
    const bon = line.match(/Bonuskierros,?\s*([\d\s]+?)\s*e\b/i);
    if (bon) {
      page.bonusPoolEur = eur(bon[1]!);
      continue;
    }
    const m = line.match(MATCH_RE);
    if (m) {
      const percents: [number, number, number] = [Number(m[5]), Number(m[6]), Number(m[7])];
      const total = percents[0] + percents[1] + percents[2];
      if (total < 95 || total > 105) continue; // ei ole pelijakauma
      page.matches.push({
        n: Number(m[1]),
        home: m[2]!.trim(),
        away: m[3]!.trim(),
        percents,
        crowd: fromPercents(percents),
        flag: Boolean(m[4]),
      });
    }
  }
  return page;
}

/** Poimii <pre>-lohkon (tai koko sivun tekstin) ja purkaa entiteetit. */
export function extractPre(html: string): string {
  const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  const raw = m ? m[1]! : html;
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

export function yleTextUrl(page = 479, sub = 1): string {
  return `https://yle.fi/tekstitv/txt/${page}_${String(sub).padStart(4, '0')}.htm`;
}

/**
 * Hakee kaikki Vakio-alasivut (479_0001 … 479_000N, N luetaan otsikkorivin "n/N"-merkinnästä) ja
 * palauttaa jäsennetyt kupongit. Samasta kierroksesta (otsikko + kierros) säilytetään tuorein jakauma.
 * Hakujen välillä pieni tauko; Yle on julkinen palvelu eikä sitä tule kuormittaa.
 */
export async function fetchYleVakioAll(f: typeof fetch = fetch, now: () => Date = () => new Date(), base = 'https://yle.fi/tekstitv/txt', delayMs = 300): Promise<Array<{ raw: string; parsed: YleVakioPage }>> {
  const get = async (sub: number) => {
    const res = await f(`${base}/479_${String(sub).padStart(4, '0')}.htm`, { headers: { 'user-agent': 'Ihanus1.0 (+https://github.com/SamppaFIN/Ihanus1.0)' } });
    if (!res.ok) throw new Error(`Yle 479/${sub}: HTTP ${res.status}`);
    const raw = extractPre(await res.text());
    return { raw, parsed: parseYleVakio(raw, now()) };
  };
  const first = await get(1);
  const total = Math.min(first.parsed.sub?.of ?? 1, 12);
  const pages = [first];
  for (let i = 2; i <= total; i++) {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    try {
      pages.push(await get(i));
    } catch {
      /* alasivu puuttuu → ohitetaan */
    }
  }
  const byKey = new Map<string, { raw: string; parsed: YleVakioPage }>();
  const rank = (x: YleVakioPage) => (x.snapshotTime ?? '').replace(/\D/g, '').padStart(4, '0');
  for (const p of pages) {
    if (!p.parsed.matches.length) continue;
    const key = `${p.parsed.title}|${p.parsed.krs}`;
    const old = byKey.get(key);
    if (!old) {
      byKey.set(key, p);
      continue;
    }
    // Sama kierros kahdella alasivulla: tuorein jakauma voittaa, mutta sulkeutumisaika/rivihinta/pelinumero täydennetään toisesta
    const [win, lose] = rank(p.parsed) > rank(old.parsed) ? [p, old] : [old, p];
    win.parsed.closesAt ??= lose.parsed.closesAt;
    win.parsed.rowPriceEur ??= lose.parsed.rowPriceEur;
    win.parsed.pelinumero ??= lose.parsed.pelinumero;
    byKey.set(key, win);
  }
  return [...byKey.values()];
}

export async function fetchYleVakio(page = 479, sub = 1, f: typeof fetch = fetch): Promise<{ raw: string; parsed: YleVakioPage }> {
  const res = await f(yleTextUrl(page, sub), { headers: { 'user-agent': 'Ihanus1.0 (+https://github.com/SamppaFIN/Ihanus1.0)' } });
  if (!res.ok) throw new Error(`Yle ${page}/${sub}: HTTP ${res.status}`);
  const raw = extractPre(await res.text());
  return { raw, parsed: parseYleVakio(raw) };
}

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
  matches: YleMatch[];
}

const eur = (s: string): number => Number(s.replace(/\s+/g, ''));

const MATCH_RE = /^\s*(\d{1,2})\.\s+(.+?)\s+-\s+(.+?)\s+(M\s+)?(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*$/;

export function parseYleVakio(text: string): YleVakioPage {
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
    matches: [],
  };

  for (const line of lines) {
    const head = line.match(/^\s*(?:(\d{1,2}[.:]\d{2})\s+)?([A-Za-zÅÄÖåäö]*vakio(?:\s+\d+)?)\s+KRS\s+(\d+)/i);
    if (head && !page.title) {
      page.headerTime = head[1] ?? null;
      page.title = head[2]!.trim();
      page.krs = Number(head[3]);
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

export async function fetchYleVakio(page = 479, sub = 1, f: typeof fetch = fetch): Promise<{ raw: string; parsed: YleVakioPage }> {
  const res = await f(yleTextUrl(page, sub), { headers: { 'user-agent': 'Ihanus1.0 (+https://github.com/SamppaFIN/Ihanus1.0)' } });
  if (!res.ok) throw new Error(`Yle ${page}/${sub}: HTTP ${res.status}`);
  const raw = extractPre(await res.text());
  return { raw, parsed: parseYleVakio(raw) };
}

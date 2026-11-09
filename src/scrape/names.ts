// Joukkuenimien sumea täsmäytys: Teksti-TV katkaisee nimet (12–13 merkkiä, "Mancheste.C",
// "Middlesbrou", "West Bromwi") eikä käytä samoja nimiä kuin kerroinlähteet.

const ALIASES: Record<string, string> = {
  wolves: 'wolverhampton wanderers',
  spurs: 'tottenham hotspur',
  tottenham: 'tottenham hotspur',
  'man utd': 'manchester united',
  'man city': 'manchester city',
  'nottm forest': 'nottingham forest',
  qpr: 'queens park rangers',
  'west brom': 'west bromwich albion',
  'sheff utd': 'sheffield united',
  'sheff wed': 'sheffield wednesday',
  leverkusen: 'bayer leverkusen',
  'fc koln': 'koln',
  milan: 'ac milan',
  inter: 'inter milan',
};

export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/ø/g, 'o')
    .replace(/[.\-_/']/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(['fc', 'afc', 'sc', 'cf', 'ac', 'if', 'and', 'of', 'the', 'hove']);

function tokens(s: string): string[] {
  const n = normName(s);
  const aliased = ALIASES[n] ?? n;
  return aliased.split(' ').filter((t) => t && !STOP.has(t));
}

/** Yhden Ylen tokenin ja ehdokkaan tokenin samankaltaisuus 0..1 */
function tokenScore(y: string, c: string): number {
  if (y === c) return 1;
  if (y.length >= 3 && c.startsWith(y)) return 0.9; // Ylen katkaisu: "mancheste" → "manchester"
  if (c.length >= 3 && y.startsWith(c)) return 0.85; // lähteen lyhenne: "bromwi" → "brom" (West Brom)
  if (y.length === 1 && c.startsWith(y)) return 0.6; // alkukirjain: "u" → "united", "c" → "city"
  return 0;
}

export function nameScore(yle: string, candidate: string): number {
  const yt = tokens(yle);
  const ct = tokens(candidate);
  if (!yt.length || !ct.length) return 0;
  const used = new Set<number>();
  let total = 0;
  let lonelyInitials = 0; // Ylen loppukirjain ilman vastinetta ("Cardiff C" vs "Cardiff")
  for (const y of yt) {
    let best = 0;
    let bi = -1;
    ct.forEach((c, i) => {
      if (used.has(i)) return;
      const s = tokenScore(y, c);
      if (s > best) {
        best = s;
        bi = i;
      }
    });
    if (bi >= 0) used.add(bi);
    else if (y.length === 1) lonelyInitials++;
    total += best;
  }
  // Jokainen Ylen token pitää löytyä (painotus) — ehdokkaan ylimääräiset sanat rangaistaan lievästi.
  // Yksinäinen alkukirjain ohitetaan vain jos ehdokkaan kaikki sanat tulivat katetuksi: "Cardiff C" = "Cardiff",
  // mutta "Manchester C" ≠ "Manchester United".
  const denom = used.size === ct.length ? Math.max(1, yt.length - lonelyInitials) : yt.length;
  const coverage = total / denom;
  const extra = (ct.length - used.size) * 0.04;
  return Math.max(0, coverage - extra);
}

export interface NameMatch {
  candidate: string;
  score: number;
}

/** Palauttaa parhaan ehdokkaan jos se on riittävän hyvä ja selvästi paras. */
export function bestMatch(yle: string, candidates: readonly string[], threshold = 0.75): NameMatch | null {
  let best: NameMatch | null = null;
  let second = 0;
  for (const c of candidates) {
    const score = nameScore(yle, c);
    if (!best || score > best.score) {
      if (best) second = Math.max(second, best.score);
      best = { candidate: c, score };
    } else {
      second = Math.max(second, score);
    }
  }
  if (!best || best.score < threshold) return null;
  if (second > 0 && best.score - second < 0.1) return null; // epäselvä: esim. "Manchester" ilman C/U
  return best;
}

export function pairKey(home: string, away: string): string {
  return `${normName(home)}|${normName(away)}`;
}

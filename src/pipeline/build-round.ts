// Kierroksen rakennus: kuponki (+ taulukko + kertoimet) → UI:n tarvitsema näkymä
// (ottelukohtaiset todennäköisyydet, rivi/järjestelmä-polku, jälkikäteisarvio).

import { devig } from '../engine/prob.js';
import { DEFAULT_FUSE, fuse, type Fused, type FuseConfig } from '../engine/prob.js';
import { sheetProbs, type TeamSheet } from '../engine/sheet.js';
import { DEFAULT_PRIZE_MODEL, evConfigFor, type PrizeModel } from '../engine/prize.js';
import { evaluate, expectedOtherWinners, hitCounts } from '../engine/ev.js';
import { describeSelection, optimize } from '../engine/optimize.js';
import { explainMatch, type MatchExplain } from './explain.js';
import { MATCHES_PER_COUPON, type Coupon, type CouponMatch, type Sign, type Triple } from '../engine/types.js';

export interface SheetFile {
  couponId: string;
  note?: string;
  matches: Array<{ n: number; home: TeamSheet | null; away: TeamSheet | null }>;
}

export interface OddsFile {
  fetchedAt: string;
  source: string;
  matches: Array<{ n: number; odds: [number, number, number]; event?: string; league?: string; url?: string; label?: string }>;
}

export interface BuildOptions {
  today: string; // yyyy-mm-dd
  budgetEur: number;
  fuse?: FuseConfig;
  prize?: PrizeModel;
}

export interface MatchView {
  n: number;
  home: string;
  away: string;
  crowd: Triple | null;
  crowdEstimated: boolean;
  market: Triple | null;
  model: Triple | null;
  p: Triple | null;
  basis: Fused['basis'] | null;
  /** p / crowd per merkki: >1 = oma arvio pitää merkkiä aliarvostettuna */
  ratio: Triple | null;
  result: Sign | null;
  /** Selkokielinen selitys ja lähdelinkit */
  explain: MatchExplain;
}

export interface StepView {
  rows: number;
  costEur: number;
  evEur: number;
  roi: number;
  valueMultiple: number;
  pAtLeast: [number, number, number, number];
  /** Sama järjestelmä varovaisemmalla arviolla (luottamus omaan arvioon puolitettu, muiden rivit ×1,5) */
  valueMultipleLow: number;
  roiLow: number;
  selection: string[];
  added: { match: number; sign: Sign } | null;
  /** Vain pelatuille kierroksille */
  hits?: [number, number, number, number];
  /** Vain jos voitonjako tiedossa: Σ osumat × euroa per voittava rivi */
  payoutEur?: number | null;
}

export type RoundStatus = 'open' | 'closed' | 'played';

export interface RoundView {
  id: string;
  label: string;
  date: string;
  status: RoundStatus;
  turnoverEur: number | null;
  turnoverEstimated: boolean;
  guaranteeEur: number | null;
  bonusPoolEur: number | null;
  rowPriceEur: number;
  /** true = hintaa ei ole luettu Teksti-TV:ltä vaan oletettu */
  rowPriceEstimated: boolean;
  avgRowEv: number | null;
  /** Arvioidut potit luokille 13, 12, 11, 10 oikein (oletetuilla luokkaosuuksilla) */
  pools: [number, number, number, number] | null;
  source: string;
  note: string | null;
  links: Array<{ label: string; url: string }>;
  hasEdge: boolean;
  /** Miksi polkua ei ole laskettu, jos ei ole */
  noPathReason: string | null;
  matches: MatchView[];
  path: StepView[];
  prizes: Coupon['prizes'] | null;
  calibration: {
    expectedWinners: [number, number, number, number];
    impliedWinners: Array<number | null> | null;
  } | null;
}

const SIGN_IDX: Record<Sign, number> = { '1': 0, X: 1, '2': 2 };

function statusOf(c: Coupon, today: string): RoundStatus {
  if (c.matches.length > 0 && c.matches.every((m) => m.result)) return 'played';
  return c.date < today ? 'closed' : 'open';
}

export function buildRound(c: Coupon, sheet: SheetFile | null, odds: OddsFile | null, opts: BuildOptions): RoundView {
  const fuseCfg = opts.fuse ?? DEFAULT_FUSE;
  const prize = opts.prize ?? DEFAULT_PRIZE_MODEL;

  const matches: CouponMatch[] = c.matches.map((m) => {
    const sh = sheet?.matches.find((x) => x.n === m.n);
    const od = odds?.matches.find((x) => x.n === m.n);
    const model = sh?.home && sh?.away ? sheetProbs(sh.home, sh.away) : (m.model ?? null);
    const market = od ? devig(od.odds) : (m.market ?? null);
    return { ...m, model, market };
  });

  const status = statusOf(c, opts.today);
  const views: MatchView[] = matches.map((m) => {
    let f: Fused | null = null;
    try {
      f = fuse(m, fuseCfg);
    } catch {
      f = null;
    }
    const base = {
      n: m.n,
      home: m.home,
      away: m.away,
      crowd: m.crowd,
      crowdEstimated: Boolean(m.crowdEstimated),
      market: m.market ?? null,
      model: m.model ?? null,
      p: f?.p ?? null,
      basis: f?.basis ?? null,
      ratio: f && m.crowd ? (f.p.map((x, i) => x / m.crowd![i]!) as Triple) : null,
      result: m.result ?? null,
      facts: m.facts,
    };
    const sh = sheet?.matches.find((x) => x.n === m.n);
    const od = odds?.matches.find((x) => x.n === m.n);
    const explain = explainMatch(base, {
      status,
      couponId: c.id,
      couponSource: c.source,
      fromSheet: Boolean(sh?.home && sh?.away),
      odds: od ? { league: od.league, event: od.event, url: od.url, label: od.label } : null,
    });
    return { ...base, explain };
  });

  const hasEdge = views.some((v) => v.basis && v.basis !== 'crowd');

  const base: RoundView = {
    id: c.id,
    label: c.label,
    date: c.date,
    status,
    turnoverEur: c.turnoverEur,
    turnoverEstimated: Boolean(c.turnoverEstimated),
    guaranteeEur: c.guaranteeEur,
    bonusPoolEur: c.bonusPoolEur,
    rowPriceEur: c.rowPriceEur,
    rowPriceEstimated: Boolean(c.rowPriceEstimated),
    avgRowEv: null,
    pools: null,
    source: c.source,
    note: c.note ?? null,
    links: c.sources ?? [],
    hasEdge,
    noPathReason: null,
    matches: views,
    path: [],
    prizes: c.prizes ?? null,
    calibration: null,
  };

  // Potit lasketaan vain 13 ottelun Vakiolle: muiden pelien palkintoluokkia ei tunneta
  if (c.turnoverEur != null && c.matches.length === MATCHES_PER_COUPON) {
    const cfg = evConfigFor(c, prize);
    base.avgRowEv = cfg.avgRowEv;
    base.pools = cfg.pools;
    if (status === 'played' && c.matches.every((m) => m.crowd)) {
      const res = c.matches.map((m) => SIGN_IDX[m.result!]);
      const q = c.matches.map((m) => m.crowd!);
      const payoutPool = c.turnoverEur * prize.payoutRatio;
      base.calibration = {
        expectedWinners: expectedOtherWinners(q, res, cfg.otherRows),
        impliedWinners: c.prizes ? c.prizes.map((pz, j) => (pz.eur > 0 ? (prize.shares[j]! * payoutPool) / pz.eur : null)) : null,
      };
    }
  }

  if (c.matches.length !== MATCHES_PER_COUPON) {
    base.noPathReason = `Kierroksella on ${c.matches.length} ottelua. Rivisuositusta ei lasketa, koska tämän pelin palkintoluokkia ei tunneta (moottori osaa vain 13 ottelun Vakion). Ottelukohtaiset selitykset löytyvät silti alta.`;
    return base;
  }
  if (!hasEdge) {
    base.noPathReason = 'Ei omaa dataa (ei taulukkoa eikä kertoimia) → oma arvio = pelijakauma, jolloin ei ole etua. Lisää data/sheets tai data/odds.';
    return base;
  }
  if (c.turnoverEur == null) {
    base.noPathReason = 'Vaihto ei ole tiedossa → potteja ei voi arvioida.';
    return base;
  }
  if (views.some((v) => !v.crowd || !v.p)) {
    base.noPathReason = 'Peliprosentit puuttuvat joiltain otteluilta → odotetaan Teksti-TV:n pelijakaumaa.';
    return base;
  }

  const cfg = evConfigFor(c, prize);
  const p = views.map((v) => v.p!);
  const q = views.map((v) => v.crowd!);
  const steps = optimize(p, q, cfg, { maxCostEur: opts.budgetEur });
  // Varovainen arvio: luottamus omaan arvioon puolitettu ja muiden rivien määrä ×1,5 (pelaajat klusteroituvat samoille riveille)
  const pLow = matches.map((m) => fuse(m, fuseCfg, 0.5).p);
  const cfgLow = { ...cfg, otherRows: cfg.otherRows * 1.5 };
  const resultIdx = status === 'played' ? c.matches.map((m) => SIGN_IDX[m.result!]) : null;
  base.path = steps.map((s) => {
    const low = evaluate(s.selection, pLow, q, cfgLow);
    const v: StepView = {
      rows: s.stats.rows,
      costEur: s.stats.costEur,
      evEur: s.stats.evEur,
      roi: s.stats.roi,
      valueMultiple: s.stats.valueMultiple,
      pAtLeast: s.stats.pAtLeast,
      valueMultipleLow: low.valueMultiple,
      roiLow: low.roi,
      selection: describeSelection(s.selection),
      added: s.added ? { match: s.added.match, sign: s.added.sign } : null,
    };
    if (resultIdx) {
      v.hits = hitCounts(s.selection, resultIdx);
      v.payoutEur = c.prizes ? v.hits.reduce((sum, h, j) => sum + h * (c.prizes![j]?.eur ?? 0), 0) : null;
    }
    return v;
  });
  return base;
}

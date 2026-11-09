// Ylen Teksti-TV -sivun yhdistäminen kuponkitiedostoon: päivittää pelijakauman, vaihdon ja
// takuupotin/bonuksen, mutta säilyttää käsin lisätyt tiedot (tulokset, mallit, voitonjako).

import type { Coupon, CouponMatch } from '../engine/types.js';
import type { YleVakioPage } from '../scrape/yle-vakio.js';

export function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function couponId(date: string, page: YleVakioPage): string {
  return `${date}-${slug(page.title || 'vakio')}`;
}

export interface MergeResult {
  coupon: Coupon;
  created: boolean;
  /** Varoitukset, esim. ottelun nimi vaihtunut tai ottelumäärä muuttunut */
  warnings: string[];
}

export function mergeYleIntoCoupon(existing: Coupon | null, page: YleVakioPage, date: string): MergeResult {
  const warnings: string[] = [];
  const id = existing?.id ?? couponId(date, page);
  const now = `Yle Teksti-TV 479${page.snapshotTime ? ` (pelijakauma ${page.snapshotTime})` : ''}`;

  const matches: CouponMatch[] = page.matches.map((pm) => {
    const old = existing?.matches.find((m) => m.n === pm.n);
    if (old && (old.home !== pm.home || old.away !== pm.away)) {
      // Nimet voivat olla käsin täydennettyjä (esim. "Manchester C") — säilytetään vanhat, varoitetaan vain jos ne eivät muistuta toisiaan.
      if (old.home.slice(0, 4).toLowerCase() !== pm.home.slice(0, 4).toLowerCase()) {
        warnings.push(`Ottelu ${pm.n}: nimi muuttui "${old.home} - ${old.away}" → "${pm.home} - ${pm.away}"`);
      }
    }
    const crowd = pm.crowd.map((x) => Math.round(x * 10000) / 10000) as CouponMatch['crowd'];
    const merged: CouponMatch = { ...(old ?? {}), n: pm.n, home: old?.home ?? pm.home, away: old?.away ?? pm.away, crowd };
    delete merged.crowdEstimated; // luettu lähteestä → ei enää arvio
    return merged;
  });
  if (existing && existing.matches.length !== page.matches.length) {
    warnings.push(`Ottelumäärä ${existing.matches.length} → ${page.matches.length}`);
  }
  if (page.matches.length !== 13) warnings.push(`Sivulla ${page.matches.length} ottelua (Vakio on 13) — moottori ei laske polkua tälle`);

  const coupon: Coupon = {
    ...(existing ?? {}),
    id,
    label: existing?.label ?? `${page.title}${page.krs ? ` (krs ${page.krs})` : ''}`,
    date: existing?.date ?? date,
    turnoverEur: page.turnoverEur ?? existing?.turnoverEur ?? null,
    turnoverEstimated: page.turnoverEur != null ? undefined : existing?.turnoverEstimated,
    guaranteeEur: page.guaranteeEur ?? existing?.guaranteeEur ?? null,
    bonusPoolEur: page.bonusPoolEur ?? existing?.bonusPoolEur ?? null,
    rowPriceEur: existing?.rowPriceEur ?? 0.25,
    source: existing?.source.includes('Yle Teksti-TV 479') ? existing.source : now,
    matches,
  };
  if (coupon.turnoverEstimated === undefined) delete coupon.turnoverEstimated;
  return { coupon, created: !existing, warnings };
}

const WEEKDAYS: Record<string, number> = { sunnuntai: 0, maanantai: 1, tiistai: 2, keskiviikko: 3, torstai: 4, perjantai: 5, lauantai: 6 };

/**
 * Kierroksen pelipäivä otsikosta ("Lauantaivakio 1" → seuraava lauantai tästä päivästä lukien).
 * Näin perjantaina ja lauantaina haettu sama kierros saa saman id:n. Tuntematon otsikko → annettu päivä.
 */
export function playDateFor(title: string, today: string): string {
  const key = Object.keys(WEEKDAYS).find((d) => slug(title).startsWith(d));
  if (!key) return today;
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const base = new Date(Date.UTC(y, m - 1, d));
  const add = (WEEKDAYS[key]! - base.getUTCDay() + 7) % 7;
  base.setUTCDate(base.getUTCDate() + add);
  return base.toISOString().slice(0, 10);
}

/** Etsii olemassa olevan kupongin samalle kierrokselle (sama otsikko + kierrosnumero, ±8 pv). Muuten null. */
export function findExisting(coupons: readonly Coupon[], page: YleVakioPage, today: string): Coupon | null {
  const label = `${page.title}${page.krs ? ` (krs ${page.krs})` : ''}`;
  const t = Date.parse(today);
  return (
    coupons.find((c) => c.label === label && Math.abs(Date.parse(c.date) - t) <= 8 * 86400000) ?? null
  );
}

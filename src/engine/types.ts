// Ihanus1.0 — yhteiset tyypit.
// Todennäköisyydet ovat aina järjestyksessä [1, X, 2] ja summaavat ≈ 1.

export type Sign = '1' | 'X' | '2';
export const SIGNS: Sign[] = ['1', 'X', '2'];
export type Triple = [number, number, number];

/** Yksi lähteistetty tieto ottelusta (esim. ryhmävaiheen tulos). Jokaisella on oma linkki. */
export interface MatchFact {
  text: string;
  label: string;
  url: string;
}

export interface CouponMatch {
  n: number;
  home: string;
  away: string;
  league?: string;
  kickoff?: string;
  /** Peliprosentit (pelijakauma) osuuksina 0..1. null = ei vielä julkaistu. */
  crowd: Triple | null;
  /** true kun jakauma on arvio eikä luettu lähteestä */
  crowdEstimated?: boolean;
  /** Markkinan devigattu todennäköisyys (kertoimista), jos saatavilla */
  market?: Triple | null;
  /** Tilastomallin todennäköisyys (käsintehty taulukko → sheet.ts) */
  model?: Triple | null;
  /** Toteutunut tulos, jos ottelu on pelattu */
  result?: Sign | null;
  /** Käsin kerätyt, lähteistetyt taustatiedot (näytetään selityksessä) */
  facts?: MatchFact[];
}

export interface PrizeClass {
  /** Montako oikein, esim. 13 */
  correct: number;
  /** Voittajien lkm, null = ei saatavilla lähteestä */
  winners: number | null;
  /** Euroa per voittava rivi */
  eur: number;
}

export interface Coupon {
  id: string;
  label: string;
  /** Pelipäivä ISO (yyyy-mm-dd) */
  date: string;
  /** Pelivaihto euroina (Teksti-TV 479: "vaihto"). null = ei tiedossa. */
  turnoverEur: number | null;
  /** true kun vaihto on johdettu muualta (esim. maksetuista voitoista) */
  turnoverEstimated?: boolean;
  /** "Takuupotti X e ainoalle täysosumalle" */
  guaranteeEur: number | null;
  /** "Bonuskierros, X e jaetaan täysosumille" */
  bonusPoolEur: number | null;
  rowPriceEur: number;
  /** true kun rivin hinta on oletus (ei luettu Teksti-TV:n "Rivihinta"-riviltä) */
  rowPriceEstimated?: boolean;
  /** Pelaaminen päättyy (UTC-ISO), Teksti-TV 479 "Pelaaminen päättyy …" */
  closesAt?: string | null;
  source: string;
  matches: CouponMatch[];
  /** Toteutunut voitonjako (Veikkauksen tiedote / Teksti-TV 478) */
  prizes?: PrizeClass[] | null;
  /** Maksettujen voittojen yhteissumma, jos tiedossa mutta vaihto ei ole */
  paidOutEur?: number | null;
  note?: string;
  /** Kierroksen yleiset lähteet (linkit), näytetään kierrosnäkymässä */
  sources?: Array<{ label: string; url: string }>;
}

export const MATCHES_PER_COUPON = 13;

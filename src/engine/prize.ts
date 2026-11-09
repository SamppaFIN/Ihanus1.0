// Vakion palkintomalli: miten kierroksen vaihto jakautuu luokille ja kuinka monta
// "muuta" voittajaa meidän kanssamme jakaa potin.
//
// TÄRKEÄÄ: voittoluokkien jako-osuuksia ei ole saatavilla Veikkauksen säännöistä
// tällä hetkellä, joten ne on estimoitu kahdesta julkaistusta kierroksesta
// (24.10.2026 ja 28.7.2026): 13 oikein ≈ 54–58 %, 12 oikein ≈ 15–16 %,
// 11 oikein ≈ 10–11 %, 10 oikein ≈ 16–18 % maksetuista voitoista.
// Palautusprosentti on oletus (asetus 1414/2016: urheilutulosveikkauksissa keskimäärin 60–70 %).
// Molemmat on tarkoitus kalibroida kun lisää kierroksia kertyy (ks. calibrate.ts).

import type { Coupon } from './types.js';

export interface PrizeModel {
  /** Maksettava osuus vaihdosta */
  payoutRatio: number;
  /** Luokkien 13, 12, 11, 10 oikein osuudet maksetuista voitoista (summa 1) */
  shares: [number, number, number, number];
  /**
   * Kerroin muiden pelaajien rivimäärälle. Pelijakaumat ovat merkkien osuuksia,
   * eivät rivien: pelaajat klusteroituvat samoille riveille, ja 24.10.2026
   * toteutui 32 kpl 12 oikein -tulosta kun riippumattomuusoletus antoi ~15.
   */
  crowdScale: number;
}

export const DEFAULT_PRIZE_MODEL: PrizeModel = {
  payoutRatio: 0.65,
  shares: [0.56, 0.16, 0.11, 0.17],
  crowdScale: 1,
};

export interface EvConfig {
  rowPriceEur: number;
  /** Muiden pelaajien arvioitu rivimäärä */
  otherRows: number;
  /** Luokkien 13, 12, 11, 10 potit euroina */
  pools: [number, number, number, number];
  /** Takuupotti ainoalle täysosumalle */
  guaranteeEur: number;
  /** Keskimääräisen rivin odotettu voitto = koko voittopotti / rivit */
  avgRowEv: number;
}

/** Vaihto pitää olla tiedossa; muuten ei voi arvioida potteja. */
export function evConfigFor(c: Coupon, pm: PrizeModel = DEFAULT_PRIZE_MODEL): EvConfig {
  if (c.turnoverEur == null) throw new Error(`Kierroksella ${c.id} ei ole vaihtoa — potteja ei voi arvioida`);
  const payoutPool = c.turnoverEur * pm.payoutRatio;
  const rows = c.turnoverEur / c.rowPriceEur;
  const pools: EvConfig['pools'] = [
    Math.max(pm.shares[0] * payoutPool, c.bonusPoolEur ?? 0),
    pm.shares[1] * payoutPool,
    pm.shares[2] * payoutPool,
    pm.shares[3] * payoutPool,
  ];
  return {
    rowPriceEur: c.rowPriceEur,
    otherRows: rows * pm.crowdScale,
    pools,
    guaranteeEur: c.guaranteeEur ?? 0,
    avgRowEv: payoutPool / rows,
  };
}

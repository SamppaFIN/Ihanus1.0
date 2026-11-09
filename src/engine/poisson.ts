// Poisson-tulosmatriisi Dixon–Coles-korjauksella (matalat tulokset).
// Sama menetelmä kuin Toni1.0:n analyze/poisson.ts, tiivistettynä 1X2:ta varten.

import { normalize } from './prob.js';
import type { Triple } from './types.js';

export const DEFAULT_RHO = -0.05;

export function poissonPmf(k: number, lambda: number): number {
  if (k < 0) return 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function tau(i: number, j: number, lh: number, la: number, rho: number): number {
  if (i === 0 && j === 0) return 1 - lh * la * rho;
  if (i === 0 && j === 1) return 1 + lh * rho;
  if (i === 1 && j === 0) return 1 + la * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

/** λ-parista 1X2-todennäköisyydet. */
export function outcomeProbs(lambdaHome: number, lambdaAway: number, rho = DEFAULT_RHO, maxGoals = 10): Triple {
  let h = 0;
  let d = 0;
  let a = 0;
  for (let i = 0; i <= maxGoals; i++) {
    const pi = poissonPmf(i, lambdaHome);
    for (let j = 0; j <= maxGoals; j++) {
      const p = pi * poissonPmf(j, lambdaAway) * tau(i, j, lambdaHome, lambdaAway, rho);
      if (i > j) h += p;
      else if (i === j) d += p;
      else a += p;
    }
  }
  return normalize([h, d, a]);
}

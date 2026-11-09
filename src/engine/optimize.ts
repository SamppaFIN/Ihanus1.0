// Rivin ja järjestelmän valinta: aloitetaan parhaasta yksittäisestä rivistä ja
// kasvatetaan järjestelmää lisäämällä merkki sinne missä rivimäärän kasvu tuottaa
// eniten odotettua voittoa euroa kohden, kunnes budjetti loppuu.
// Jokaisesta vaiheesta tallennetaan tilasto, jotta käyttäjä voi valita budjettinsa.

import type { Triple } from './types.js';
import { SIGNS } from './types.js';
import type { EvConfig } from './prize.js';
import { evaluate, popcount, rowsOf, type Selection, type SystemStats } from './ev.js';

export interface Step {
  selection: Selection;
  stats: SystemStats;
  /** Mitä lisättiin tähän vaiheeseen: ottelu (0-pohjainen) ja merkki */
  added: { match: number; sign: '1' | 'X' | '2' } | null;
}

export interface OptimizeOptions {
  /** Budjetti euroina, järjestelmän kasvatus loppuu tähän */
  maxCostEur: number;
}

function argmaxMask(t: Triple): number {
  let best = 0;
  for (let s = 1; s < 3; s++) if (t[s]! > t[best]!) best = s;
  return 1 << best;
}

export function optimize(p: Triple[], q: Triple[], cfg: EvConfig, opts: OptimizeOptions): Step[] {
  const n = p.length;
  // 1) Paras yksittäinen rivi: koordinaattinousu alkaen todennäköisimmästä rivistä
  let sel: Selection = p.map(argmaxMask);
  let best = evaluate(sel, p, q, cfg).evEur;
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let i = 0; i < n; i++) {
      for (let s = 0; s < 3; s++) {
        const mask = 1 << s;
        if (sel[i] === mask) continue;
        const cand = sel.slice();
        cand[i] = mask;
        const ev = evaluate(cand, p, q, cfg).evEur;
        if (ev > best * 1.0005) {
          best = ev;
          sel = cand;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  const chosen: Array<{ selection: Selection; added: Step['added'] }> = [{ selection: sel.slice(), added: null }];
  let curEv = best;
  let curRows = rowsOf(sel);

  // 2) Järjestelmän kasvatus
  for (;;) {
    let bestGain = -Infinity;
    let pick: { match: number; sign: number; ev: number; rows: number } | null = null;
    for (let i = 0; i < n; i++) {
      for (let s = 0; s < 3; s++) {
        if ((sel[i]! >> s) & 1) continue;
        const cand = sel.slice();
        cand[i] = sel[i]! | (1 << s);
        const rows = rowsOf(cand);
        if (rows * cfg.rowPriceEur > opts.maxCostEur + 1e-9) continue;
        const ev = evaluate(cand, p, q, cfg).evEur;
        const gain = (ev - curEv) / ((rows - curRows) * cfg.rowPriceEur);
        if (gain > bestGain) {
          bestGain = gain;
          pick = { match: i, sign: s, ev, rows };
        }
      }
    }
    if (!pick) break;
    sel = sel.slice();
    sel[pick.match] = sel[pick.match]! | (1 << pick.sign);
    curEv = pick.ev;
    curRows = pick.rows;
    chosen.push({ selection: sel.slice(), added: { match: pick.match, sign: SIGNS[pick.sign]! } });
  }

  // 3) Tilastot (tarkka laskenta → ei otantakohinaa)
  return chosen.map((c) => ({ selection: c.selection, added: c.added, stats: evaluate(c.selection, p, q, cfg) }));
}

export function describeSelection(sel: Selection): string[] {
  return sel.map((m) => SIGNS.filter((_, s) => (m >> s) & 1).join(''));
}

export { popcount };

// Milloin data päivitetään? "Tunti ennen kierroksen alkamista" = Teksti-TV:n "Pelaaminen päättyy" − 60 min.
// Cron kutsuu tätä joka INTERVAL minuutti; ikkuna (o − interval, o] osuu jokaiselle kierrokselle täsmälleen
// yhdellä tikillä riippumatta siitä mihin minuuttiin sulkeutuminen osuu → ei tuplalaukaisuja eikä ohi menoja.

export interface OpenRound {
  /** Vakaa tunniste: "otsikko|kierros" */
  key: string;
  title: string;
  closesAtMs: number;
}

export interface Due {
  key: string;
  title: string;
  offsetMin: number;
  minutesToClose: number;
}

export function dueRounds(rounds: readonly OpenRound[], nowMs: number, offsetsMin: readonly number[], intervalMin: number): Due[] {
  const out: Due[] = [];
  for (const r of rounds) {
    const mtc = (r.closesAtMs - nowMs) / 60000;
    for (const o of offsetsMin) {
      if (mtc <= o && mtc > o - intervalMin) out.push({ key: r.key, title: r.title, offsetMin: o, minutesToClose: Math.round(mtc * 10) / 10 });
    }
  }
  return out;
}

export function parseOffsets(s: string | undefined, fallback = [60]): number[] {
  const xs = (s ?? '').split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0);
  return xs.length ? xs : fallback;
}

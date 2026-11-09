// Ihanus1.0 — mobile-first käyttöliittymä. Lukee data/rounds.json (rakennettu: npm run build:data).
'use strict';

const SIGNS = ['1', 'X', '2'];
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = (d) => new Intl.NumberFormat('fi-FI', { maximumFractionDigits: d, minimumFractionDigits: d });
const eur = (n, d = 0) => (n == null ? '–' : nf(d).format(n) + ' €');
const pct = (x, d = 0) => nf(d).format(x * 100) + ' %';
const mult = (x) => '×' + nf(x >= 10 ? 0 : 1).format(x);
const oneIn = (p) => (p > 0 ? '1 : ' + nf(0).format(Math.round(1 / p)) : '–');
const probText = (p) => (p >= 0.01 ? pct(p, 1) : oneIn(p));
const statusLabel = { open: 'Avoin', closed: 'Suljettu', played: 'Pelattu' };
const basisLabel = { 'model+market': 'kertoimet + taulukko', market: 'kertoimet', model: 'taulukko', crowd: 'ei omaa tietoa' };
const dateFi = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d}.${m}.${y}`; };

const state = { data: null, roundId: null, step: 0, open: new Set() };
const safeUrl = (u) => (/^https?:\/\//.test(u) ? u : '#');
const link = (u, t) => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`;
const signWord = { '1': 'kotivoitto', X: 'tasapeli', '2': 'vierasvoitto' };

/* ---------- Teema ---------- */
const THEMES = [['winter', 'Talvi'], ['dark', 'Titaani'], ['light', 'Timantti']];
function applyTheme(name) {
  const t = THEMES.find((x) => x[0] === name) || THEMES[0];
  document.documentElement.dataset.theme = t[0];
  $('#theme-name').textContent = t[1];
  try { localStorage.setItem('ihanus-theme', t[0]); } catch (_) { /* ei tallennusta */ }
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('ihanus-theme'); } catch (_) { /* ohitetaan */ }
  applyTheme(saved || 'winter');
  $('#theme').addEventListener('click', () => {
    const i = THEMES.findIndex((x) => x[0] === document.documentElement.dataset.theme);
    applyTheme(THEMES[(i + 1) % THEMES.length][0]);
  });
}

/* ---------- Data ---------- */
const round = () => state.data.rounds.find((r) => r.id === state.roundId);

function defaultStep(r) {
  if (!r.path.length) return 0;
  let best = 0;
  r.path.forEach((s, i) => { if (Math.abs(s.costEur - 10) < Math.abs(r.path[best].costEur - 10)) best = i; });
  return best;
}

function selectRound(id) {
  state.roundId = id;
  state.step = defaultStep(round());
  render();
}

/* ---------- Kierroschipit ---------- */
function renderRounds() {
  const el = $('#rounds');
  el.innerHTML = state.data.rounds.map((r) => `<button class="chip" role="tab" aria-selected="${r.id === state.roundId}" data-id="${esc(r.id)}">
      ${esc(r.label)}<span class="badge ${r.status}">${statusLabel[r.status]}</span><small>${dateFi(r.date)}</small></button>`).join('');
  el.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => selectRound(b.dataset.id)));
}

/* ---------- Kierros ---------- */
function tile(k, v, s = '') { return `<div class="glass tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`; }

function renderTiles(r) {
  const pot = r.bonusPoolEur ? tile('Bonus', eur(r.bonusPoolEur), 'jaetaan täysosumille')
    : r.guaranteeEur ? tile('Takuupotti', eur(r.guaranteeEur), 'ainoalle täysosumalle') : tile('Takuu / bonus', '–', 'ei tällä kierroksella');
  $('#tiles').innerHTML =
    tile('Vaihto', eur(r.turnoverEur) + (r.turnoverEstimated ? '<span class="est">arvio</span>' : ''), r.rowPriceEur ? `≈ ${nf(0).format(r.turnoverEur / r.rowPriceEur)} riviä à ${eur(r.rowPriceEur, 2)}${r.rowPriceEstimated ? ' (hinta oletettu)' : ''}` : '') +
    pot +
    tile(r.matches.length === 13 ? '13 oikein -potti' : 'Potti', r.pools ? eur(r.pools[0]) + '<span class="est">arvio</span>' : '–', r.pools ? `12 oikein ≈ ${eur(r.pools[1])}` : 'ei arvioitu: palkintoluokkia ei tunneta') +
    tile('Ottelut', String(r.matches.length), (n => (n === 0 ? 'vain pelaajien osuudet' : `oma arvio ${n}/${r.matches.length} ottelulle`))(r.matches.filter((m) => m.basis && m.basis !== 'crowd').length));
  const note = $('#round-note');
  const msg = [r.note, r.source ? 'Lähde: ' + r.source : ''].filter(Boolean).join(' · ');
  note.textContent = msg; note.hidden = !msg;
  const lk = $('#round-links');
  lk.innerHTML = r.links && r.links.length ? 'Lähteet: ' + r.links.map((l) => link(l.url, l.label)).join(' · ') : '';
  lk.hidden = !(r.links && r.links.length);
}

function cellHtml(m, s, pickSigns, i) {
  const sign = SIGNS[s];
  const own = m.p ? m.p[s] : null;
  const crowd = m.crowd ? m.crowd[s] : null;
  const ratio = m.ratio && m.basis !== 'crowd' ? m.ratio[s] : null;
  const cls = ['cell'];
  if (ratio != null && ratio > 1.15) cls.push('under');
  if (ratio != null && ratio < 0.87) cls.push('over');
  if (pickSigns && pickSigns.includes(sign)) cls.push('pick');
  if (m.result === sign) cls.push('res');
  const big = own ?? crowd;
  const bar = big == null ? 0 : Math.round(big * 100);
  return `<div class="${cls.join(' ')}" aria-label="Ottelu ${m.n}, merkki ${sign}: oma ${big == null ? '–' : pct(big)}${crowd != null ? ', peli ' + pct(crowd) : ''}${cls.includes('pick') ? ', valittu' : ''}${m.result === sign ? ', toteutunut' : ''}">
      <div class="sign">${sign}</div>
      <div class="own">${big == null ? '–' : pct(big)}</div>
      <div class="crowd">${crowd == null || m.basis === 'crowd' ? '&nbsp;' : 'peli ' + pct(crowd)}</div>
      <div class="ratio">${ratio == null ? '&nbsp;' : mult(ratio)}</div>
      <div class="bar" style="width:${bar}%"></div></div>`;
}

function quickHtml(m) {
  const q = m.explain && m.explain.quick;
  if (!q) return '';
  const rows = q.signs.map((s) => {
    const tags = s.tags.map((t) => `<span class="q-tag ${esc(t.tone)}">${esc(t.text)}</span>`).join('');
    const items = s.pros.map((x) => `<li class="pro"><span class="pm" aria-label="puoltaa">+</span>${esc(x)}</li>`).join('')
      + s.cons.map((x) => `<li class="con"><span class="pm" aria-label="vastaan">−</span>${esc(x)}</li>`).join('');
    return `<div class="q-row"><span class="q-sign">${esc(s.sign)}</span><div class="q-main"><div class="q-title">${esc(s.label)}${tags}</div>${items ? `<ul>${items}</ul>` : s.note ? `<p class="q-note">${esc(s.note)}</p>` : ''}</div></div>`;
  }).join('');
  return `<section class="quick" aria-label="Pikakatsaus ottelusta ${m.n}"><p class="q-sum">${esc(q.summary)}</p>${rows}</section>`;
}

function whyHtml(r, m, i, step) {
  const ex = m.explain;
  if (!ex) return '';
  const key = `${r.id}:${m.n}`;
  const pickLine = step && step.selection[i] ? `<p class="pickline">Nykyisessä rivissä tähän otteluun pelataan: <strong>${esc(step.selection[i].split('').map((c) => signWord[c]).join(' ja '))}</strong>.</p>` : '';
  const facts = ex.facts && ex.facts.length ? `<h4>Mitä ottelusta tiedetään</h4><ul class="facts">${ex.facts.map((f) => `<li>${esc(f.text)} <span class="src">${link(f.url, f.label)}</span></li>`).join('')}</ul>` : '';
  const srcs = ex.sources && ex.sources.length ? `<h4>Mistä luvut ovat</h4><ul class="srcs">${ex.sources.map((s) => `<li>${s.url ? link(s.url, s.label) : esc(s.label)} — ${esc(s.what)}${s.note ? `<br><small>${esc(s.note)}</small>` : ''}</li>`).join('')}</ul>` : '';
  return `<details class="why ${esc(ex.tone)}" data-k="${esc(key)}"${state.open.has(key) ? ' open' : ''}><summary><span class="why-h">${esc(ex.headline)}</span><span class="why-more">Selitys ja lähteet</span></summary><div class="why-body">${ex.lines.map((l) => `<p>${esc(l)}</p>`).join('')}${pickLine}${facts}${srcs}</div></details>`;
}

function renderMatches(r) {
  const step = r.path[state.step];
  const html = r.matches.map((m, i) => `<article class="match">
      <div class="m-head"><span class="m-n">${m.n}.</span><span class="m-teams">${esc(m.home)} – ${esc(m.away)}</span>
      <span class="m-basis" title="Mistä oma arvio syntyy">${m.basis ? basisLabel[m.basis] : 'ei dataa'}${m.crowdEstimated ? ' · pelaajaosuudet arvioitu' : ''}</span></div>
      <div class="cells">${[0, 1, 2].map((s) => cellHtml(m, s, step ? step.selection[i] : null, i)).join('')}</div>${quickHtml(m)}${whyHtml(r, m, i, step)}</article>`).join('');
  $('#matches').innerHTML = `<p class="legend">Iso luku = meidän arvio (todennäköisyys). Pieni luku = kuinka suuri osa pelaajista veikkaa samaa. <span class="ok">Vihreä</span> = pelaajat aliarvioivat, punainen = pelaajat yliarvioivat. ● = valittu merkki${r.status === 'played' ? ', ✓ = toteutunut' : ''}. Pikakatsaus kunkin ottelun alla kertoo, mikä puoltaa (+) ja mikä on vastaan (−) kutakin merkkiä. “Selitys ja lähteet” avaa asian selkokielellä ja linkit lähteisiin.</p>` + html;
  $('#matches').querySelectorAll('details.why').forEach((d) => d.addEventListener('toggle', () => { d.open ? state.open.add(d.dataset.k) : state.open.delete(d.dataset.k); }));
}

/* ---------- Rivi ---------- */
function copyText(r, step) {
  const lines = r.matches.map((m, i) => `${m.n}. ${m.home}–${m.away}: ${step.selection[i]}`);
  return `${r.label} · ${step.rows} riviä · ${eur(step.costEur, 2)}\n` + lines.join('\n');
}

function renderPath(r) {
  const el = $('#path');
  if (!r.path.length) {
    el.innerHTML = `<div class="glass"><p><strong>Polkua ei lasketa tälle kierrokselle.</strong></p><p>${esc(r.noPathReason || '')}</p></div>`;
    return;
  }
  const s = r.path[state.step];
  const last = s.added ? s.added.match : -1;
  el.innerHTML = `<div class="glass">
      <div class="k mono" style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">Arvokerroin · keskirivi = ×1,0</div>
      <div class="big">${mult(s.valueMultiple)} <small>varovaisesti ${mult(s.valueMultipleLow)}</small></div>
      <div class="range">
        <button class="step-btn" id="minus" aria-label="Vähemmän rivejä">−</button>
        <input id="slider" type="range" min="0" max="${r.path.length - 1}" value="${state.step}" aria-label="Budjetti" aria-valuetext="${s.rows} riviä, ${eur(s.costEur, 2)}">
        <button class="step-btn" id="plus" aria-label="Enemmän rivejä">+</button>
      </div>
      <div class="mono" style="text-align:center;font-size:14px">${nf(0).format(s.rows)} riviä · ${eur(s.costEur, 2)}${s.added ? ` · lisätty ${s.added.sign} ottelulle ${s.added.match + 1}` : ''}</div>
      <div class="kv">
        <div><span class="k">Odotettu voitto</span><span class="v">${eur(s.evEur, 2)}</span></div>
        <div><span class="k">Palautus / panos</span><span class="v">${pct(s.roi)} <small class="mono" style="color:var(--muted)">(${pct(s.roiLow)})</small></span></div>
        <div><span class="k">≥ 10 oikein</span><span class="v">${probText(s.pAtLeast[3])}</span></div>
        <div><span class="k">13 oikein</span><span class="v">${probText(s.pAtLeast[0])}</span></div>
      </div>
      <div class="coupon" aria-label="Valitut merkit">${s.selection.map((sel, i) => `<span class="${sel.length > 1 ? 'multi' : ''}" ${i === last ? 'style="outline:2px solid var(--accent)"' : ''}><i>${i + 1}</i>${esc(sel)}</span>`).join('')}</div>
      <button class="btn" id="copy">Kopioi kuponki</button>
      <p class="warn">Luvut ovat ehdollisia: ne pätevät vain jos oma arvio on oikeassa. Sulkeissa/“varovaisesti” oma arvio on puolitettu kohti pelijakaumaa ja muiden rivejä on 1,5-kertainen määrä. Tavallinen Vakio-rivi palauttaa keskimäärin noin 65 %. Osumat ovat harvinaisia: suurin osa kupongeista ei voita mitään.</p>
    </div>`;
  const set = (i) => { state.step = Math.max(0, Math.min(r.path.length - 1, i)); renderMatches(r); renderPath(r); renderBacktest(r); };
  $('#slider').addEventListener('input', (e) => set(Number(e.target.value)));
  $('#minus').addEventListener('click', () => set(state.step - 1));
  $('#plus').addEventListener('click', () => set(state.step + 1));
  $('#copy').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(copyText(r, s)); e.target.textContent = 'Kopioitu ✓'; } catch (_) { e.target.textContent = 'Kopiointi ei onnistunut'; }
    setTimeout(() => { e.target.textContent = 'Kopioi kuponki'; }, 1800);
  });
}

/* ---------- Takautuva ---------- */
function renderBacktest(r) {
  const el = $('#backtest');
  if (r.status !== 'played') {
    el.innerHTML = `<div class="glass"><p>Kierros ei ole vielä pelattu tai tuloksia ei ole tallennettu. Kun tulokset (Teksti-TV 478) on lisätty kuponkitiedostoon, osumat ja voitot näkyvät tässä.</p></div>`;
    return;
  }
  const idx = (m) => (m.crowd ? m.crowd.indexOf(Math.max(...m.crowd)) : -1);
  const favHits = r.matches.filter((m) => idx(m) >= 0 && SIGNS[idx(m)] === m.result).length;
  let html = `<div class="glass"><p><strong>Tulokset:</strong> <span class="mono">${r.matches.map((m) => m.result).join(' ')}</span></p>
      <p>Pelijakauman suosikki osui <strong>${favHits}/${r.matches.length}</strong> ottelussa${favHits <= 6 ? ' — yllätysvoittoinen kierros' : ''}.</p>`;
  if (r.path.length) {
    const s = r.path[state.step];
    const maxCorrect = r.matches.filter((m, i) => s.selection[i].includes(m.result)).length;
    html += `<p>Valittu järjestelmä (${s.rows} riviä, ${eur(s.costEur, 2)}): paras rivi olisi osunut <strong>${maxCorrect}/${r.matches.length}</strong>.</p></div>
      <div class="glass" style="margin-top:12px"><div class="scroll-x"><table><thead><tr><th>Rivit</th><th>€</th><th>13</th><th>12</th><th>11</th><th>10</th><th>Voitto</th></tr></thead><tbody>` +
      r.path.map((p, i) => `<tr class="${i === state.step ? 'sel' : ''}"><td>${nf(0).format(p.rows)}</td><td>${nf(2).format(p.costEur)}</td>${p.hits.map((h) => `<td>${h || '·'}</td>`).join('')}<td>${p.payoutEur == null ? '?' : eur(p.payoutEur, 2)}</td></tr>`).join('') +
      `</tbody></table></div><p class="legend" style="margin-top:8px">Sarakkeet: osumia luokissa 13/12/11/10 oikein. “?” = voitonjako ei tiedossa tälle kierrokselle. Yhden kierroksen tulos on anekdootti, ei näyttöä mallin toimivuudesta.</p></div>`;
  } else {
    html += `<p>Tälle kierrokselle ei ole omaa dataa, joten järjestelmää ei laskettu.</p></div>`;
  }
  if (r.calibration) {
    const c = r.calibration, cls = [13, 12, 11, 10];
    html += `<div class="glass" style="margin-top:12px"><h3>Kalibrointi: pelijakauma vs. toteutuneet voittajat</h3>
      <div class="scroll-x"><table><thead><tr><th>Luokka</th><th>Malli odottaa</th><th>Toteutunut*</th></tr></thead><tbody>` +
      cls.map((k, j) => `<tr><td>${k} oikein</td><td>${nf(j < 2 ? 1 : 0).format(c.expectedWinners[j])}</td><td>${c.impliedWinners && c.impliedWinners[j] != null ? nf(j < 2 ? 1 : 0).format(c.impliedWinners[j]) : '?'}</td></tr>`).join('') +
      `</tbody></table></div><p class="legend" style="margin-top:8px">*Johdettu julkaistusta voitosta ja oletetuista luokkaosuuksista (päättelyketju osin kehämäinen). Jos “malli odottaa” on selvästi pienempi kuin toteutunut, pelaajat ovat keskittyneet samoille riveille ja todellinen jako on huonompi kuin laskelma.</p></div>`;
  }
  el.innerHTML = html;
}

/* ---------- Info ---------- */
function renderAbout() {
  const a = state.data.assumptions;
  $('#about').innerHTML = `<div class="about">
    <div class="glass"><h3>Miten tämä toimii</h3><ul>
      <li><strong>Peliprosentit</strong> haetaan Ylen Teksti-TV:n sivulta 479 (myös vaihto, takuupotti ja bonus).</li>
      <li><strong>Oma arvio</strong> syntyy kertoimista (devigattu markkina) ja/tai käsin täytetystä taulukosta, ja se kutistetaan kohti pelijakaumaa.</li>
      <li><strong>Arvokerroin</strong> = rivin odotettu voitto ÷ keskirivin odotettu voitto. Laskenta on tarkka: käydään läpi kaikki tulokset joilla järjestelmä osuu vähintään 10, ja muiden voittajien määrä mallinnetaan pelijakaumasta.</li>
      <li><strong>Järjestelmä</strong> kasvaa lisäämällä merkki sinne, missä euro tuottaa eniten odotettua voittoa.</li></ul></div>
    <div class="glass"><h3>Oletukset (ei vahvistettu)</h3><ul>
      <li>Rivin hinta luetaan Teksti-TV:ltä (Sunnuntaivakio 0,10 €). Jos sivu ei kerro hintaa, käytetään 0,25 € ja kierroksen vaihto-ruudussa lukee “hinta oletettu”; väärä hinta vääristää rivimäärää ja siten kaikkia arvokertoimia.</li>
      <li>Palautus ${pct(a.prize.payoutRatio)} vaihdosta (asetuksen mukaan keskimäärin 60–70 %).</li>
      <li>Luokkaosuudet 13/12/11/10 oikein: ${a.prize.shares.map((x) => pct(x)).join(' / ')} — arvioitu kahdesta kierroksesta.</li>
      <li>Luottamus omaan arvioon pelijakaumaan nähden: taulukko ${pct(a.fuse.trust.model)}, markkina ${pct(a.fuse.trust.market)}.</li>
      <li>Muut pelaajat valitsevat merkit toisistaan riippumatta; todellisuudessa rivit kasautuvat, joten oikea jako on usein huonompi.</li>
      <li>Takautuvia kierroksia on vain kaksi, joten mikään niistä ei osoita mallin toimivan.</li></ul></div>
    <div class="glass help"><h3>Vastuullisuus</h3>
      <p>Vakio on rahapeli, jonka odotusarvo on keskimäärin negatiivinen. Tämä työkalu ei takaa voittoja eikä korvaa omaa harkintaa. Pelaa vain summilla, jotka voit menettää.</p>
      <p>Apua pelaamiseen: Peluuri 0800 100 101 (maksuton, palvelee suomeksi).</p></div></div>`;
  $('#stamp').textContent = 'Data päivitetty ' + new Date(state.data.generatedAt).toLocaleString('fi-FI', { dateStyle: 'short', timeStyle: 'short' });
}

/* ---------- Render ---------- */
function render() {
  const r = round();
  renderRounds(); renderTiles(r); renderMatches(r); renderPath(r); renderBacktest(r);
}

/* ---------- Alapalkki ---------- */
function initDock() {
  const links = [...document.querySelectorAll('.dock a')];
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) links.forEach((l) => l.setAttribute('aria-current', String(l.dataset.sec === e.target.id))); });
  }, { rootMargin: '-45% 0px -50% 0px' });
  ['kierros', 'rivi', 'takautuva', 'info'].forEach((id) => io.observe(document.getElementById(id)));
}

/* ---------- Hero: lemniskaatti-tähdet (∞) ---------- */
function initSky() {
  const c = $('#sky'); const ctx = c.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const N = 70; let w = 0, h = 0, raf = 0;
  const size = () => { const dpr = Math.min(devicePixelRatio || 1, 2); w = c.clientWidth; h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  const draw = (t) => {
    ctx.clearRect(0, 0, w, h);
    const col = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7fe';
    ctx.fillStyle = col;
    const cx = w * 0.72, cy = h * 0.36, a = Math.min(w * 0.36, 170);
    for (let i = 0; i < N; i++) {
      const u = (i / N) * Math.PI * 2 + t * 0.00006;
      const d = 1 + Math.sin(u) ** 2;
      const x = cx + (a * Math.cos(u)) / d, y = cy + (a * Math.sin(u) * Math.cos(u)) / d * 1.1;
      ctx.globalAlpha = 0.18 + 0.42 * ((Math.sin(u * 3 + t * 0.0012) + 1) / 2);
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  const loop = (t) => { draw(t); raf = requestAnimationFrame(loop); };
  size(); addEventListener('resize', () => { size(); if (reduce) draw(0); });
  if (reduce) { draw(0); return; }
  raf = requestAnimationFrame(loop);
  document.addEventListener('visibilitychange', () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(loop); });
}

/* ---------- Käynnistys ---------- */
async function main() {
  initTheme(); initDock(); initSky();
  try {
    const res = await fetch('data/rounds.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.data = await res.json();
  } catch (e) {
    $('#tiles').innerHTML = `<div class="glass" style="grid-column:1/-1"><p><strong>Dataa ei voitu ladata.</strong> ${esc(String(e.message || e))}</p><p>Avaa sivu palvelimen kautta: <span class="mono">npm run build:data && npm run serve</span>.</p></div>`;
    return;
  }
  const rs = state.data.rounds;
  const first = rs.find((r) => r.status === 'open' && r.path.length) || rs.find((r) => r.status === 'open') || rs.find((r) => r.path.length && r.status !== 'played') || rs.find((r) => r.path.length) || rs[0];
  state.roundId = first.id; state.step = defaultStep(first);
  renderAbout(); render();
}
main();

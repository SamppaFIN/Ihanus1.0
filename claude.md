# Ihanus1.0 — Project Rules

Vakio-arvomoottori (Samin SamppaFIN-reposarja, sisarprojekti Toni1.0:lle). Lue README.md ensin.

## Säännöt

- **Kieli:** suomi (UI, kommentit, commitit). Domain-termit englanniksi kun ne ovat vakiintuneita (devig, pari-mutuel).
- **Kirurgiset muutokset:** muuta vain pyydetty. Älä refaktoroi ohimennen.
- **Testit muutosten mukana.** `npm test` ja `npm run typecheck` ennen committia. Käsin syötetty data (`data/`) on testattu `data.test.ts`:ssä — päivitä testit jos formaatti muuttuu.
- **Ei keksittyä dataa.** Jos lähde ei kerro (voittajamäärät, vaihto, kertoimet), kirjaa `null` / `…Estimated: true` ja näytä se UI:ssa. Älä täytä aukkoja uskottavilla luvuilla.
- **Rehellisyys luvuissa:** UI:n pääluku on arvokerroin (kalibroimaton). ROI näytetään vain varovaisen arvion kanssa. Älä poista varoituksia.
- **Vastuullisuus:** Peluuri 0800 100 101 -maininta ja "odotusarvo on keskimäärin negatiivinen" -teksti pysyvät UI:ssa ja README:ssä.

## Tekniset huomiot

- EV-laskenta on **tarkka enumerointi** (`engine/ev.ts`), ei Monte Carlo. Älä palauta otantaa: harvinaiset jättipottiosumat tekevät siitä kohinaisen. Muutokset `ev.ts`:ään → aja bruteforce-vertailutesti.
- `evaluate(sel, p, q, cfg)`: `p` = oma arvio, `q` = pelijakauma. Luokkaindeksit j=0..3 = 13/12/11/10 oikein (ottelumäärä n → n…n−3). Moottori hyväksyy vain 13 ottelun kierroksen polkuun (`build-round.ts`).
- Heikon oman arvion luottamus on `DEFAULT_FUSE.trust` (taulukko 0,4 / markkina 0,85). Nosta vain kalibroinnin perusteella.
- Teksti-TV 479 on staattista tekstiä (`<pre>`); jäsennin `scrape/yle-vakio.ts` ja fixturet `fixtures/`. Yle katkaisee joukkuenimet → `scrape/names.ts`.
- Kierroksen identiteetti = otsikko + kierrosnumero (`merge-coupon.ts: findExisting`), ei haun päivä.
- **Ei API-avaimia dataan.** Peliprosentit = Teksti-TV 479 (HTTP), kertoimet = BetExplorer (Playwright, `scrape/odds-table.ts` + `tools/scrape-odds.ts`). Selaimessa ajetaan vain `ROW_SNAPSHOT_SCRIPT` (rivien raaka kuvaus); kaikki tulkinta on puhtaissa funktioissa, jotta se on testattavissa fixtureilla.
- Verkko on kehitysympäristössä rajattu (vain npm/GitHub): BetExplorerin oikeaa DOMia ei ole nähty. Merkitse tällaiset asiat näkyviin äläkä väitä scraperin toimivan oikealla sivulla ennen kuin `odds-morning` on ajettu debug-tilassa.
- Rivihinta on kuponkikohtainen (`rowPriceEur`, Sunnuntaivakio 0,10 €, Teksti-TV:ltä). Jos sivu ei kerro, `rowPriceEstimated: true` ja UI näyttää “hinta oletettu”. Älä käytä globaalia hintaa.
- Ajastus: `workers/cron` (Cloudflare Worker) → `src/pipeline/cron-run.ts` → GitHub `workflow_dispatch` (`percent-hourly.yml`, input `odds=true`). Ikkunalogiikka `cron-plan.ts` (`dueRounds`): osuu täsmälleen yhdelle tikille. Aikavyöhyke: “Pelaaminen päättyy” on Suomen aikaa (`helsinkiToUtcMs`). Ainoa salaisuus on Workerin `GITHUB_TOKEN`.
- UI on vanilla JS (`web/`), ei buildia. `npm run build:data` ennen `npm run serve`.
- GitHub Pages: `gh-pages`-haara; kaikki julkaisevat workflowt jakavat `concurrency: gh-pages`.

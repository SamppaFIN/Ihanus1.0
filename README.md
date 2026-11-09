# Ihanus1.0 — Vakio-arvomoottori

Etsii Vakio-rivin tai -järjestelmän, jonka **osuessa kukaan muu ei ole samalla rivillä**: oma todennäköisyys-arvio vastaan pelaajien peliprosentit, ja siitä rivin odotettu voitto pari-mutuel-potissa.

- **Peliprosentit, vaihto, takuupotti/bonus:** Ylen Teksti-TV sivu 479 (staattinen HTML → pelkkä HTTP-haku, ei selainta)
- **Kertoimet:** BetExplorerin liigasivut Playwrightilla (keskimääräiset 1X2-kertoimet, devig) — ei API-avaimia
- **Ajastus:** Cloudflare Worker (`workers/cron/`) lukee Teksti-TV:ltä kunkin kierroksen “Pelaaminen päättyy” -ajan ja käynnistää tuntia ennen GitHub-workflow'n, joka hakee tuoreet peliprosentit + kertoimet ja julkaisee UI:n
- **Oma arvio:** kertoimista ja/tai käsin täytetystä taulukosta (`data/sheets/`), kutistettuna kohti pelijakaumaa
- **UI:** mobile-first, Infinite-portfolion lasi/OKLCH-kieli, teemat Talvi/Titaani/Timantti (`web/`, vanilla JS, ei buildia)

## Pika-aloitus

```bash
npm ci
npm test                # 97 testiä
npm run build:data      # data/ → web/data/rounds.json
npm run serve           # http://localhost:5173
```

## Mitä luku tarkoittaa

**Arvokerroin** = rivin odotettu voitto ÷ keskirivin odotettu voitto (×1,0 = keskirivi). Se ei riipu rivin hinnasta tai palautusprosentista, ja siksi se on ensisijainen luku. Palautus/panos (ROI) näytetään toissijaisena ja aina varovaisen arvion kanssa.

Rivin odotusarvo:

```
EV(rivi) = Σ_tulokset P(tulos) · Σ_luokat osumat_j · E[ potti_j / (omat_j + K_j) ]
K_j ~ Poisson(N · P_muiden_rivi_osuu_luokkaan_j(tulos))
```

Laskenta on **tarkka**, ei Monte Carlo: käydään läpi kaikki tulokset joilla järjestelmä osuu vähintään 10 ottelua (syvyyshaku, katkaisu kun pakollisia virheitä > 3). Otanta ei kelvannut, koska 13 oikein -osuma on ~1/10 000 ja potti satoja tuhansia → estimaatti heiluisi kohinasta (todettu: neljän rivin EV 0,75 → kahdeksan rivin 4,98 oli pelkkää kohinaa). Enumerointi on testattu raakaa 3ⁿ-bruteforcea vastaan (`engine.test.ts`).

Järjestelmä kasvatetaan ahneesti: lisätään merkki jolla ΔEV/Δeuro on suurin, kunnes budjetti loppuu. Polku (rivit → arvokerroin, P(≥10), P(13)) näkyy liukusäätimessä.

## Rakenne

```
src/engine/     prob (devig, fuse) · poisson · sheet (paperimalli) · prize (potit) · ev (tarkka EV) · optimize
src/scrape/     yle-vakio (Teksti-TV 479 -jäsennin, alasivut, sulkeutumisaika, rivihinta) · names (sumea joukkuenimien täsmäytys) · odds-table (BetExplorer-rivien tulkinta)
src/pipeline/   merge-coupon (Yle → kuponki, kierroksen tunnistus) · build-round (kuponki → UI-näkymä) · explain (selkokielinen ottelukohtainen selitys + lähdelinkit) · cron-plan/cron-run (milloin päivitetään, GitHub-dispatch)
src/tools/      scrape-percent · scrape-odds (Playwright) · build-data · serve
workers/cron/   Cloudflare Worker: scheduled-tikki 10 min välein + GET /status (dry-run)
data/           coupons/ (kierrokset) · sheets/ (käsin täytetyt taulukot) · odds/ · crowd-history/
fixtures/       oikeat Teksti-TV-sivut testeihin
web/            UI (index.html, styles.css, app.js, data/rounds.json)
.github/        ci · pages-deploy · odds-morning (05:30 UTC) · percent-hourly (Workerin dispatch + varmistus: tunnin välein joka päivä)
```

## Uuden kierroksen kulku

1. `percent-hourly` hakee Teksti-TV 479:n kaikki alasivut (jokainen voi olla eri kuponki) ja luo/päivittää `data/coupons/<pvm>-<kierros>.json`. Kierros tunnistetaan otsikosta + kierrosnumerosta, joten sama kierros ei monistu. Sivulta luetaan myös sulkeutumisaika (`closesAt`) ja rivihinta.
2. `odds-morning` (ja Workerin laukaisema ajo) hakee kertoimet `data/odds/<id>.json`:iin (tai kirjoita ne käsin samaan muotoon: `{fetchedAt, source, matches:[{n, odds:[1,X,2]}]}`).
3. Käsintäytetty taulukko: `data/sheets/<id>.json` (muoto: katso `2026-10-24-lauantaivakio.json`).
4. `build-data` yhdistää kaiken → `web/data/rounds.json` → UI.
5. Pelin jälkeen lisää tulokset (`result: "1"|"X"|"2"` otteluille) ja halutessasi voitonjako (`prizes`) kuponkitiedostoon; Teksti-TV 478 näyttää molemmat.

## Käyttöönotto

**GitHub Pages:** Settings → Pages → Source: *Deploy from branch* → `gh-pages` / root.

**Cloudflare-cron** (tunti ennen sulkeutumista):

```bash
cd workers/cron && npm i
npx wrangler login
npx wrangler secret put GITHUB_TOKEN   # fine-grained PAT: vain tämä repo, Actions: Read and write
npx wrangler deploy
```

Tarkista `https://ihanus-cron.<tilisi>.workers.dev/status`: näet mitkä kierrokset Worker löytää ja milloin ne sulkeutuvat (dry-run, ei käynnistä mitään). Tikki ajetaan joka päivä 10 min välein (`wrangler.toml`), koska kierroksia on myös arkisin; ajoikkuna on rakennettu niin, että jokainen kierros laukaisee täsmälleen yhden päivityksen (testattu). Useampi päivityshetki: `REFRESH_BEFORE_MIN = "60,10"`.

Data on avaimetonta (scraperit), mutta workflow'n käynnistäminen Cloudflaresta vaatii GitHub-tokenin — se on ainoa salaisuus, ja se on vain Workerissa. Ilman Workeria `percent-hourly` ajaa silti tunnin välein joka päivä (GitHubin schedule voi myöhästyä kymmeniä minuutteja).


## Mikä EI ole vahvistettu — lue tämä

| Asia | Tila |
|---|---|
| Rivin hinta | luetaan Teksti-TV:ltä kun sivu sen kertoo (Sunnuntaivakio 0,10 €). Lauantaivakion 0,25 € on **oletus** (UI:ssa “hinta oletettu”); väärä hinta vääristää rivimäärää ja kaikkia arvokertoimia |
| Palautus 65 % | oletus (asetus 1414/2016: keskimäärin 60–70 %) |
| Luokkaosuudet 13/12/11/10 = 56/16/11/17 % | arvioitu kahdesta kierroksesta |
| BetExplorer-scraper | tulkintalogiikka testattu fixtureilla ja synteettisellä HTML:llä oikeassa Chromiumissa; **oikeaa sivun rakennetta, ikävahvistusta ja aikavyöhykettä ei ole nähty** (kehitysympäristön verkko rajattu). Aja ensin `odds-morning` käsin valinnalla `debug=true` ja tarkista artefakti. Käytä harvoin ja sivuston käyttöehtoja noudattaen |
| Cloudflare-cron | Worker ajettu paikallisesti (`wrangler dev --test-scheduled`) feikkipalvelinta vasten: Teksti-TV → ikkuna → GitHub-dispatch toimii. Oikeaa Cloudflare-deployta ei ole ajettu |
| 12 ottelun kierros (Sunnuntaivakio, Futisvakio) | jäsennetään ja selitetään ottelu kerrallaan, mutta riviä/pottia ei lasketa — palkintoluokkia ei tunneta |
| Käsin kerätyt taustatiedot (`facts` kuponkitiedostossa) | jokaisella lauseella on oma lähdelinkki; poimittu käsin hakutuloksista, eli lukuvirhe on mahdollinen — tarkista linkistä. Futisvakio 6:n kertoimet on vain yhdelle ottelulle (yksi ennakkoteksti), muille BetExplorer-haku täydentää |
| Muiden pelaajien riippumattomuus | virheellinen: rivit kasautuvat (24.10. toteutui 32 kpl 12 oikein vs ~15 mallin mukaan). `crowdScale` kalibroitava; varovainen arvio käyttää ×1,5 |
| Mallin toimivuus | **ei todistettu.** Takautuvia kierroksia on kaksi (24.10., 7.11.), ja 7.11. ei ole omaa dataa. Yksi kierros on anekdootti |

**Voittajan kirous:** optimoija valitsee juuri ne merkit, joissa oma arvio eroaa pelijakaumasta eniten, eli joissa mallin virhe on todennäköisesti suurin. Siksi heikko malli (yksi käsin tehty taulukko) kutistetaan vahvasti (luottamus 40 %) ja markkina-arvio vähemmän (85 %).

## Vastuullisuus

Vakio on rahapeli, jonka odotusarvo on keskimäärin negatiivinen. Työkalu ei takaa voittoja. Pelaa vain summilla, jotka voit menettää. Apua: **Peluuri 0800 100 101**.

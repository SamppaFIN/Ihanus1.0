// Playwright-työkalu: avaa Veikkauksen vedonlyöntisivun ja tallentaa sivun itse lataamat JSON-vastaukset,
// jotta nähdään missä rajapinnassa 1X2-kertoimet kulkevat. EI TESTATTU tästä ympäristöstä (verkko estetty).
// Käyttö: npx playwright install chromium && npm run scrape:veikkaus:capture -- [--url https://www.veikkaus.fi/fi/vedonlyonti] [--wait 15]
// Huom: käytä harvoin ja kevyesti (kerran päivässä), noudata Veikkauksen käyttöehtoja.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = new URL('../../', import.meta.url).pathname;
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const url = arg('url') ?? 'https://www.veikkaus.fi/fi/vedonlyonti';
  const wait = Number(arg('wait') ?? 15) * 1000;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'fi-FI', timezoneId: 'Europe/Helsinki' });
  const page = await ctx.newPage();
  const seen: Array<{ url: string; status: number; bytes: number; head: string }> = [];
  page.on('response', async (res) => {
    const ct = res.headers()['content-type'] ?? '';
    if (!ct.includes('json')) return;
    try {
      const body = await res.text();
      seen.push({ url: res.url(), status: res.status(), bytes: body.length, head: body.slice(0, 400) });
    } catch {
      /* ohitetaan */
    }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(wait);
  await browser.close();
  mkdirSync(join(root, 'data/raw'), { recursive: true });
  const out = join(root, 'data/raw', `veikkaus-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(out, JSON.stringify({ url, capturedAt: new Date().toISOString(), responses: seen }, null, 2));
  console.log(`${seen.length} JSON-vastausta → ${out}`);
  for (const s of seen.slice(0, 30)) console.log(`  ${s.status} ${s.bytes}B ${s.url}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

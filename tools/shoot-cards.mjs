#!/usr/bin/env node
/**
 * Screenshot the LinkedIn cards rendered by the app at /marketing/cards.
 * Moved here from the westringia repo along with the card templates.
 *
 *   pnpm dev                      # in one terminal (vite defaults to port 5173)
 *   node tools/shoot-cards.mjs    # in another
 *
 * Writes one PNG per card, 1080 × 1350, named to match the queue files in the
 * westringia repo's docs/social/queue. The collateral stayed in that repo, so
 * output goes to <WESTRINGIA_CHECKOUT>/docs/social/images when a checkout is
 * configured (default ../westringia), and to ./card-exports otherwise.
 * Commit and push the PNGs from the westringia checkout to publish them to
 * the store the Leader marketing page reads.
 *
 * Uses playwright-core and whatever Chromium PLAYWRIGHT_BROWSERS_PATH (or
 * executablePath below) finds. CARDS_URL overrides the page address.
 */

import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const checkout = resolve(root, process.env.WESTRINGIA_CHECKOUT ?? '../westringia');
const outDir = existsSync(join(checkout, 'docs', 'social', 'images'))
  ? join(checkout, 'docs', 'social', 'images')
  : join(root, 'card-exports');
mkdirSync(outDir, { recursive: true });

// One slug per card section on the page, in order. Add the new slug here when
// a card is added to /marketing/cards.
const slugs = [
  '01-the-gap',
  '02-the-prices',
  '03-buy-dont-build',
  '04-the-unfindable-number',
  '05-what-the-diagnostic-buys',
  '06-hosted-in-australia',
  '07-nsw-ecert-deadline',
  '08-people-cannot-tell',
  '09-words-we-do-not-use',
  '10-a-count-not-a-feeling',
  '11-no-case-studies',
  '12-integration-costs',
];

const url = process.env.CARDS_URL ?? 'http://localhost:5173/marketing/cards';
const exePath = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);

const browser = await chromium.launch(exePath ? { executablePath: exePath } : {});
const page = await browser.newPage({ viewport: { width: 1240, height: 1600 }, deviceScaleFactor: 1 });

await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

for (let i = 0; i < slugs.length; i++) {
  const id = `#card-${String(i + 1).padStart(2, '0')}`;
  const el = page.locator(id);
  await el.scrollIntoViewIfNeeded();
  const file = join(outDir, `${slugs[i]}.png`);
  await el.screenshot({ path: file });
  console.log('wrote', file);
}

await browser.close();

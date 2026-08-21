#!/usr/bin/env node
/**
 * Screenshot the LinkedIn cards rendered by the app at /marketing/cards.
 *
 *   pnpm dev                      # in one terminal (vite defaults to port 5173)
 *   pnpm shoot:cards              # in another
 *
 * Writes one PNG per card into ./card-exports, 1080 × 1350, named by slug.
 * Attach the PNG to its post on the /marketing page — the queue and its card
 * images live in Firestore, so uploading there is what publishes the card to
 * the pipeline; the files here are just the export step.
 *
 * Uses playwright-core and whatever Chromium PLAYWRIGHT_BROWSERS_PATH (or
 * executablePath below) finds. CARDS_URL overrides the page address.
 */

import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'card-exports');
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

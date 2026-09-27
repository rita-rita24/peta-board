import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { appUrl } from '../helpers/peta-page.mjs';

const reportsDir = path.resolve('reports');
fs.mkdirSync(reportsDir, { recursive: true });

const browser = await chromium.launch({ headless: true, ...(process.env.PETA_TEST_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PETA_TEST_CHROMIUM_EXECUTABLE_PATH } : {}) });
let coverage;
try {
const page = await browser.newPage();

await page.coverage.startJSCoverage({ resetOnNavigation: false });
await page.goto(appUrl);
await page.waitForSelector('.column');
await page.evaluate(() => {
  const api = window.__PETA_BOARD_TEST__;
  api.parseDateValue('2026-06-06');
  api.normalizeDueDate('2024-02-31');
  api.normalizeChecklist([
    { id: 'check-one', text: 'Item', done: true },
    { id: 'bad id"', text: 'Unsafe', done: false }
  ], new Set());
  api.normalizeState({
    version: 1,
    theme: 'dark',
    board: {
      title: 'Coverage',
      columns: [
        {
          id: 'col-one',
          title: 'Todo',
          notes: [
            {
              id: 'note-one',
              title: 'Card',
              body: 'Body',
              tags: ['tag'],
              dueDate: '2026-06-06',
              checklist: [{ id: 'check-one', text: 'Done', done: true }]
            }
          ]
        }
      ]
    }
  });
});
// 編集・検索・カレンダー・チェックリスト・削除と復元・バックアップの実操作を検証する。
// これは代表的な操作シナリオであり、全テストの網羅率ではない。
await page.locator('.add-note-btn').first().click();
await page.locator('#note-title-input').fill('Coverage note');
await page.locator('#note-body-input').fill('Body with 日本語 and emoji 📝');
await page.locator('#note-tags-input').fill('coverage, test');
await page.locator('#add-check-btn').click();
await page.locator('#checklist input[type="text"]').fill('Checklist item');
await page.locator('#checklist input[type="checkbox"]').check();
await page.locator('#note-due-field').click();
await page.locator('#date-today-btn').click();
await page.locator('#duplicate-note-btn').click();
await page.locator('#delete-note-btn').click();
await page.locator('#confirm-ok-btn').click();
await page.locator('#note-drawer').waitFor({ state: 'hidden' });
await page.locator('#deletion-undo-btn').click();
await page.locator('#search-input').fill('coverage');
await page.locator('#clear-search-btn').click();
await page.locator('#theme-btn').click();
await page.locator('#help-btn').click();
await page.locator('#close-help-btn').click();
await page.locator('#help-modal').waitFor({ state: 'hidden' });
await page.locator('#settings-btn').click();
const downloaded = page.waitForEvent('download');
await page.locator('#export-board-btn').click();
const chunks = [];
for await (const chunk of await (await downloaded).createReadStream()) chunks.push(chunk);
await page.locator('#reset-board-btn').click();
await page.locator('#confirm-ok-btn').click();
await page.locator('#settings-modal').waitFor({ state: 'hidden' });
await page.setInputFiles('#import-board-file', {
  name: 'coverage.json', mimeType: 'application/json', buffer: Buffer.concat(chunks)
});
await page.locator('#confirm-ok-btn').click();
await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }));
coverage = await page.coverage.stopJSCoverage();
} finally {
  await browser.close();
}

const appEntry = coverage.find((entry) => entry.url === appUrl);
if (!appEntry) {
  throw new Error(`Unable to collect coverage for ${fileURLToPath(appUrl)}.`);
}

const html = fs.readFileSync(fileURLToPath(appUrl), 'utf8');
const scriptMatch = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(html);
const script = scriptMatch?.[1] || '';
const lineStarts = [0];
for (let i = 0; i < script.length; i++) {
  if (script[i] === '\n') lineStarts.push(i + 1);
}

if (appEntry.source !== script) throw new Error('Coverage source does not match the inspected HTML.');
// V8で実行済みとなる外側の即時実行関数にも、未実行の関数や分岐が含まれる。
// 広い範囲の後に狭い範囲を適用し、実行回数ゼロの範囲も反映することで、
// 外側の関数の実行だけでアプリ全体を実行済みと誤判定しないようにする。
const coveredOffsets = new Uint8Array(script.length);
const ranges = appEntry.functions.flatMap((fn) => fn.ranges)
  .toSorted((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));
for (const range of ranges) {
  coveredOffsets.fill(range.count > 0 ? 1 : 0, range.startOffset, range.endOffset);
}
const coveredLines = new Set();
for (let index = 0; index < lineStarts.length; index += 1) {
  const start = lineStarts[index];
  const end = index + 1 < lineStarts.length ? lineStarts[index + 1] : script.length;
  for (let offset = start; offset < end; offset += 1) {
    if (!/\s/.test(script[offset]) && coveredOffsets[offset]) {
      coveredLines.add(index + 1);
      break;
    }
  }
}

const executableLines = script
  .split('\n')
  .map((line, index) => ({ line, index: index + 1 }))
  .filter(({ line }) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*');
  });

const coveredExecutable = executableLines.filter(({ index }) => coveredLines.has(index)).length;
const lineCoverage = executableLines.length
  ? Number((coveredExecutable / executableLines.length * 100).toFixed(1))
  : 0;

const summary = {
  target: appUrl,
  sha256: createHash('sha256').update(html).digest('hex'),
  scope: 'Representative startup, normalization, editing, search, calendar, undo, export, reset and import scenario; not the full test suite.',
  lineCoverage,
  branchCoverage: null,
  coveredLines: coveredExecutable,
  totalLines: executableLines.length,
  note: 'Estimated non-comment line coverage from V8 ranges, with unexecuted nested ranges excluded. This is not AST-instrumented statement or branch coverage.'
};

fs.writeFileSync(path.join(reportsDir, 'coverage-summary.json'), JSON.stringify(summary, null, 2));
console.log(`Line coverage: ${lineCoverage}% (${coveredExecutable}/${executableLines.length})`);

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { appUrl } from '../helpers/peta-page.mjs';

const reportsDir = path.resolve('reports');
fs.mkdirSync(reportsDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
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
const coverage = await page.coverage.stopJSCoverage();
await browser.close();

const appEntry = coverage.find((entry) => entry.url.endsWith('/PetaBoard.html'));
if (!appEntry) {
  throw new Error('Unable to collect coverage for PetaBoard.html.');
}

const html = fs.readFileSync('PetaBoard.html', 'utf8');
const scriptMatch = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(html);
const script = scriptMatch?.[1] || '';
const lineStarts = [0];
for (let i = 0; i < script.length; i++) {
  if (script[i] === '\n') lineStarts.push(i + 1);
}

const coveredLines = new Set();
const coverageRanges = Array.isArray(appEntry.ranges)
  ? appEntry.ranges.map((range) => ({ start: range.start, end: range.end }))
  : appEntry.functions.flatMap((fn, index) => {
    const isWholeScriptRange = index === 0
      && !fn.functionName
      && fn.ranges.length === 1
      && fn.ranges[0].startOffset === 0
      && fn.ranges[0].endOffset >= appEntry.source.length;
    if (isWholeScriptRange) return [];
    return fn.ranges
      .filter((range) => range.count > 0)
      .map((range) => ({ start: range.startOffset, end: range.endOffset }));
  });

for (const range of coverageRanges) {
  for (let i = 0; i < lineStarts.length; i++) {
    const start = lineStarts[i];
    const end = i + 1 < lineStarts.length ? lineStarts[i + 1] : script.length;
    if (range.start < end && range.end > start) coveredLines.add(i + 1);
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
  target: 'PetaBoard.html inline script',
  lineCoverage,
  branchCoverage: null,
  coveredLines: coveredExecutable,
  totalLines: executableLines.length,
  note: 'Playwright/V8 coverage does not provide branch coverage for this inline single-file app.'
};

fs.writeFileSync(path.join(reportsDir, 'coverage-summary.json'), JSON.stringify(summary, null, 2));
console.log(`Line coverage: ${lineCoverage}% (${coveredExecutable}/${executableLines.length})`);

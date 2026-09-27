import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { appUrl, makeMinimalState, makeNote, storageKey } from '../helpers/peta-page.mjs';

const html = readFileSync(fileURLToPath(appUrl), 'utf8');
const origin = 'https://storage-lifecycle.test';
const initial = () => makeMinimalState({ columns: [{ id: 'col_original', title: '元の列', notes: [makeNote({ id: 'note_original', title: '大切な保存済みメモ' })] }] });
const save = (page) => page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }));
const raw = (page) => page.evaluate((key) => localStorage.getItem(key), storageKey);
async function open(page) {
  await page.goto(origin);
  await expect(page.locator('.column-title')).toBeVisible();
}
async function seed(page) {
  await page.goto(`${origin}/setup`);
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: storageKey, state: initial() });
}
test.beforeEach(async ({ context }) => {
  await context.route(`${origin}/**`, (route) => route.fulfill({ contentType: 'text/html', body: route.request().url().endsWith('/setup') ? '<title>Setup</title>' : html }));
});

test('revision storage failure still opens the existing board for reading and backup', async ({ page }) => {
  await seed(page);
  const original = await raw(page);
  await page.addInitScript(() => { IDBFactory.prototype.open = () => { throw new DOMException('Denied', 'SecurityError'); }; });
  await open(page);
  await expect(page.locator('#storage-status')).toBeVisible();
  await expect(page.locator('.note-title')).toHaveText('大切な保存済みメモ');
  const download = page.waitForEvent('download');
  await page.locator('#quick-export-btn').click();
  const chunks = [];
  for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks)).board.columns[0].notes[0].title).toBe('大切な保存済みメモ');
  expect(await raw(page)).toBe(original);
});

test('a denied startup lock still exposes existing data for backup and allows a later retry', async ({ page }) => {
  await seed(page);
  const original = await raw(page);
  await page.addInitScript(() => {
    const request = navigator.locks.request.bind(navigator.locks);
    navigator.locks.request = () => Promise.reject(new DOMException('Denied', 'SecurityError'));
    window.restoreLocks = () => { navigator.locks.request = request; };
  });
  await open(page);
  await expect(page.locator('.note-title')).toHaveText('大切な保存済みメモ');
  expect(await raw(page)).toBe(original);
  await page.evaluate(() => window.restoreLocks());
  await page.locator('.column-title').fill('利用可能になってから保存');
  expect(await save(page)).toBe(true);
});

test('a silent primary write failure is detected and releases its reservation', async ({ page, context }) => {
  await seed(page);
  await open(page);
  const peer = await context.newPage();
  await open(peer);
  await page.clock.install({ time: new Date('2026-09-22T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-22T00:00:01Z'));
  await page.locator('.column-title').fill('書けなかった編集');
  await peer.locator('.column-title').fill('保存できる編集');
  expect(await page.evaluate(async (key) => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) { if (name !== key) write.call(this, name, value); };
    try { return await window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }); }
    finally { Storage.prototype.setItem = write; }
  }, storageKey)).toBe(false);
  expect(await save(peer)).toBe(true);
  await peer.reload();
  await expect(peer.locator('.column-title')).toHaveValue('保存できる編集');
});

for (const dirty of [false, true]) {
  test(`returning from the page cache ${dirty ? 'protects pending edits' : 'catches up on a missed storage event'}`, async ({ page, context }) => {
    await seed(page);
    await open(page);
    const cached = await context.newPage();
    await cached.addInitScript(() => {
      const add = window.addEventListener;
      window.addEventListener = function (type, ...rest) { if (type !== 'storage') return add.call(this, type, ...rest); };
    });
    await open(cached);
    await page.clock.install({ time: new Date('2026-09-22T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-09-22T00:00:01Z'));
    if (dirty) await cached.locator('.column-title').fill('復帰前の未保存編集');
    await page.locator('.column-title').fill('別タブで保存した更新');
    expect(await save(page)).toBe(true);
    await cached.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(cached.locator('.column-title')).toHaveValue(dirty ? '復帰前の未保存編集' : '別タブで保存した更新');
    if (dirty) {
      await expect(cached.locator('#storage-status')).toBeVisible();
      expect(await save(cached)).toBe(false);
    }
  });
}

test('failed primary writes do not leave a reservation that blocks another editor', async ({ page, context }) => {
  await seed(page);
  await open(page);
  const peer = await context.newPage();
  await open(peer);
  await page.clock.install({ time: new Date('2026-09-22T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-22T00:00:01Z'));
  await page.locator('.column-title').fill('保存できない側');
  await peer.locator('.column-title').fill('保存する側');
  expect(await page.evaluate(async (key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, name, value);
    };
    try { return await window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }); }
    finally { Storage.prototype.setItem = original; }
  }, storageKey)).toBe(false);
  expect(await save(peer)).toBe(true);
  expect(JSON.parse(await raw(peer)).board.columns[0].title).toBe('保存する側');
  await expect(page.locator('.column-title')).toHaveValue('保存できない側');
});

test('startup recovers the newer durable snapshot when the primary cache still contains its predecessor', async ({ page, context }) => {
  await seed(page);
  await open(page);
  const old = await raw(page);
  await page.locator('.column-title').fill('先に確定した最新の列');
  expect(await save(page)).toBe(true);
  const committed = await raw(page);
  const stale = await context.newPage();
  await stale.addInitScript(({ key, old }) => {
    const original = Storage.prototype.getItem;
    const write = Storage.prototype.setItem;
    let stale = true;
    Storage.prototype.getItem = function (name) { return name === key && stale ? old : original.call(this, name); };
    Storage.prototype.setItem = function (name, value) {
      write.call(this, name, value);
      if (name === key) stale = false;
    };
  }, { key: storageKey, old });
  await open(stale);
  await expect(stale.locator('.column-title')).toHaveValue('先に確定した最新の列');
  expect(await save(stale)).toBe(true);
  expect(await raw(stale)).toBe(committed);
});

test('closing a page after its durable reservation allows the next page to recover and keep saving', async ({ page, context }) => {
  await seed(page);
  await open(page);
  await page.clock.install({ time: new Date('2026-09-22T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-22T00:00:01Z'));
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = original.apply(this, args);
      if (args[1] === 'readwrite') transaction.addEventListener('complete', (event) => {
        window.reservationIsDurable = true;
        event.stopImmediatePropagation();
      });
      return transaction;
    };
  });
  await page.locator('.column-title').fill('中断直前の編集');
  await page.evaluate(() => { void window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }); });
  await expect.poll(() => page.evaluate(() => window.reservationIsDurable)).toBe(true);
  await page.close();
  const restored = await context.newPage();
  await open(restored);
  await expect(restored.locator('.column-title')).toHaveValue('中断直前の編集');
  await restored.locator('.column-title').fill('復旧後の編集');
  expect(await save(restored)).toBe(true);
  await restored.reload();
  await expect(restored.locator('.column-title')).toHaveValue('復旧後の編集');
  await expect(restored.locator('.note-title')).toHaveText('大切な保存済みメモ');
});

test('local HTML copies sharing browser storage preserve competing edits', async ({ context }, testInfo) => {
  const firstPath = testInfo.outputPath('first-board.html');
  const secondPath = testInfo.outputPath('second-board.html');
  writeFileSync(firstPath, html);
  writeFileSync(secondPath, html);
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto(pathToFileURL(firstPath).href);
  await expect(first.locator('.column').first()).toBeVisible();
  await second.goto(pathToFileURL(secondPath).href);
  await expect(second.locator('.column').first()).toBeVisible();
  await first.clock.install({ time: new Date('2026-09-22T00:00:00Z') });
  await first.clock.pauseAt(new Date('2026-09-22T00:00:01Z'));
  await first.locator('.column-title').first().fill('一つ目の編集');
  await second.locator('.column-title').first().fill('二つ目の編集');
  const results = await Promise.all([save(first), save(second)]);
  expect(results.filter(Boolean)).toHaveLength(1);
  await expect(first.locator('.column-title').first()).toHaveValue('一つ目の編集');
  await expect(second.locator('.column-title').first()).toHaveValue('二つ目の編集');
  const winner = results[0] ? '一つ目の編集' : '二つ目の編集';
  await first.reload();
  await second.reload();
  await expect(first.locator('.column-title').first()).toHaveValue(winner);
  await expect(second.locator('.column-title').first()).toHaveValue(winner);
});

for (const head of [null, 0, { revision: 'broken', text: 'data' }, { revision: Number.MAX_SAFE_INTEGER, text: null }]) {
  test(`invalid revision ${head?.revision ?? JSON.stringify(head)} is never treated as a successful save`, async ({ page }) => {
    await seed(page);
    const original = await raw(page);
    await page.evaluate(async ({ key, head }) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(`${key}.revisions`, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('head');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('head', 'readwrite');
        transaction.objectStore('head').put(head, key);
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
    }, { key: storageKey, head });
    await open(page);
    await page.locator('.column-title').first().fill('元の保存を守る');
    expect(await save(page)).toBe(false);
    expect(await raw(page)).toBe(original);
  });
}

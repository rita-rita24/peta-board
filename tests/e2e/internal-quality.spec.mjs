import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { appUrl, corruptBackupKey, makeMinimalState, makeNote, storageKey } from '../helpers/peta-page.mjs';

const origin = 'https://internal-quality.test';
const html = readFileSync(fileURLToPath(appUrl), 'utf8');

test.beforeEach(async ({ context }) => {
  await context.route(`${origin}/**`, (route) => route.fulfill({
    contentType: 'text/html',
    body: new URL(route.request().url()).pathname === '/setup' ? '<!doctype html><title>Setup</title>' : html
  }));
});

function board() {
  return makeMinimalState({ columns: [{ id: 'col_keep', title: '仕事', notes: [makeNote({
    id: 'note_keep', title: '大切な仕事', body: '残す本文',
    checklist: [{ id: 'check_keep', text: '確認する', done: true }]
  })] }] });
}

async function store(page, raw) {
  await page.goto(`${origin}/setup`);
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: storageKey, raw });
}

async function readRaw(page) {
  return page.evaluate((key) => localStorage.getItem(key), storageKey);
}

const invalidFields = [
  ['future schema version', (state) => { state.version = 2; }],
  ['structured board title', (state) => { state.board.title = { text: '元のボード名' }; }],
  ['numeric column title', (state) => { state.board.columns[0].title = 123; }],
  ['structured note body', (state) => { state.board.columns[0].notes[0].body = { text: '元の本文' }; }],
  ['structured tags', (state) => { state.board.columns[0].notes[0].tags = { first: '大切' }; }],
  ['structured checklist', (state) => { state.board.columns[0].notes[0].checklist = { text: '元の項目', done: true }; }],
  ['unknown default color', (state) => { state.settings.defaultColor = 'red'; }],
  ['string timestamp', (state) => { state.board.createdAt = '123'; }]
];

for (const [name, mutate] of invalidFields) {
  test(`startup preserves the original and recovery copy for ${name}`, async ({ page }) => {
    const state = board();
    mutate(state);
    const original = JSON.stringify(state);
    await store(page, original);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.goto(origin);
      await expect(page.locator('.note-title')).toHaveText('大切な仕事');
      expect(await readRaw(page)).toBe(original);
      expect(await page.evaluate((key) => localStorage.getItem(key), corruptBackupKey)).toBe(original);
    }
    await page.locator('.column-title').fill('復旧後の仕事');
    await expect.poll(async () => JSON.parse(await readRaw(page)).board.columns[0].title).toBe('復旧後の仕事');
    expect(await page.evaluate((key) => localStorage.getItem(key), corruptBackupKey)).toBe(original);
  });
}

test('malformed fields from another tab cannot replace the current board or be overwritten', async ({ page, context }) => {
  const writer = await context.newPage();
  for (const [name, mutate] of invalidFields) {
    await test.step(name, async () => {
      await store(page, JSON.stringify(board()));
      await page.goto(origin);
      await expect(page.locator('.note-title')).toHaveText('大切な仕事');
      const before = await page.evaluate(() => structuredClone(window.__PETA_BOARD_TEST__.getState()));
      await writer.goto(`${origin}/setup`);
      const state = board();
      mutate(state);
      const original = JSON.stringify(state);
      await writer.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: storageKey, raw: original });
      await expect(page.locator('#storage-status')).toBeVisible();
      expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.getState())).toEqual(before);
      await page.locator('.column-title').fill('このタブの未保存の編集');
      expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }))).toBe(false);
      expect(await readRaw(page)).toBe(original);
    });
  }
});

for (const { name, selector, path, open } of [
  { name: 'note title', selector: '#note-title-input', path: ['board', 'columns', 0, 'notes', 0, 'title'], open: '.note-card' },
  { name: 'note body', selector: '#note-body-input', path: ['board', 'columns', 0, 'notes', 0, 'body'], open: '.note-card' },
  { name: 'checklist text', selector: '#checklist input[type="text"]', path: ['board', 'columns', 0, 'notes', 0, 'checklist', 0, 'text'], open: '.note-card' },
  { name: 'column title', selector: '.column-title', path: ['board', 'columns', 0, 'title'] },
  { name: 'board title', selector: '#board-name-input', path: ['board', 'title'], open: '#settings-btn' }
]) {
test(`another tab cannot replace ${name} during IME composition after an intermediate autosave`, async ({ page, context }) => {
  await store(page, JSON.stringify(board()));
  await page.goto(origin);
  await expect(page.locator('.note-card')).toBeVisible();
  if (open) await page.locator(open).click();
  const input = page.locator(selector);
  await input.focus();
  await input.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    element.value = 'にほんご';
    element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  });
  await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }));
  await expect(page.locator('#save-indicator')).toHaveAttribute('data-state', 'pending');
  const writer = await context.newPage();
  await writer.goto(`${origin}/setup`);
  await writer.evaluate(({ key, path }) => {
    const remote = JSON.parse(localStorage.getItem(key));
    const parent = path.slice(0, -1).reduce((value, key) => value[key], remote);
    parent[path.at(-1)] = '別タブの変更';
    localStorage.setItem(key, JSON.stringify(remote));
  }, { key: storageKey, path });
  await expect(page.locator('#storage-status')).toBeVisible();
  await expect(input).toHaveValue('にほんご');
  await input.evaluate((element) => {
    element.value = '日本語';
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本語' }));
    element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: false }));
  });
  expect(await page.evaluate((path) => path.reduce((value, key) => value[key], window.__PETA_BOARD_TEST__.getState()), path)).toBe('日本語');
  expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }))).toBe(false);
  expect(path.reduce((value, key) => value[key], JSON.parse(await readRaw(page)))).toBe('別タブの変更');
});
}

for (const completion of ['compositionend', 'blur']) {
  test(`IME unload protection ends after ${completion} and idle synchronization resumes`, async ({ page, context }) => {
    await store(page, JSON.stringify(board()));
    await page.goto(origin);
    await page.locator('.note-card').click();
    const input = page.locator('#note-title-input');
    await input.focus();
    await input.dispatchEvent('compositionstart');
    const preventsUnload = () => page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(await preventsUnload()).toBe(true);
    if (completion === 'compositionend') await input.dispatchEvent('compositionend');
    else await page.locator('#note-body-input').focus();
    expect(await preventsUnload()).toBe(false);
    await expect(page.locator('#save-indicator')).toHaveAttribute('data-state', 'saved');

    const writer = await context.newPage();
    await writer.goto(`${origin}/setup`);
    await writer.evaluate((key) => {
      const remote = JSON.parse(localStorage.getItem(key));
      remote.board.columns[0].notes[0].title = '変換終了後の同期';
      localStorage.setItem(key, JSON.stringify(remote));
    }, storageKey);
    await expect(input).toHaveValue('変換終了後の同期');
    await expect(page.locator('#storage-status')).toBeHidden();
  });
}

test('truncating oversized text never splits an astral Unicode character', async ({ page }) => {
  await page.goto(origin);
  await expect(page.locator('.column').first()).toBeVisible();
  const result = await page.evaluate(() => {
    const { createNote, LIMITS } = window.__PETA_BOARD_TEST__;
    const atBoundary = (limit) => 'a'.repeat(limit - 1) + '𠮷';
    const note = createNote({
      title: atBoundary(LIMITS.noteTitle), body: atBoundary(LIMITS.noteBody),
      tags: [atBoundary(LIMITS.tag)], checklist: [{ text: atBoundary(LIMITS.checklistText) }]
    });
    const limits = [LIMITS.noteTitle, LIMITS.noteBody, LIMITS.tag, LIMITS.checklistText];
    const texts = [note.title, note.body, note.tags[0], note.checklist[0].text];
    const complete = 'a'.repeat(LIMITS.noteTitle - 2) + '𠮷';
    return {
      texts, limits,
      utf8RoundTrips: texts.map((text) => new TextDecoder().decode(new TextEncoder().encode(text))),
      complete, completeTitle: createNote({ title: complete }).title
    };
  });
  expect(result.texts).toEqual(result.limits.map((limit) => 'a'.repeat(limit - 1)));
  expect(result.utf8RoundTrips).toEqual(result.texts);
  expect(result.completeTitle).toBe(result.complete);
});

test('a stale localStorage cache cannot overwrite a committed edit from another tab', async ({ page, context }) => {
  await store(page, JSON.stringify(board()));
  await page.goto(origin);
  await expect(page.locator('.column-title')).toBeVisible();
  const second = await context.newPage();
  await second.goto(origin);
  await expect(second.locator('.column-title')).toBeVisible();
  await page.clock.install({ time: new Date('2026-09-22T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-22T00:00:01Z'));
  const original = await readRaw(second);
  await second.evaluate(({ key, original }) => {
    const getItem = Storage.prototype.getItem;
    window.__restoreStorageReads = () => { Storage.prototype.getItem = getItem; };
    Storage.prototype.getItem = function (name) { return name === key ? original : getItem.call(this, name); };
    window.addEventListener('storage', (event) => event.stopImmediatePropagation(), true);
  }, { key: storageKey, original });
  await page.locator('.column-title').fill('先に保存する編集');
  await second.locator('.column-title').fill('古いキャッシュ側の編集');
  expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow())).toBe(true);
  expect(await second.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }))).toBe(false);
  await second.evaluate(() => window.__restoreStorageReads());
  expect(JSON.parse(await readRaw(page)).board.columns[0].title).toBe('先に保存する編集');
  await expect(second.locator('.column-title')).toHaveValue('古いキャッシュ側の編集');
  await expect(second.locator('#storage-status')).toBeVisible();
});

test('edits made while a save transaction waits remain pending and are saved next', async ({ page }) => {
  await store(page, JSON.stringify(board()));
  await page.goto(origin);
  await expect(page.locator('.column-title')).toBeVisible();
  await page.clock.install({ time: new Date('2026-09-22T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-22T00:00:01Z'));
  await page.evaluate(async (key) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(`${key}.revisions`, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('head', 'readwrite');
    let holding = true;
    window.__releaseRevision = () => { holding = false; };
    transaction.oncomplete = () => database.close();
    const keepAlive = () => {
      const request = transaction.objectStore('head').get(key);
      request.onsuccess = () => { if (holding) keepAlive(); };
    };
    keepAlive();
  }, storageKey);
  await page.locator('.column-title').fill('保存処理を開始した内容');
  await page.evaluate(() => { window.__pendingSave = window.__PETA_BOARD_TEST__.saveStateNow(); });
  await expect.poll(() => page.evaluate(async (key) => (await navigator.locks.query()).held.some((lock) => lock.name === key), storageKey)).toBe(true);
  await page.locator('.column-title').fill('保存待ちの間に追加した内容');
  await page.evaluate(() => window.__releaseRevision());
  expect(await page.evaluate(() => window.__pendingSave)).toBe(true);
  expect(JSON.parse(await readRaw(page)).board.columns[0].title).toBe('保存処理を開始した内容');
  await expect(page.locator('.column-title')).toHaveValue('保存待ちの間に追加した内容');
  await expect(page.locator('#save-indicator')).toHaveAttribute('data-state', 'pending');
  expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow())).toBe(true);
  await page.reload();
  await expect(page.locator('.column-title')).toHaveValue('保存待ちの間に追加した内容');
});

test('an aborted revision transaction leaves the original intact and allows retry', async ({ page }) => {
  await store(page, JSON.stringify(board()));
  await page.goto(origin);
  await expect(page.locator('.column-title')).toBeVisible();
  await page.clock.install({ time: new Date('2026-09-22T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-22T00:00:01Z'));
  const original = await readRaw(page);
  await page.locator('.column-title').fill('再試行して保存する内容');
  const result = await page.evaluate(async () => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { this.transaction.abort(); };
    try { return await window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }); }
    finally { IDBObjectStore.prototype.put = originalPut; }
  });
  expect(result).toBe(false);
  expect(await readRaw(page)).toBe(original);
  await expect(page.locator('#storage-status')).toBeVisible();
  expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow())).toBe(true);
  await page.reload();
  await expect(page.locator('.column-title')).toHaveValue('再試行して保存する内容');
});

test('an unavailable revision database prevents writes to the original board', async ({ page }) => {
  const original = JSON.stringify(board());
  await store(page, original);
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => { throw new DOMException('Unavailable', 'SecurityError'); };
  });
  await page.goto(origin);
  await expect(page.locator('#storage-status')).toBeVisible();
  expect(await readRaw(page)).toBe(original);
  await page.locator('.column-title').first().fill('保存しない編集');
  expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }))).toBe(false);
  expect(await readRaw(page)).toBe(original);
});

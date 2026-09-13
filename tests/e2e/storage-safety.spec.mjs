import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { appUrl, corruptBackupKey, makeMinimalState, storageKey } from '../helpers/peta-page.mjs';

const origin = 'https://peta-board.test';
const html = readFileSync(fileURLToPath(appUrl), 'utf8');

test.beforeEach(async ({ context }) => {
  await context.route(`${origin}/**`, (route) => route.fulfill({
    contentType: 'text/html',
    body: new URL(route.request().url()).pathname === '/storage-setup'
      ? '<!doctype html><title>Storage setup</title>'
      : html
  }));
});

async function prepareStorage(context, raw = JSON.stringify(makeMinimalState()), backups = {}) {
  const page = await context.newPage();
  await page.goto(`${origin}/storage-setup`);
  await page.evaluate(({ key, text, previousBackups }) => {
    localStorage.clear();
    localStorage.setItem(key, text);
    for (const [backupKey, value] of Object.entries(previousBackups)) {
      localStorage.setItem(backupKey, value);
    }
  }, { key: storageKey, text: raw, previousBackups: backups });
  return page;
}

async function openBoard(page) {
  await page.goto(`${origin}/board`);
  await expect(page.locator('.column').first()).toBeVisible();
}

async function pauseAutosave(page) {
  await page.clock.install({ time: new Date('2026-09-11T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-11T00:00:01Z'));
}

async function saveNow(page) {
  return page.evaluate(async () => await window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }));
}

async function savedRaw(page) {
  return page.evaluate((key) => localStorage.getItem(key), storageKey);
}

async function closeWithUnload(page) {
  const closed = page.waitForEvent('close');
  await page.close({ runBeforeUnload: true });
  await closed;
}

async function backupEntries(page) {
  return page.evaluate((prefix) => Object.entries(localStorage)
    .filter(([key]) => key.startsWith(prefix)), corruptBackupKey);
}

async function stopStorageEvents(page) {
  await page.addInitScript(() => {
    window.addEventListener('storage', (event) => event.stopImmediatePropagation(), true);
  });
}

async function rejectBackupWrites(page) {
  await page.addInitScript((prefix) => {
    const originalSetItem = Storage.prototype.setItem;
    window.__rejectBackupWrites = true;
    Storage.prototype.setItem = function (key, value) {
      if (window.__rejectBackupWrites && key.startsWith(prefix)) {
        throw new DOMException('Backup quota exhausted', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    };
  }, corruptBackupKey);
}

for (const navigation of ['reload', 'close']) {
  test(`an unchanged stale tab does not write on ${navigation}`, async ({ context }) => {
    const current = await prepareStorage(context);
    await openBoard(current);
    const stale = await context.newPage();
    await stopStorageEvents(stale);
    const writes = [];
    stale.on('console', (message) => {
      if (message.text() === 'storage-safety:primary-write') writes.push(message.text());
    });
    await stale.addInitScript((key) => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (entryKey, value) {
        if (entryKey === key) console.debug('storage-safety:primary-write');
        return originalSetItem.call(this, entryKey, value);
      };
    }, storageKey);
    await openBoard(stale);
    const startupWriteCount = writes.length;

    await current.locator('.column-title').first().fill('別タブで保存した最新の列');
    expect(await saveNow(current)).toBe(true);
    const latest = await savedRaw(current);
    await expect(stale.locator('.column-title').first()).toHaveValue('Todo');

    if (navigation === 'reload') {
      await stale.reload();
      await expect(stale.locator('.column-title').first()).toHaveValue('別タブで保存した最新の列');
    } else {
      await closeWithUnload(stale);
    }

    expect(writes).toHaveLength(startupWriteCount);
    expect(await savedRaw(current)).toBe(latest);
  });
}

test('an interrupted pointer cannot keep a tab from synchronizing after window blur', async ({ context }) => {
  const current = await prepareStorage(context);
  await openBoard(current);
  const idle = await context.newPage();
  await openBoard(idle);
  await idle.locator('.column-title').first().dispatchEvent('pointerdown', {
    pointerId: 42, pointerType: 'mouse', button: 0, bubbles: true
  });
  await idle.evaluate(() => window.dispatchEvent(new Event('blur')));
  await current.locator('.column-title').first().fill('中断後の同期');
  expect(await saveNow(current)).toBe(true);
  await expect(idle.locator('.column-title').first()).toHaveValue('中断後の同期');
  await expect(idle.locator('#storage-status')).toBeHidden();
});

test('an idle tab renders a board saved in another tab through the storage event', async ({ context }) => {
  const first = await prepareStorage(context);
  await openBoard(first);
  const second = await context.newPage();
  await openBoard(second);

  await first.locator('.column-title').first().fill('同期された列名');
  expect(await saveNow(first)).toBe(true);

  await expect(second.locator('.column-title').first()).toHaveValue('同期された列名');
  expect(await second.evaluate(() => window.__PETA_BOARD_TEST__.getState().board.columns[0].title))
    .toBe('同期された列名');
});

for (const suppressStorageEvent of [false, true]) {
  test(`a dirty tab preserves both versions when ${suppressStorageEvent ? 'the save-time comparison detects' : 'the storage event announces'} a conflict`, async ({ context }) => {
    const first = await prepareStorage(context);
    await openBoard(first);
    const second = await context.newPage();
    if (suppressStorageEvent) await stopStorageEvents(second);
    await openBoard(second);
    await pauseAutosave(second);

    await second.locator('.column-title').first().fill('このタブに保持する未保存の列');
    await first.locator('.column-title').first().fill('先に保存された別タブの列');
    expect(await saveNow(first)).toBe(true);
    const latest = await savedRaw(first);
    if (!suppressStorageEvent) {
      await expect(second.locator('#storage-status')).toContainText(/別.*タブ|競合/);
    }

    expect(await saveNow(second)).toBe(false);
    await expect(second.locator('#storage-status')).toBeVisible();
    await expect(second.locator('#storage-status')).toContainText(/別.*タブ|競合/);
    await expect(second.locator('.column-title').first()).toHaveValue('このタブに保持する未保存の列');
    expect(await second.evaluate(() => window.__PETA_BOARD_TEST__.getState().board.columns[0].title))
      .toBe('このタブに保持する未保存の列');
    expect(await savedRaw(first)).toBe(latest);

    await second.clock.runFor(1000);
    expect(await savedRaw(first)).toBe(latest);
    second.on('dialog', (dialog) => dialog.accept());
    await closeWithUnload(second);
    expect(await savedRaw(first)).toBe(latest);
  });
}

test('simultaneous saves serialize the comparison and preserve the losing tab edits', async ({ context }) => {
  const first = await prepareStorage(context);
  await openBoard(first);
  const second = await context.newPage();
  await openBoard(second);
  await pauseAutosave(first);
  await pauseAutosave(second);
  await first.locator('.column-title').first().fill('一つ目のタブの編集');
  await second.locator('.column-title').first().fill('二つ目のタブの編集');

  const results = await Promise.all([saveNow(first), saveNow(second)]);

  expect(results.filter(Boolean)).toHaveLength(1);
  const expectedTitle = results[0] ? '一つ目のタブの編集' : '二つ目のタブの編集';
  expect(JSON.parse(await savedRaw(first)).board.columns[0].title).toBe(expectedTitle);
  await expect(first.locator('.column-title').first()).toHaveValue('一つ目のタブの編集');
  await expect(second.locator('.column-title').first()).toHaveValue('二つ目のタブの編集');
  await expect((results[0] ? second : first).locator('#storage-status')).toContainText(/別.*タブ|競合/);
});

test('a later corrupt value gets a separate backup and normal saving can resume', async ({ context }) => {
  const earlier = '{"earlier corrupt data":';
  const current = '{"current corrupt data":';
  const page = await prepareStorage(context, current, { [corruptBackupKey]: earlier });

  await openBoard(page);

  const backups = await backupEntries(page);
  expect(backups).toContainEqual([corruptBackupKey, earlier]);
  expect(backups).toHaveLength(2);
  expect(backups.find(([key]) => key !== corruptBackupKey)?.[1]).toBe(current);
  expect(await savedRaw(page)).toBe(current);

  await page.locator('.column-title').first().fill('退避後に保存した列');
  expect(await saveNow(page)).toBe(true);
  expect(JSON.parse(await savedRaw(page)).board.columns[0].title).toBe('退避後に保存した列');
  expect(await backupEntries(page)).toEqual(backups);
  await page.reload();
  await expect(page.locator('.column-title').first()).toHaveValue('退避後に保存した列');
});

test('an identical preserved backup is reused without spending more storage', async ({ context }) => {
  const original = '{"already preserved":';
  const page = await prepareStorage(context, original, { [corruptBackupKey]: original });
  await rejectBackupWrites(page);

  await openBoard(page);

  expect(await backupEntries(page)).toEqual([[corruptBackupKey, original]]);
  expect(await savedRaw(page)).toBe(original);
  await page.locator('.column-title').first().fill('既存退避を使って保存');
  expect(await saveNow(page)).toBe(true);
  expect(JSON.parse(await savedRaw(page)).board.columns[0].title).toBe('既存退避を使って保存');
});

for (const kind of ['corrupt', 'lossy']) {
  test(`a failed ${kind} backup keeps the original through editing, autosave, and unload`, async ({ context }) => {
    const state = makeMinimalState();
    state.board.columns[0].id = 'invalid id';
    const original = kind === 'corrupt' ? '{"unrecoverable without backup":' : JSON.stringify(state);
    const earlier = '{"previous backup":';
    const page = await prepareStorage(context, original, { [corruptBackupKey]: earlier });
    await rejectBackupWrites(page);

    await openBoard(page);
    await pauseAutosave(page);

    await expect(page.locator('#storage-status')).toBeVisible();
    await expect(page.locator('#storage-status')).toContainText(/退避.*(でき|失敗)|保護/);
    await expect(page.locator('#toast')).not.toContainText(/退避し、|退避しました|退避済み/);
    expect(await savedRaw(page)).toBe(original);
    expect(await backupEntries(page)).toEqual([[corruptBackupKey, earlier]]);

    if (kind === 'corrupt') {
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#storage-original-btn').click();
      const download = await downloadPromise;
      const chunks = [];
      for await (const chunk of await download.createReadStream()) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString('utf8')).toBe(original);
      expect(await saveNow(page)).toBe(false);
      expect(await savedRaw(page)).toBe(original);
    }

    await page.locator('.column-title').first().fill('メモリ内にだけ保持する変更');
    expect(await saveNow(page)).toBe(false);
    await page.clock.runFor(1000);
    expect(await savedRaw(page)).toBe(original);
    await expect(page.locator('.column-title').first()).toHaveValue('メモリ内にだけ保持する変更');
    await expect(page.locator('#storage-status')).toContainText(/退避.*(でき|失敗)|保護/);

    page.on('dialog', (dialog) => dialog.accept());
    await page.reload();
    await expect(page.locator('.column').first()).toBeVisible();
    expect(await savedRaw(page)).toBe(original);
    expect(await backupEntries(page)).toEqual([[corruptBackupKey, earlier]]);
  });
}

test('saving resumes only after the previously blocked original can be backed up', async ({ context }) => {
  const original = '{"must preserve before saving":';
  const page = await prepareStorage(context, original);
  await rejectBackupWrites(page);
  await openBoard(page);
  await pauseAutosave(page);
  await page.locator('.column-title').first().fill('退避成功後に保存する編集');
  expect(await saveNow(page)).toBe(false);
  expect(await savedRaw(page)).toBe(original);

  await page.evaluate(() => { window.__rejectBackupWrites = false; });

  expect(await saveNow(page)).toBe(true);
  expect(await backupEntries(page)).toEqual([[corruptBackupKey, original]]);
  expect(JSON.parse(await savedRaw(page)).board.columns[0].title).toBe('退避成功後に保存する編集');
  await page.reload();
  await expect(page.locator('.column-title').first()).toHaveValue('退避成功後に保存する編集');
});

test('a remote save during delete confirmation cannot remove the last remaining column', async ({ context }) => {
  const first = await prepareStorage(context);
  await openBoard(first);
  const second = await context.newPage();
  await openBoard(second);
  await second.locator('[data-column-id="col_todo"]').getByRole('button', { name: '列を削除' }).click();
  await expect(second.locator('#confirm-modal')).toBeVisible();

  await first.locator('[data-column-id="col_done"]').getByRole('button', { name: '列を削除' }).click();
  await first.locator('#confirm-ok-btn').click();
  expect(await saveNow(first)).toBe(true);
  const latest = await savedRaw(first);
  await expect(second.locator('#storage-status')).toContainText(/別.*タブ|競合/);

  await second.locator('#confirm-ok-btn').click();

  expect(await saveNow(second)).toBe(false);
  expect(await savedRaw(first)).toBe(latest);
  expect(JSON.parse(latest).board.columns.map((column) => column.id)).toEqual(['col_todo']);
  await expect(second.locator('.column')).toHaveCount(1);
  expect(await second.evaluate(() => window.__PETA_BOARD_TEST__.getState().board.columns.length)).toBe(1);
});

test('an environment without Web Locks keeps corrupt data and reports saving as unavailable', async ({ context }) => {
  const original = '{"raw data in an unsupported environment":';
  const page = await prepareStorage(context, original);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  });
  await openBoard(page);
  await pauseAutosave(page);

  await expect(page.locator('#storage-status')).toBeVisible();
  await expect(page.locator('#storage-status')).toContainText(/安全な自動保存.*利用できません/);
  expect(await backupEntries(page)).toHaveLength(0);
  expect(await savedRaw(page)).toBe(original);

  await page.locator('.column-title').first().fill('保存できない環境での編集');
  expect(await saveNow(page)).toBe(false);
  await page.clock.runFor(1000);
  await expect(page.locator('#storage-status')).toContainText(/安全な自動保存.*利用できません/);
  expect(await savedRaw(page)).toBe(original);
  expect(await backupEntries(page)).toHaveLength(0);
});

test('a startup read failure protects existing data until the user explicitly reopens it', async ({ context }) => {
  const original = JSON.stringify(makeMinimalState({ title: '読み取り障害から回復するボード' }));
  const page = await prepareStorage(context, original);
  await page.addInitScript((key) => {
    const originalGetItem = Storage.prototype.getItem;
    window.__storageSafetyOriginalGetItem = originalGetItem;
    Storage.prototype.getItem = function (entryKey) {
      if (entryKey === key && !originalGetItem.call(sessionStorage, 'storage-safety:allow-read')) {
        throw new DOMException('Primary storage cannot be read', 'SecurityError');
      }
      return originalGetItem.call(this, entryKey);
    };
  }, storageKey);
  await openBoard(page);
  await pauseAutosave(page);

  await expect(page.locator('#storage-status')).toBeVisible();
  await expect(page.locator('#storage-status')).toContainText(/読み込めません/);
  await page.locator('.column-title').first().fill('初期状態側の未保存の編集');
  expect(await saveNow(page)).toBe(false);
  await page.clock.runFor(1000);
  expect(await page.evaluate((key) => window.__storageSafetyOriginalGetItem.call(localStorage, key), storageKey))
    .toBe(original);

  await page.evaluate(() => sessionStorage.setItem('storage-safety:allow-read', '1'));
  await page.locator('#storage-retry-btn').click();
  expect(await saveNow(page)).toBe(false);
  expect(await savedRaw(page)).toBe(original);

  await page.locator('#storage-reload-btn').click();
  await page.clock.runFor(250);
  await page.locator('#confirm-ok-btn').click();

  await expect(page.locator('#board-title')).toHaveText('読み取り障害から回復するボード');
  await expect(page.locator('.column-title').first()).toHaveValue('Todo');
  expect(await savedRaw(page)).toBe(original);
});

test('invalid external storage values cannot replace the displayed board or be overwritten by edits', async ({ context }) => {
  for (const invalid of ['null', 'false', '0', '""', '{"board":']) {
    await test.step(`external value ${invalid}`, async () => {
      const writer = await prepareStorage(context);
      await openBoard(writer);
      const observer = await context.newPage();
      await openBoard(observer);
      const before = await observer.evaluate(() => window.__PETA_BOARD_TEST__.getState());

      await writer.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: invalid });

      await expect(observer.locator('#storage-status')).toBeVisible();
      await expect(observer.locator('#storage-status')).toContainText(/読み込めません/);
      expect(await observer.evaluate(() => window.__PETA_BOARD_TEST__.getState())).toEqual(before);
      await expect(observer.locator('.column-title').first()).toHaveValue('Todo');
      expect(await savedRaw(writer)).toBe(invalid);

      await observer.locator('.column-title').first().fill('異常な別タブ保存から保護する編集');
      expect(await saveNow(observer)).toBe(false);
      expect(await savedRaw(writer)).toBe(invalid);
      await expect(observer.locator('.column-title').first()).toHaveValue('異常な別タブ保存から保護する編集');
      await observer.close();
      await writer.close();
    });
  }
});

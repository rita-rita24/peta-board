import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, openApp, seedState, storageKey } from '../helpers/peta-page.mjs';

test('the first note action starts editing and the saved board replaces the introduction', async ({ page }) => {
  await openApp(page);
  await expect(page).toHaveTitle('PetaBoard');
  await expect(page.locator('#welcome-panel')).toBeVisible();
  await page.getByRole('button', { name: '最初の付箋を作る' }).click();
  await expect(page.locator('#note-title-input')).toBeFocused();
  await page.locator('#note-title-input').fill('来週の提案をまとめる');
  await page.keyboard.press('Escape');
  await expect(page.locator('#welcome-panel')).toBeHidden();
  await expect(page.locator('#board-summary')).toHaveText('付箋 1件 · 3列');
  await expect(page.locator('#save-indicator')).toHaveText('このブラウザーに保存済み');
  await page.reload();
  await expect(page.locator('.note-title')).toHaveText('来週の提案をまとめる');
  await expect(page.locator('#welcome-panel')).toBeHidden();
});

test('saving indicator stays pending until the storage lock has actually committed the edit', async ({ page }) => {
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_work', title: '仕事', notes: [makeNote({ title: '変更前' })] }] }));
  await page.locator('.note-card').click();
  await page.evaluate((key) => {
    navigator.locks.request(key, () => new Promise((resolve) => { window.releaseSaveLock = resolve; }));
  }, storageKey);
  await page.waitForFunction(() => Boolean(window.releaseSaveLock));
  await page.locator('#note-title-input').fill('変更を保存する');
  await expect(page.locator('#save-indicator')).toHaveText('保存中…');
  await expect(page.locator('#drawer-save-status')).toHaveText('保存中…');
  await page.evaluate(() => window.releaseSaveLock());
  await expect(page.locator('#save-indicator')).toHaveText('このブラウザーに保存済み');
  await expect(page.locator('#drawer-save-status')).toHaveText('このブラウザーに保存済み');
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.board.columns[0].notes[0].title).toBe('変更を保存する');
});

test('a failed write is visible and retry confirms a successful durable save', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    window.originalStorageSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  await page.locator('#first-note-btn').click();
  await page.locator('#note-title-input').fill('失敗しても残す仕事');
  await page.keyboard.press('Escape');
  await expect(page.locator('#save-indicator')).toHaveText('保存を停止しています');
  await expect(page.locator('#storage-status')).toBeVisible();
  await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSet; });
  await page.locator('#storage-retry-btn').click();
  await expect(page.locator('#save-indicator')).toHaveText('このブラウザーに保存済み');
  await expect(page.locator('#storage-status')).toBeHidden();
  await page.reload();
  await expect(page.locator('.note-title')).toHaveText('失敗しても残す仕事');
});

test('a personal board name persists and an empty name has a stable fallback', async ({ page }) => {
  await openApp(page);
  await page.locator('#settings-btn').click();
  await page.getByRole('textbox', { name: 'ボード名', exact: true }).fill('企画と日々の仕事');
  await page.locator('#settings-done-btn').click();
  await expect(page.locator('#board-title')).toHaveText('企画と日々の仕事');
  await expect(page.locator('#save-indicator')).toHaveText('このブラウザーに保存済み');
  await page.reload();
  await expect(page).toHaveTitle('企画と日々の仕事 - PetaBoard');
  await page.locator('#settings-btn').click();
  await page.locator('#board-name-input').fill('   ');
  await page.locator('#settings-done-btn').click();
  await expect(page.locator('#board-title')).toHaveText('PetaBoard');
  await expect(page.locator('#save-indicator')).toHaveText('このブラウザーに保存済み');
  await page.reload();
  await expect(page).toHaveTitle('PetaBoard');
});

test('search offers result counts, a useful zero state and a keyboard entry point', async ({ page }) => {
  await seedState(page, makeMinimalState({ columns: [
    { id: 'col_work', title: '仕事', notes: [makeNote({ title: '提案をまとめる', tags: ['企画'] }), makeNote({ title: '請求書を送る' })] },
    { id: 'col_later', title: 'あとで', notes: [makeNote({ title: '読書メモ' })] }
  ] }));
  await page.keyboard.press('/');
  await expect(page.locator('#search-input')).toBeFocused();
  await page.keyboard.insertText('企画');
  await expect(page.locator('#board-summary')).toHaveText('検索結果 1件 / 付箋 3件');
  await page.locator('#search-input').fill('見つからない言葉');
  await expect(page.locator('#board-summary')).toHaveText('検索結果 0件 / 付箋 3件');
  await expect(page.locator('#search-empty')).toBeVisible();
  await page.locator('#empty-clear-search-btn').click();
  await expect(page.locator('.note-card')).toHaveCount(3);
  await expect(page.locator('#search-empty')).toBeHidden();
  await expect(page.locator('#search-input')).toBeFocused();
  await page.locator('.note-card').first().click();
  await expect(page.locator('#note-title-input')).toBeFocused();
  await page.locator('#note-body-input').focus();
  await page.keyboard.type('path/to/file');
  await expect(page.locator('#note-body-input')).toHaveValue('path/to/file');
});

test('backup is available from the board and downloads the full current state', async ({ page }) => {
  await seedState(page, makeMinimalState({ title: '個人の仕事', columns: [
    { id: 'col_work', title: '今日', notes: [makeNote({ title: '顧客向けの説明', body: '本文もバックアップ', tags: ['仕事'] })] }
  ] }));
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#quick-export-btn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^petaboard-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(exported).toEqual(saved);
  await expect(page.locator('#settings-modal')).toBeHidden();
});

test('help is separate from settings, traps keyboard focus, and returns to its trigger', async ({ page }) => {
  await openApp(page);
  await page.locator('#help-btn').click();
  await expect(page.locator('#help-modal')).toBeVisible();
  await expect(page.locator('#settings-modal')).toBeHidden();
  await expect(page.locator('#close-help-btn')).toBeFocused();
  await expect(page.locator('#tooltip')).toBeHidden();
  await expect(page.locator('#help-modal')).toContainText('クラウド同期はありません');
  await expect(page.locator('#help-modal')).toContainText('何も書かずに閉じた付箋は残りません');
  await page.keyboard.press('Escape');
  await expect(page.locator('#help-modal')).toBeHidden();
  await expect(page.locator('#help-btn')).toBeFocused();

  await page.locator('#settings-btn').click();
  await expect(page.locator('#settings-modal')).toBeVisible();
  await expect(page.locator('#help-modal')).toBeHidden();
  await expect(page.locator('#tooltip')).toBeHidden();
  await expect(page.locator('#settings-modal')).not.toContainText('PetaBoardの使い方');
});

test('creating while searching clears the filter so the new note cannot appear lost', async ({ page }) => {
  await seedState(page, makeMinimalState({ columns: [
    { id: 'col_work', title: '仕事', notes: [makeNote({ title: '企画会議' })] },
    { id: 'col_later', title: 'あとで', notes: [] }
  ] }));
  await page.locator('#search-input').fill('企画');
  await expect(page.locator('.note-card')).toHaveCount(1);
  await page.locator('.column').first().locator('.add-note-btn').click();
  await expect(page.locator('#search-input')).toHaveValue('');
  await expect(page.locator('#toast')).toContainText('検索を解除しました');
  await page.locator('#note-title-input').fill('経費の書類を整理する');
  await page.locator('#close-drawer-btn').click();
  await expect(page.locator('.note-title')).toHaveCount(2);
  await expect(page.locator('.note-title', { hasText: '経費の書類を整理する' })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    return state.board.columns.flatMap((column) => column.notes).map((note) => note.title);
  }, storageKey)).toContain('経費の書類を整理する');
});

test('closing a newly created empty note leaves no untitled card or saved draft', async ({ page }) => {
  await openApp(page);
  await page.locator('#first-note-btn').click();
  await expect(page.locator('#note-drawer')).toBeVisible();
  await page.locator('#close-drawer-btn').click();
  await expect(page.locator('#note-drawer')).toBeHidden();
  await expect(page.locator('.note-card')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('空の付箋は追加しませんでした');
  await expect.poll(() => page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    return state.board.columns.flatMap((column) => column.notes).length;
  }, storageKey)).toBe(0);
  await page.reload();
  await expect(page.locator('.note-card')).toHaveCount(0);
  await expect(page.locator('#welcome-panel')).toBeVisible();
});

test('a deleted checklist item can be undone and remains restored after reload', async ({ page }) => {
  await seedState(page, makeMinimalState({ columns: [{
    id: 'col_work', title: '仕事', notes: [makeNote({ id: 'note_steps', title: '提案書', checklist: [
      { id: 'check_outline', text: '構成を作る', done: true },
      { id: 'check_review', text: '見直す', done: false }
    ] })]
  }] }));
  await page.locator('.note-card').click();
  await page.locator('[data-check-id="check_outline"]').getByRole('button', { name: '項目を削除' }).click();
  await expect(page.locator('#checklist-undo')).toBeVisible();
  await expect(page.locator('#checklist-undo')).toContainText('構成を作る');
  await page.locator('#checklist-undo-btn').click();
  await expect(page.locator('[data-check-id="check_outline"] input[type="text"]')).toHaveValue('構成を作る');
  await expect(page.locator('[data-check-id="check_outline"] input[type="checkbox"]')).toBeChecked();
  await expect.poll(() => page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    return state.board.columns[0].notes[0].checklist.map(({ id, text, done }) => ({ id, text, done }));
  }, storageKey)).toEqual([
    { id: 'check_outline', text: '構成を作る', done: true },
    { id: 'check_review', text: '見直す', done: false }
  ]);
  await page.locator('#close-drawer-btn').click();
  await page.reload();
  await page.locator('.note-card').click();
  await expect(page.locator('[data-check-id="check_outline"]')).toBeVisible();
});

test('legacy board identity is displayed correctly without changing stored data or losing notes', async ({ page }) => {
  const legacy = makeMinimalState({ title: 'PetaBorad', columns: [{ id: 'col_original', title: 'メモ', notes: [makeNote({ title: '以前の付箋' })] }] });
  await seedState(page, legacy);
  await page.reload();
  await expect(page.locator('#board-title')).toHaveText('PetaBoard');
  await expect(page.locator('.note-title')).toHaveText('以前の付箋');
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved).toEqual(legacy);
});

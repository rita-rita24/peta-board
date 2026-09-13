import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, openApp, seedState, storageKey, waitForSavedNote } from '../helpers/peta-page.mjs';

const runtimeErrors = new WeakMap();

test.beforeEach(({ page }) => {
  const errors = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(({ page }) => {
  expect(runtimeErrors.get(page)).toEqual([]);
});

test('Japanese work notes, tags, and checklist completion survive reload', async ({ page }) => {
  await openApp(page);
  await page.locator('.column').first().locator('.column-footer')
    .getByRole('button', { name: '付箋を追加' }).click();
  await expect(page.locator('#note-title-input')).toBeFocused();
  await page.locator('#note-title-input').fill('週次報告を提出する');
  await page.locator('#note-body-input').fill('進捗と来週の予定をまとめる\n確認後に提出');
  await page.locator('#note-tags-input').fill('仕事, 今週');
  await page.locator('#add-check-btn').click();
  await page.locator('#checklist').getByRole('textbox', { name: 'チェック項目' }).fill('数字を確認する');
  await page.locator('#checklist').getByRole('checkbox', { name: '完了', exact: true }).check();
  await page.locator('#close-drawer-btn').click();
  await expect.poll(() => page.evaluate((key) => {
    const notes = JSON.parse(localStorage.getItem(key)).board.columns.flatMap((column) => column.notes);
    const note = notes.find((item) => item.title === '週次報告を提出する');
    return note?.checklist.map(({ text, done }) => ({ text, done }));
  }, storageKey)).toEqual([{ text: '数字を確認する', done: true }]);

  await page.reload();
  const card = page.locator('.note-card', { hasText: '週次報告を提出する' });
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#note-title-input')).toBeFocused();
  await expect(page.locator('#note-title-input')).toHaveValue('週次報告を提出する');
  await expect(page.locator('#note-body-input')).toHaveValue('進捗と来週の予定をまとめる\n確認後に提出');
  await expect(page.locator('#note-tags-input')).toHaveValue('仕事, 今週');
  await expect(page.locator('#checklist').getByRole('textbox', { name: 'チェック項目' })).toHaveValue('数字を確認する');
  await expect(page.locator('#checklist').getByRole('checkbox', { name: '完了', exact: true })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.locator('#note-drawer')).toBeHidden();
  await expect(card).toBeFocused();
});

test('a downloaded backup restores the work board and remains saved', async ({ page }) => {
  await seedState(page, makeMinimalState({
    title: '仕事のボード',
    columns: [{ id: 'col_work', title: '進行中', notes: [makeNote({
      id: 'note_report', title: '月次報告', body: '提出前の確認', tags: ['仕事'],
      dueDate: '2027-01-15', checklist: [{ id: 'check_report', text: '数字の確認', done: true }]
    })] }]
  }));
  const original = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-board-btn').click()
  ]);
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  expect(JSON.parse(buffer.toString('utf8'))).toEqual(original);

  await page.locator('#reset-board-btn').click();
  await page.locator('#confirm-ok-btn').click();
  await expect(page.locator('.note-card')).toHaveCount(0);
  await page.setInputFiles('#import-board-file', {
    name: download.suggestedFilename(), mimeType: 'application/json', buffer
  });
  await expect(page.locator('#confirm-modal')).toBeVisible();
  await page.locator('#confirm-ok-btn').click();
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey)).toEqual(original);

  await page.reload();
  await expect(page.locator('.note-card', { hasText: '月次報告' })).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey)).toEqual(original);
});

test('a narrow viewport keeps the board and note editor usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openApp(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
  await page.locator('.column').first().locator('.column-footer')
    .getByRole('button', { name: '付箋を追加' }).click();
  await page.locator('#note-title-input').fill('外出先のメモ');
  const panel = await page.locator('.drawer-panel').boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(376);
  await page.locator('#close-drawer-btn').click();
  await waitForSavedNote(page, '外出先のメモ');
  await page.reload();
  await expect(page.locator('.note-card', { hasText: '外出先のメモ' })).toBeVisible();
});

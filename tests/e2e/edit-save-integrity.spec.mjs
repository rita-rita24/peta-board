import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, seedState, storageKey } from '../helpers/peta-page.mjs';

test('editing a filtered note updates membership and counts while preserving the open editor', async ({ page }) => {
  await seedState(page, makeMinimalState({ columns: [
    { id: 'col_a', title: '列A', notes: [makeNote({ id: 'note_a', title: '検索対象', body: '残す本文' })] },
    { id: 'col_b', title: '列B', notes: [makeNote({ id: 'note_b', title: '別の付箋' })] }
  ] }));
  await page.locator('#search-input').fill('検索');
  await page.locator('[data-note-id="note_a"]').click();
  await page.locator('#note-title-input').fill('一致しなくなった付箋');
  await expect(page.locator('.note-card')).toHaveCount(0);
  await expect(page.locator('#board-summary')).toHaveText('検索結果 0件 / 付箋 2件');
  await expect(page.locator('.column-count')).toHaveText(['0 / 1', '0 / 1']);
  await expect(page.locator('#note-title-input')).toBeFocused();
  await expect(page.locator('#note-body-input')).toHaveValue('残す本文');
  await page.locator('#note-body-input').fill('本文で検索に一致');
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.column-count')).toHaveText(['1 / 1', '0 / 1']);
  await expect(page.locator('#board-summary')).toHaveText('検索結果 1件 / 付箋 2件');
  await page.locator('#close-drawer-btn').click();
  await page.locator('#clear-search-btn').click();
  await expect(page.locator('.note-title')).toHaveText(['一致しなくなった付箋', '別の付箋']);
  expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }))).toBe(true);
  await page.reload();
  await expect(page.locator('.note-title')).toHaveText(['一致しなくなった付箋', '別の付箋']);
});

test('a verification read error after a real write cannot roll the durable revision back', async ({ page }) => {
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_a', title: '元の列', notes: [makeNote({ title: '保持する本文' })] }] }));
  await page.clock.install({ time: new Date('2026-09-22T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-22T00:00:01Z'));
  await page.locator('.column-title').fill('実際には書き込まれた列');
  expect(await page.evaluate(async (key) => {
    const read = Storage.prototype.getItem;
    const write = Storage.prototype.setItem;
    let failRead = false;
    Storage.prototype.setItem = function (name, value) {
      write.call(this, name, value);
      if (name === key) failRead = true;
    };
    Storage.prototype.getItem = function (name) {
      if (name === key && failRead) {
        failRead = false;
        throw new DOMException('Verification denied', 'SecurityError');
      }
      return read.call(this, name);
    };
    try { return await window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }); }
    finally { Storage.prototype.getItem = read; Storage.prototype.setItem = write; }
  }, storageKey)).toBe(false);
  await page.reload();
  await expect(page.locator('.column-title')).toHaveValue('実際には書き込まれた列');
  await page.locator('.column-title').fill('確認エラーから復旧した列');
  expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }))).toBe(true);
  await page.reload();
  await expect(page.locator('.column-title')).toHaveValue('確認エラーから復旧した列');
  await expect(page.locator('.note-title')).toHaveText('保持する本文');
});

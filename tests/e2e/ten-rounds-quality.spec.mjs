import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, openApp, seedState, storageKey } from '../helpers/peta-page.mjs';

const save = (page) => page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }));
const savedText = (page) => page.evaluate((key) => localStorage.getItem(key), storageKey);
async function prepare(page, note = {}) {
  await seedState(page, makeMinimalState({ columns: [
    { id: 'col_a', title: '列A', notes: [makeNote({ id: 'note_a', title: '保持する付箋', ...note })] },
    { id: 'col_b', title: '列B', notes: [] }
  ] }));
}

test('round 1: a closed revision connection can reopen without losing pending edits', async ({ page }) => {
  await page.addInitScript(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      window.revisionConnection = this;
      return transaction.apply(this, args);
    };
  });
  await prepare(page);
  await page.evaluate(() => {
    window.revisionConnection.close();
    window.revisionConnection.dispatchEvent(new Event('close'));
  });
  await page.locator('.column-title').first().fill('接続復旧後の編集');
  expect(await save(page)).toBe(true);
  await page.reload();
  await expect(page.locator('.column-title').first()).toHaveValue('接続復旧後の編集');
  await expect(page.locator('.note-title')).toHaveText('保持する付箋');
});

test('round 2: Unicode case expansion preserves the original search highlight offsets', async ({ page }) => {
  await prepare(page, { title: 'İ日本語𠮷', body: 'İİ本文', tags: ['İタグ'] });
  for (const [query, selector, match] of [
    ['日本', '.note-title', '日本'],
    ['本文', '.note-body', '本文'],
    ['タグ', '.tag-pill', 'タグ'],
    ['i', '.note-title', 'İ'],
    ['𠮷', '.note-title', '𠮷']
  ]) {
    await page.locator('#search-input').fill(query);
    await expect(page.locator(`${selector} mark`).first()).toHaveText(match);
    await expect(page.locator('.note-title')).toHaveText('İ日本語𠮷');
    await expect(page.locator('.note-body')).toHaveText('İİ本文');
  }
});

test('round 3: renaming a searched column restores fully rendered interactive cards', async ({ page }) => {
  await prepare(page);
  await page.locator('#search-input').fill('対象列');
  await expect(page.locator('.note-card')).toHaveCount(0);
  await page.locator('.column-title').first().fill('対象列');
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.note-drag-handle svg')).toHaveCount(1);
  await page.locator('.note-drag-handle').click();
  await expect(page.locator('#note-title-input')).toHaveValue('保持する付箋');
  await expect(page.locator('#drawer-subtitle')).toHaveText('対象列');
  expect(await save(page)).toBe(true);
});

test('round 4: inspecting checklist and reselecting existing colors does not create an edit', async ({ page }) => {
  await prepare(page, { checklist: [{ id: 'check_a', text: '読むだけ', done: false }] });
  const original = await savedText(page);
  await page.locator('.note-card').click();
  await page.locator('#checklist input[type="text"]').focus();
  await page.locator('#note-title-input').focus();
  await page.locator('#note-color-grid [aria-pressed="true"]').click();
  await page.locator('#close-drawer-btn').click();
  await page.locator('#settings-btn').click();
  await page.locator('#default-color-grid [aria-pressed="true"]').click();
  expect(await save(page)).toBe(true);
  expect(await savedText(page)).toBe(original);
  await expect(page.locator('#save-indicator')).toHaveAttribute('data-state', 'saved');
});

test('round 5: keyboard checklist deletion keeps focus on a useful neighboring control', async ({ page }) => {
  await prepare(page, { checklist: [
    { id: 'check_a', text: '先頭', done: false },
    { id: 'check_b', text: '中央', done: true },
    { id: 'check_c', text: '末尾', done: false }
  ] });
  await page.locator('.note-card').click();
  await expect(page.locator('#note-title-input')).toBeFocused();
  await page.locator('[data-check-id="check_b"] button').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-check-id="check_c"] input[type="text"]')).toBeFocused();
  await page.locator('[data-check-id="check_c"] button').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-check-id="check_a"] input[type="text"]')).toBeFocused();
  await page.locator('[data-check-id="check_a"] button').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#add-check-btn')).toBeFocused();
  await page.locator('#checklist-undo-btn').click();
  await expect(page.locator('[data-check-id="check_a"] input[type="text"]')).toBeFocused();
  await expect(page.locator('[data-check-id="check_a"] input[type="text"]')).toHaveValue('先頭');
});

test('round 6: remote due date updates refresh the open calendar without stealing its position', async ({ page, context }) => {
  await prepare(page, { dueDate: '2026-09-22' });
  const peer = await context.newPage();
  await openApp(peer);
  await peer.locator('.note-card').click();
  await peer.locator('#note-due-input').click();
  await page.bringToFront();
  await page.locator('.note-card').click();
  await page.locator('#note-due-input').click();
  await expect(page.locator('[data-date="2026-09-22"]')).toBeFocused();
  // バックグラウンドのタブから保存し、テスト実行側のタブ切り替えで
  // アプリが保護する前に前面のフォーカスが変わることを防ぐ。
  await peer.locator('[data-date="2026-09-23"]').evaluate((button) => button.click());
  expect(await save(peer)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('#note-due-input')).toHaveValue('2026-09-23');
  await expect(page.locator('.date-day[aria-selected="true"]')).toHaveAttribute('data-date', '2026-09-23');
  await expect(page.locator('[data-date="2026-09-22"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('#date-popover')).toBeHidden();
  await expect(page.locator('#note-due-input')).toHaveValue('2026-09-23');
});

for (const kind of ['note', 'column']) {
  test(`round 7: Escape cancels ${kind} drag through pointer release and allows the next drag`, async ({ page }) => {
    await prepare(page);
    const original = await savedText(page);
    const handle = page.locator(kind === 'note' ? '.note-drag-handle' : '.column-handle').first();
    const from = await handle.boundingBox();
    const to = await page.locator('.column').nth(1).boundingBox();
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const end = { x: to.x + to.width - 20, y: to.y + 110 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await expect(page.locator(kind === 'note' ? '.is-dragging' : '.is-column-dragging')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.is-dragging, .is-column-dragging, .drop-marker, .column-drop-marker')).toHaveCount(0);
    await page.mouse.move(start.x, start.y, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('#note-drawer')).toBeHidden();
    expect(await save(page)).toBe(true);
    expect(await savedText(page)).toBe(original);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
    if (kind === 'note') await expect(page.locator('[data-column-id="col_b"] .note-card')).toHaveCount(1);
    else await expect(page.locator('.column').last()).toHaveAttribute('data-column-id', 'col_a');
    expect(await save(page)).toBe(true);
  });
}

test('round 8: Escape clears the focused search field as well as its results', async ({ page }) => {
  await prepare(page);
  const original = await savedText(page);
  const input = page.locator('#search-input');
  await input.fill('一致しない検索');
  await expect(page.locator('.note-card')).toHaveCount(0);
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('#clear-search-btn')).toBeHidden();
  await input.pressSequentially('保持');
  await expect(input).toHaveValue('保持');
  await expect(page.locator('.note-title mark')).toHaveText('保持');
  expect(await savedText(page)).toBe(original);
});

test('round 9: idle cross-tab synchronization preserves column focus and text selection', async ({ page, context }) => {
  await prepare(page);
  const peer = await context.newPage();
  await openApp(peer);
  await page.bringToFront();
  const title = page.locator('.column-title').first();
  await title.focus();
  await title.evaluate((input) => input.setSelectionRange(1, 2, 'backward'));
  await peer.locator('#theme-btn').evaluate((button) => button.click());
  expect(await save(peer)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(title).toBeFocused();
  expect(await title.evaluate((input) => [input.selectionStart, input.selectionEnd, input.selectionDirection])).toEqual([1, 2, 'backward']);
  await page.keyboard.insertText('改');
  await expect(title).toHaveValue('列改');
  expect(await save(page)).toBe(true);
  await page.reload();
  await expect(title).toHaveValue('列改');
});

for (const modal of [
  { name: 'editor', open: '.note-card', target: '#note-body-input' },
  { name: 'settings', open: '#settings-btn', target: '#board-name-input' },
  { name: 'help', open: '#help-btn', target: '#help-done-btn' },
  { name: 'confirmation', open: '#delete-note-btn', target: '#confirm-ok-btn', drawer: true },
  { name: 'calendar', open: '#note-due-input', target: '#date-clear-btn', drawer: true }
]) {
  test(`round 10: delayed ${modal.name} opening does not override a newer focus choice`, async ({ page }) => {
    await prepare(page);
    if (modal.drawer) {
      await page.locator('.note-card').click();
      await expect(page.locator('#note-title-input')).toBeFocused();
    }
    await page.evaluate(({ open, target }) => {
      const callbacks = [];
      const request = window.requestAnimationFrame;
      window.requestAnimationFrame = (callback) => callbacks.push(callback);
      document.querySelector(open).click();
      document.querySelector(target).focus();
      window.requestAnimationFrame = request;
      for (const callback of callbacks) callback(performance.now());
    }, modal);
    await expect(page.locator(modal.target)).toBeFocused();
  });
}

test('round 10: an old closing frame cannot move focus in a reopened editor', async ({ page }) => {
  await prepare(page);
  await page.locator('.note-card').click();
  await expect(page.locator('#note-title-input')).toBeFocused();
  await page.evaluate(() => {
    const callbacks = [];
    const request = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => callbacks.push(callback);
    document.querySelector('#close-drawer-btn').click();
    document.querySelector('.note-card').click();
    document.querySelector('#note-body-input').focus();
    window.requestAnimationFrame = request;
    for (const callback of callbacks) callback(performance.now());
  });
  await expect(page.locator('#note-body-input')).toBeFocused();
});

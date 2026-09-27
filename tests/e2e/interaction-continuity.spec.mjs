import { expect, test } from '@playwright/test';
import { appUrl, makeMinimalState, makeNote, seedState, storageKey } from '../helpers/peta-page.mjs';

const save = (page) => page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }));

test('the workspace waits for a delayed storage load before accepting edits', async ({ page }) => {
  const stored = makeMinimalState({ title: '保存済みの仕事' });
  await page.addInitScript(({ key, state }) => {
    localStorage.setItem(key, JSON.stringify(state));
    const request = navigator.locks.request.bind(navigator.locks);
    let first = true;
    navigator.locks.request = (...args) => {
      if (!first) return request(...args);
      first = false;
      return new Promise((resolve, reject) => {
        window.finishStorageLoad = () => request(...args).then(resolve, reject);
      });
    };
  }, { key: storageKey, state: stored });
  await page.goto(appUrl);
  expect(await page.locator('.app-shell').evaluate((element) => element.inert)).toBe(true);
  await expect(page.locator('#save-indicator')).toHaveAttribute('data-state', 'pending');
  await expect(page.locator('#board-summary')).toBeEmpty();
  await page.locator('#settings-btn').focus();
  await expect(page.locator('#settings-btn')).not.toBeFocused();
  await page.evaluate(() => window.finishStorageLoad());
  await expect(page.locator('#board-title')).toHaveText('保存済みの仕事');
  expect(await page.locator('.app-shell').evaluate((element) => element.inert)).toBe(false);
  await page.locator('#settings-btn').click();
  await page.locator('#board-name-input').fill('読み込み後に編集');
  expect(await save(page)).toBe(true);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).board.title, storageKey)).toBe('読み込み後に編集');
});

for (const tags of [['営業, 東京', '担当'], ['行\n区切り', '担当']]) {
  test(`cancelling an IME conversion preserves imported tags ${JSON.stringify(tags)}`, async ({ page }) => {
    await seedState(page, makeMinimalState({ columns: [{ id: 'col_a', title: '作業', notes: [makeNote({
      id: 'note_a', title: '読み込み済みの付箋', tags
    })] }] }));
    await page.locator('.note-card').click();
    await page.locator('#note-tags-input').focus();
    await page.locator('#note-tags-input').evaluate((input) => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
    });
    await page.locator('#note-title-input').focus();
    expect(await save(page)).toBe(true);
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).board.columns[0].notes[0].tags, storageKey)).toEqual(tags);
    await page.reload();
    await expect(page.locator('.tag-pill')).toHaveText(tags);
  });
}

for (const value of [
  { body: 'ababa', query: 'aba bab', marked: 'ababa' },
  { body: 'aaab', query: 'aa aab', marked: 'aaab' },
  { body: 'İstanbul', query: 'i stanbul', marked: 'İstanbul' }
]) {
  test(`overlapping search terms highlight their full union for ${value.query}`, async ({ page }) => {
    await seedState(page, makeMinimalState({ columns: [{ id: 'col_a', title: '作業', notes: [makeNote({
      id: 'note_a', title: '検索対象', body: value.body
    })] }] }));
    await page.locator('#search-input').fill(value.query);
    await expect(page.locator('.note-card')).toHaveCount(1);
    await expect(page.locator('.note-body')).toHaveText(value.body);
    await expect(page.locator('.note-body .search-hit')).toHaveText([value.marked]);
  });
}

for (const field of ['note', 'column']) {
  test(`editing a matching ${field} preserves a filtered column's scroll position`, async ({ page }) => {
    await seedState(page, makeMinimalState({ columns: [{ id: 'col_a', title: '対象の列', notes: Array.from({ length: 40 }, (_, index) => makeNote({
      id: `note_${index}`, title: `対象 ${index}`, body: '内容を保持する'
    })) }] }));
    await page.locator('#search-input').fill('対象');
    if (field === 'note') await page.locator('[data-note-id="note_0"]').click();
    const list = page.locator('.note-list');
    await list.evaluate((element) => { element.scrollTop = 650; });
    const before = await list.evaluate((element) => element.scrollTop);
    expect(before).toBeGreaterThan(0);
    await page.locator(field === 'note' ? '#note-body-input' : '.column-title').fill('対象を更新');
    expect(await list.evaluate((element) => element.scrollTop)).toBe(before);
    await expect(page.locator('.note-card')).toHaveCount(40);
    expect(await save(page)).toBe(true);
  });
}

test('releasing a column outside the board cancels its reorder', async ({ page }) => {
  await seedState(page, makeMinimalState());
  const handle = page.locator('.column-handle').first();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(1100, 10, { steps: 5 });
  await page.mouse.up();
  expect(await page.locator('.column-title').evaluateAll((inputs) => inputs.map((input) => input.value))).toEqual(['Todo', 'Done']);
  await expect(page.locator('.column-drop-marker')).toHaveCount(0);
  expect(await save(page)).toBe(true);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).board.columns.map((column) => column.id), storageKey)).toEqual(['col_todo', 'col_done']);
});

test('reopening a fully hidden editor resets the checklist and body scroll', async ({ page }) => {
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_a', title: '作業', notes: ['a', 'b'].map((id) => makeNote({
    id: `note_${id}`, title: `付箋 ${id}`, body: '長い本文\n'.repeat(100),
    checklist: Array.from({ length: 30 }, (_, index) => ({ id: `check_${id}_${index}`, text: `手順 ${index}`, done: false }))
  })) }] }));
  await page.locator('[data-note-id="note_a"]').click();
  await expect(page.locator('#note-title-input')).toBeFocused();
  for (const selector of ['#checklist', '#note-body-input']) {
    await page.locator(selector).evaluate((element) => { element.scrollTop = 400; });
    expect(await page.locator(selector).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  }
  await page.locator('#close-drawer-btn').click();
  // 閉じるアニメーションの途中ではなく、display:noneになったことを確認する。
  await expect.poll(() => page.locator('#note-drawer').evaluate((element) => element.hidden)).toBe(true);
  await page.locator('[data-note-id="note_b"]').click();
  await expect(page.locator('#note-title-input')).toBeFocused();
  await expect(page.locator('#note-title-input')).toHaveValue('付箋 b');
  for (const selector of ['#checklist', '#note-body-input']) {
    expect(await page.locator(selector).evaluate((element) => element.scrollTop)).toBe(0);
  }
});

import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, openApp, seedState, storageKey, waitForSavedNote } from '../helpers/peta-page.mjs';

async function dispatchKeyboardEvent(locator, init) {
  await locator.evaluate((el, eventInit) => {
    el.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ...eventInit
    }));
  }, init);
}

test('tag input rejects overflow and renders accepted tags as text pills', async ({ page }) => {
  await openApp(page);

  await page.locator('.column').first().locator('.column-footer').getByRole('button', { name: '付箋を追加' }).click();
  await page.locator('#note-title-input').fill('タグ検証');
  const acceptedTags = [
    'alpha',
    'beta',
    'gamma',
    'delta',
    'epsilon',
    'zeta',
    'eta',
    '<img src=x onerror=alert(1)>'
  ].join(',');
  await page.locator('#note-tags-input').fill(acceptedTags);
  await page.locator('#note-tags-input').fill(`${acceptedTags},ninth`);
  await expect(page.locator('#note-tags-input')).toHaveValue(acceptedTags);
  await expect(page.locator('#note-tags-help')).toContainText('上限を超えた入力は反映していません');
  await page.locator('#close-drawer-btn').click();

  await waitForSavedNote(page, 'タグ検証');
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  const note = saved.board.columns.flatMap((column) => column.notes).find((item) => item.title === 'タグ検証');
  expect(note.tags).toHaveLength(8);
  expect(note.tags.every((tag) => tag.length <= 32)).toBe(true);
  expect(await page.locator('.tag-pill img').count()).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('search highlighting keeps HTML-shaped note text inert', async ({ page }) => {
  const payload = '<img src=x onerror="window.__xss=1">検索対象';
  const state = makeMinimalState({
    columns: [
      {
        id: 'col_search',
        title: 'Search',
        notes: [makeNote({ id: 'note_payload', title: payload, body: payload, tags: [payload] })]
      }
    ]
  });
  await seedState(page, state);

  await page.locator('#search-input').fill('<img');

  await expect(page.locator('.note-card', { hasText: payload })).toBeVisible();
  expect(await page.locator('.note-card img, .search-hit img').count()).toBe(0);
  expect(await page.locator('.search-hit').first()).toHaveText('<img');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('IME composition Enter does not close the note drawer or duplicate a note', async ({ page }) => {
  await openApp(page);

  const beforeCount = await page.locator('.note-card').count();
  await page.locator('.column').first().locator('.column-footer').getByRole('button', { name: '付箋を追加' }).click();
  const titleInput = page.locator('#note-title-input');
  await titleInput.fill('変換中の付箋名');

  await dispatchKeyboardEvent(titleInput, { key: 'Enter', isComposing: true });

  await expect(page.locator('#note-drawer')).toBeVisible();
  await expect(titleInput).toHaveValue('変換中の付箋名');
  expect(await page.locator('.note-card').count()).toBe(beforeCount + 1);

  await dispatchKeyboardEvent(titleInput, { key: 'Enter', isComposing: false });

  await expect(page.locator('#note-drawer')).toBeVisible();
  expect(await page.locator('.note-card').count()).toBe(beforeCount + 1);
});

test('IME composition Escape does not close an active note drawer', async ({ page }) => {
  await openApp(page);

  await page.locator('.column').first().locator('.column-footer').getByRole('button', { name: '付箋を追加' }).click();
  await expect(page.locator('#note-drawer')).toHaveClass(/is-open/);
  const titleInput = page.locator('#note-title-input');
  await titleInput.fill('変換中Escape');

  await dispatchKeyboardEvent(titleInput, { key: 'Escape', keyCode: 229, isComposing: true });

  await expect(page.locator('#note-drawer')).toBeVisible();
  await expect(page.locator('#note-drawer')).toHaveClass(/is-open/);
  await expect(titleInput).toHaveValue('変換中Escape');
});

test('IME composition Escape does not clear Japanese search text', async ({ page }) => {
  const state = makeMinimalState({
    columns: [
      {
        id: 'col_todo',
        title: 'Todo',
        notes: [
          makeNote({ id: 'note_tokyo', title: '東京の予定' }),
          makeNote({ id: 'note_osaka', title: '大阪の予定' })
        ]
      }
    ]
  });
  await seedState(page, state);

  const search = page.locator('#search-input');
  await search.fill('東京');
  await expect(page.locator('.note-card', { hasText: '東京の予定' })).toBeVisible();
  await expect(page.locator('.note-card', { hasText: '大阪の予定' })).toHaveCount(0);

  await dispatchKeyboardEvent(search, { key: 'Escape', keyCode: 229, isComposing: true });

  await expect(search).toHaveValue('東京');
  await expect(page.locator('.note-card', { hasText: '東京の予定' })).toBeVisible();
  await expect(page.locator('.note-card', { hasText: '大阪の予定' })).toHaveCount(0);
});

test('column title input accepts composition without creating extra columns', async ({ page }) => {
  const state = makeMinimalState({
    columns: [
      {
        id: 'col_todo',
        title: 'Todo',
        notes: [makeNote({ id: 'note_1', title: '既存付箋' })]
      }
    ]
  });
  await seedState(page, state);

  const beforeCount = await page.locator('.column').count();
  const titleInput = page.locator('.column-title').first();
  await titleInput.fill('変換中の列名');

  await dispatchKeyboardEvent(titleInput, { key: 'Enter', keyCode: 229, isComposing: true });

  await expect(titleInput).toHaveValue('変換中の列名');
  expect(await page.locator('.column').count()).toBe(beforeCount);

  await dispatchKeyboardEvent(titleInput, { key: 'Enter', isComposing: false });

  await expect(titleInput).toHaveValue('変換中の列名');
  expect(await page.locator('.column').count()).toBe(beforeCount);
});

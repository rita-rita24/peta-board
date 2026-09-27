import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import fc from 'fast-check';
import { appUrl, makeMinimalState, makeNote, seedState, storageKey } from '../helpers/peta-page.mjs';

const state = () => makeMinimalState({ columns: [{ id: 'col_work', title: '仕事', notes: Array.from({ length: 30 }, (_, index) => makeNote({
  id: `note_${index}`, title: `対象 ${index}`, body: '確認する内容', dueDate: '2026-09-15'
})) }] });
const save = (page) => page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }));
const settleDeferredSync = (page) => page.evaluate(async (key) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  // 保留した同期のロックが解放されるまで待ち、後続の非同期処理でも
  // 競合しているローカルの編集が置き換わらないことを確認する。
  await navigator.locks.request(key, () => {});
}, storageKey);

test('an input event after search composition does not reset the result scroll again', async ({ page }) => {
  await seedState(page, state());
  await page.locator('#search-input').fill('対象');
  const list = page.locator('.note-list');
  await list.evaluate((element) => { element.scrollTop = 600; });
  const before = await list.evaluate((element) => element.scrollTop);
  expect(before).toBeGreaterThan(0);
  await page.locator('#search-input').dispatchEvent('input');
  expect(await list.evaluate((element) => element.scrollTop)).toBe(before);
  await expect(page.locator('.note-card')).toHaveCount(30);
});

test('a filtered note can leave and rejoin results without moving the reading position', async ({ page }) => {
  await seedState(page, state());
  await page.locator('#search-input').fill('対象');
  await page.locator('.note-card').first().click();
  const list = page.locator('.note-list');
  await list.evaluate((element) => { element.scrollTop = 600; });
  const before = await list.evaluate((element) => element.scrollTop);
  expect(before).toBeGreaterThan(0);
  await page.locator('#note-title-input').fill('変更した付箋');
  await expect(page.locator('.note-card')).toHaveCount(29);
  expect(await list.evaluate((element) => element.scrollTop)).toBe(before);
  await page.locator('#note-body-input').fill('本文を対象にする');
  await expect(page.locator('.note-card')).toHaveCount(30);
  expect(await list.evaluate((element) => element.scrollTop)).toBe(before);
  expect(await save(page)).toBe(true);
});

for (const key of ['Enter', 'ArrowRight']) {
  test(`the calendar applies ${key} to the date actually focused`, async ({ page }) => {
    await seedState(page, state());
    await page.locator('.note-card').first().click();
    await page.locator('#note-due-input').press('Enter');
    await expect(page.locator('.date-day[data-date="2026-09-15"]')).toBeFocused();
    // 支援技術では、矢印キーを送らずにフォーカスを直接移動する場合がある。
    const target = page.locator('.date-day[data-date="2026-09-20"]');
    await target.focus();
    await target.press(key);
    if (key === 'ArrowRight') await page.keyboard.press('Enter');
    const expected = key === 'Enter' ? '2026-09-20' : '2026-09-21';
    await expect(page.locator('#note-due-input')).toHaveValue(expected);
    expect(await save(page)).toBe(true);
    await page.reload();
    await expect(page.locator('.note-card').first().locator('.due-pill')).toHaveAttribute('data-due-date', expected);
  });
}

test.describe('deferred remote updates', () => {
  const origin = 'https://quiet-quality.test';
  const html = readFileSync(fileURLToPath(appUrl), 'utf8');
  test.beforeEach(async ({ context }) => {
    await context.route(`${origin}/**`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
  });

  async function prepare(context) {
    const reader = await context.newPage();
    await reader.goto(origin);
    await reader.locator('.column').first().waitFor();
    await reader.evaluate((state) => window.__PETA_BOARD_TEST__.setState(state), state());
    expect(await save(reader)).toBe(true);
    const writer = await context.newPage();
    await writer.goto(origin);
    await expect(writer.locator('.note-card')).toHaveCount(30);
    return { reader, writer };
  }

  async function remoteEdit(writer) {
    await writer.locator('.column-title').fill('別タブの更新');
    expect(await save(writer)).toBe(true);
  }

  for (const finish of ['pointerup', 'pointercancel', 'blur']) {
    test(`a remote update resumes after a clean ${finish}`, async ({ context }) => {
      const { reader, writer } = await prepare(context);
      await reader.locator('.column-title').dispatchEvent('pointerdown', { pointerId: 71, pointerType: 'mouse', button: 0 });
      await remoteEdit(writer);
      await expect(reader.locator('#storage-status')).toBeVisible();
      await expect(reader.locator('.column-title')).toHaveValue('仕事');
      if (finish === 'blur') await reader.evaluate(() => window.dispatchEvent(new Event('blur')));
      else await reader.locator('.column-title').dispatchEvent(finish, { pointerId: 71, pointerType: 'mouse', button: 0 });
      await expect(reader.locator('.column-title')).toHaveValue('別タブの更新');
      await expect(reader.locator('#storage-status')).toBeHidden();
      expect(await save(reader)).toBe(true);
    });
  }

  test('cancelling a confirmation resumes an update received while it was open', async ({ context }) => {
    const { reader, writer } = await prepare(context);
    await reader.locator('[aria-label="列を削除"]').click();
    await expect(reader.locator('#confirm-modal')).toBeVisible();
    await remoteEdit(writer);
    await expect(reader.locator('#storage-status')).toBeVisible();
    await reader.locator('#confirm-cancel-btn').click();
    await expect(reader.locator('.column-title')).toHaveValue('別タブの更新');
    await expect(reader.locator('.note-card')).toHaveCount(30);
    await expect(reader.locator('#storage-status')).toBeHidden();
  });

  test('accepting a stale deletion still preserves both conflicting versions', async ({ context }) => {
    const { reader, writer } = await prepare(context);
    await reader.locator('[aria-label="列を削除"]').click();
    await remoteEdit(writer);
    await expect(reader.locator('#storage-status')).toBeVisible();
    await reader.locator('#confirm-ok-btn').click();
    await expect(reader.locator('.column')).toHaveCount(0);
    expect(await save(reader)).toBe(false);
    await settleDeferredSync(reader);
    await expect(reader.locator('#storage-status')).toBeVisible();
    expect(await writer.evaluate((key) => JSON.parse(localStorage.getItem(key)).board.columns[0].title, storageKey)).toBe('別タブの更新');
    await expect(reader.locator('.column')).toHaveCount(0);
  });

  for (const selector of ['#note-title-input', '#note-tags-input']) {
    test(`cancelling unchanged composition in ${selector} resumes a deferred remote update`, async ({ context }) => {
      const { reader, writer } = await prepare(context);
      await reader.locator('.note-card').first().click();
      const input = reader.locator(selector);
      await input.focus();
      await input.dispatchEvent('compositionstart');
      await remoteEdit(writer);
      await expect(reader.locator('#storage-status')).toBeVisible();
      await input.dispatchEvent('compositionend');
      await expect(reader.locator('.column-title')).toHaveValue('別タブの更新');
      await expect(reader.locator('#storage-status')).toBeHidden();
      await expect(input).toBeFocused();
      await expect(reader.locator('#note-title-input')).toHaveValue('対象 0');
    });

    test(`committing changed composition in ${selector} keeps local edits during deferred sync`, async ({ context }) => {
      const { reader, writer } = await prepare(context);
      await reader.locator('.note-card').first().click();
      const input = reader.locator(selector);
      await input.focus();
      await input.dispatchEvent('compositionstart');
      await remoteEdit(writer);
      await expect(reader.locator('#storage-status')).toBeVisible();
      await input.evaluate((element) => {
        element.value = 'このタブの編集';
        element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      });
      expect(await save(reader)).toBe(false);
      await settleDeferredSync(reader);
      await expect(input).toHaveValue('このタブの編集');
      await expect(reader.locator('.column-title')).toHaveValue('仕事');
      const local = await reader.evaluate(() => window.__PETA_BOARD_TEST__.getState().board.columns[0].notes[0]);
      expect(selector === '#note-title-input' ? local.title : local.tags[0]).toBe('このタブの編集');
      const saved = await writer.evaluate((key) => JSON.parse(localStorage.getItem(key)).board.columns[0], storageKey);
      expect(saved.title).toBe('別タブの更新');
      expect(saved.notes[0].title).toBe('対象 0');
      expect(saved.notes[0].tags).toEqual([]);
    });
  }
});

test('overlapping search highlights match an independent character-mask oracle', async ({ page }) => {
  await seedState(page, makeMinimalState());
  const word = fc.array(fc.constantFrom('a', 'b', 'c'), { minLength: 1, maxLength: 4 }).map((letters) => letters.join(''));
  const samples = fc.sample(fc.record({
    body: fc.array(fc.constantFrom('a', 'b', 'c', ' '), { minLength: 1, maxLength: 100 }).map((letters) => letters.join('')).filter((body) => Boolean(body.trim())),
    terms: fc.array(word, { minLength: 1, maxLength: 5 })
  }), { seed: 23092026, numRuns: 100 });
  for (const { body, terms } of samples) {
    const expected = Array(body.length).fill(false);
    for (let index = 0; index < body.length; index += 1) {
      for (const term of terms) {
        if (body.startsWith(term, index)) expected.fill(true, index, index + term.length);
      }
    }
    const result = await page.evaluate(({ body, terms }) => {
      window.__PETA_BOARD_TEST__.setState({ board: { columns: [{ title: '列', notes: [{ title: terms.join(' '), body }] }] } });
      const input = document.querySelector('#search-input');
      input.value = terms.join(' ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const paragraph = document.querySelector('.note-body');
      const marked = [];
      for (const node of paragraph.childNodes) {
        marked.push(...Array(node.textContent.length).fill(node.nodeType === Node.ELEMENT_NODE && node.matches('mark')));
      }
      return { text: paragraph.textContent, marked };
    }, { body, terms });
    expect(result.text).toBe(body);
    expect(result.marked, JSON.stringify({ body, terms })).toEqual(expected);
  }
  expect(await save(page)).toBe(true);
});

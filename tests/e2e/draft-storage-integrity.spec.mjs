import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { appUrl, corruptBackupKey, makeMinimalState, makeNote, storageKey } from '../helpers/peta-page.mjs';

const origin = 'https://draft-integrity.test';
const html = readFileSync(fileURLToPath(appUrl), 'utf8');

test.beforeEach(async ({ context }) => {
  await context.route(`${origin}/**`, (route) => route.fulfill({
    contentType: 'text/html',
    body: new URL(route.request().url()).pathname === '/setup' ? '<!doctype html><title>Setup</title>' : html
  }));
});

async function savedState(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
}

test('autosaved checklist whitespace survives repeated reloads without recovery', async ({ page }) => {
  await page.goto(origin);
  await page.locator('.add-note-btn').first().click();
  await page.locator('#note-title-input').fill('保存した仕事のメモ');
  await page.locator('#add-check-btn').click();
  await page.locator('#checklist input[type="text"]').fill(' 見積もりを作成 ');
  await expect.poll(async () => (await savedState(page))?.board.columns[0].notes[0]?.checklist[0]?.text)
    .toBe('見積もりを作成');

  for (let reload = 0; reload < 2; reload += 1) {
    await page.reload();
    await expect(page.locator('.note-title')).toHaveText('保存した仕事のメモ');
    expect((await savedState(page)).board.columns[0].notes[0].checklist[0].text).toBe('見積もりを作成');
    expect(await page.evaluate((key) => localStorage.getItem(key), corruptBackupKey)).toBeNull();
  }
});

test('a recovered stored board keeps its original across reloads until the next save', async ({ page }) => {
  const original = JSON.stringify(makeMinimalState({
    columns: [{ id: 'col_keep', title: '仕事', notes: [makeNote({
      id: 'note_keep', title: '以前の保存から復旧するメモ',
      checklist: [{ id: 'check_keep', text: ' 前後空白を含む以前の入力 ', done: false }]
    })] }]
  }));
  await page.goto(`${origin}/setup`);
  await page.evaluate(({ key, text }) => localStorage.setItem(key, text), { key: storageKey, text: original });
  await page.goto(origin);

  for (let reload = 0; reload < 2; reload += 1) {
    await expect(page.locator('.note-title')).toHaveText('以前の保存から復旧するメモ');
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(original);
    expect(await page.evaluate((key) => localStorage.getItem(key), corruptBackupKey)).toBe(original);
    await page.reload();
  }

  await page.locator('.column-title').fill('復旧を確認した仕事');
  await expect.poll(async () => (await savedState(page)).board.columns[0].title).toBe('復旧を確認した仕事');
  await page.reload();
  await expect(page.locator('.note-title')).toHaveText('以前の保存から復旧するメモ');
  expect((await savedState(page)).board.columns[0].notes[0].checklist[0].text).toBe('前後空白を含む以前の入力');
  expect(await page.evaluate((key) => localStorage.getItem(key), corruptBackupKey)).toBe(original);
});

test('oversized individual tags are visibly rejected while previous saved tags remain intact', async ({ page }) => {
  await page.goto(origin);
  await page.locator('.add-note-btn').first().click();
  await page.locator('#note-title-input').fill('タグの保存整合性');
  const tags = page.locator('#note-tags-input');
  await tags.fill('既存タグ, ' + 'あ'.repeat(32));
  await tags.fill('既存タグ, ' + 'あ'.repeat(33));
  await expect(tags).toHaveValue('既存タグ, ' + 'あ'.repeat(32));
  await expect(tags).toHaveAttribute('aria-describedby', 'note-tags-help');
  await expect(page.locator('#note-tags-help')).toHaveAttribute('role', 'status');
  await expect(page.locator('#note-tags-help')).toContainText('上限を超えた入力は反映していません');
  await tags.dispatchEvent('input', { inputType: 'insertCompositionText', isComposing: false });
  await expect(page.locator('#note-tags-help')).toContainText('上限を超えた入力は反映していません');
  await tags.fill('見直したタグ');
  await expect(page.locator('#note-tags-help')).not.toContainText('上限を超えた入力');
  await tags.fill('既存タグ, ' + 'あ'.repeat(32));
  await page.locator('#close-drawer-btn').click();
  await expect.poll(async () => (await savedState(page))?.board.columns[0].notes[0]?.tags)
    .toEqual(['既存タグ', 'あ'.repeat(32)]);
  await page.reload();
  await page.locator('.note-card').click();
  await expect(tags).toHaveValue('既存タグ, ' + 'あ'.repeat(32));
});

test('a recovered tab shows saved status after adopting a successful save from another tab', async ({ page, context }) => {
  const state = makeMinimalState();
  state.board.title = ' 前後空白のある旧ボード ';
  await page.goto(`${origin}/setup`);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: state });
  await page.goto(origin);
  await expect(page.locator('#save-indicator')).toHaveText('復旧した内容を表示中');

  const other = await context.newPage();
  await other.goto(origin);
  await other.locator('.column-title').first().fill('別タブで保存済み');
  await expect.poll(async () => (await savedState(other)).board.columns[0].title).toBe('別タブで保存済み');
  await expect(page.locator('.column-title').first()).toHaveValue('別タブで保存済み');
  await expect(page.locator('#save-indicator')).toHaveAttribute('data-state', 'saved');
  expect(await page.evaluate((key) => JSON.stringify(window.__PETA_BOARD_TEST__.getState()) === localStorage.getItem(key), storageKey)).toBe(true);
});

for (const completion of ['compositionend', 'drawer-close']) {
  test(`tag composition waits for ${completion} and exports the valid converted text intact`, async ({ page }) => {
    const prefix = 'a'.repeat(29);
    const converted = `${prefix}日本語`;
    await page.goto(origin);
    await page.locator('.add-note-btn').first().click();
    await page.locator('#note-title-input').fill('日本語変換を含むタグ');
    const tags = page.locator('#note-tags-input');
    await tags.fill(prefix);
    await tags.evaluate((input, value) => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      input.value = `${value}にほんご`;
      // ブラウザーによっては変換途中のinputイベントにisComposingが付かない。
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'にほんご' }));
    }, prefix);
    await expect(tags).toHaveValue(`${prefix}にほんご`);
    await expect(page.locator('#note-tags-help')).not.toContainText('上限を超えた入力');
    expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.getState().board.columns[0].notes[0].tags)).toEqual([prefix]);

    await tags.evaluate((input, { value, endComposition }) => {
      input.value = value;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: '日本語' }));
      if (endComposition) input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本語' }));
    }, { value: converted, endComposition: completion === 'compositionend' });
    await page.locator('#close-drawer-btn').click();
    await expect.poll(async () => (await savedState(page))?.board.columns[0].notes[0]?.tags).toEqual([converted]);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#quick-export-btn').click();
    const download = await downloadPromise;
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    expect(JSON.parse(Buffer.concat(chunks).toString('utf8')).board.columns[0].notes[0].tags).toEqual([converted]);
    await page.reload();
    await page.locator('.note-card').click();
    await expect(tags).toHaveValue(converted);
  });
}

import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, openApp, seedState, storageKey } from '../helpers/peta-page.mjs';

const save = (page) => page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }));
const fields = [
  { name: 'note title', selector: '#note-title-input', limit: 120, path: ['board', 'columns', 0, 'notes', 0, 'title'], open: '.note-card' },
  { name: 'note body', selector: '#note-body-input', limit: 4000, path: ['board', 'columns', 0, 'notes', 0, 'body'], open: '.note-card' },
  { name: 'checklist', selector: '#checklist input[type="text"]', limit: 140, path: ['board', 'columns', 0, 'notes', 0, 'checklist', 0, 'text'], open: '.note-card', draft: '確認 ' },
  { name: 'column title', selector: '.column-title', limit: 48, path: ['board', 'columns', 0, 'title'], draft: '作業 ' },
  { name: 'board title', selector: '#board-name-input', limit: 80, path: ['board', 'title'], open: '#settings-btn', draft: '仕事 ' }
];

async function prepare(page) {
  await seedState(page, makeMinimalState({ title: '仕事', columns: [{ id: 'col_a', title: '作業', notes: [makeNote({
    id: 'note_a', title: '保持する付箋', body: '編集する本文', tags: ['alpha'],
    checklist: [{ id: 'check_a', text: '確認', done: false }]
  })] }] }));
}

async function openField(page, field) {
  if (field.open) {
    await page.locator(field.open).click();
    await expect(page.locator(field.open === '#settings-btn' ? '#close-settings-btn' : '#note-title-input')).toBeFocused();
  }
  const input = page.locator(field.selector);
  await input.focus();
  return input;
}

for (const field of fields) {
  test(`IME keeps the over-limit ${field.name} candidate intact until conversion finishes`, async ({ page }) => {
    await prepare(page);
    const input = await openField(page, field);
    const candidate = 'あ'.repeat(field.limit - 1) + '𠮷';
    await input.evaluate((element, value) => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      element.value = value;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    }, candidate);
    await expect(input).toHaveValue(candidate);
    // IMEによっては追加のinputを発火せず、compositionendで確定値を渡す。
    await input.evaluate((element) => {
      element.value = '確定した日本語';
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: element.value }));
    });
    await expect(input).toHaveValue('確定した日本語');
    expect(await save(page)).toBe(true);
    expect(await page.evaluate(({ key, path }) => path.reduce((value, part) => value[part], JSON.parse(localStorage.getItem(key))),
      { key: storageKey, path: field.path })).toBe('確定した日本語');
    await page.reload();
    const reopened = await openField(page, field);
    await expect(reopened).toHaveValue('確定した日本語');
  });

  test(`leaving ${field.name} commits the final composition and enforces its Unicode limit`, async ({ page }) => {
    await prepare(page);
    const input = await openField(page, field);
    await input.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      element.value = '変換途中';
      element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    });
    const prefix = 'あ'.repeat(field.limit - 1);
    await input.evaluate((element, value) => {
      element.value = value;
      element.blur();
    }, prefix + '𠮷');
    await expect(input).toHaveValue(prefix);
    expect(await save(page)).toBe(true);
    expect(await page.evaluate(({ key, path }) => path.reduce((value, part) => value[part], JSON.parse(localStorage.getItem(key))),
      { key: storageKey, path: field.path })).toBe(prefix);
    await expect(page.locator('#save-indicator')).toHaveAttribute('data-state', 'saved');
  });
}

for (const field of [
  ...fields.filter((field) => field.draft),
  { name: 'tag separator', selector: '#note-tags-input', open: '.note-card', draft: 'alpha, ', path: ['board', 'columns', 0, 'notes', 0, 'tags'] }
]) {
  test(`an unrelated remote save preserves the unfinished ${field.name} and next keystroke`, async ({ page, context }) => {
    await prepare(page);
    const peer = await context.newPage();
    await openApp(peer);
    await page.bringToFront();
    const input = await openField(page, field);
    await input.fill(field.draft);
    expect(await save(page)).toBe(true);
    await input.evaluate((element) => element.setSelectionRange(element.value.length, element.value.length));
    await peer.locator('#theme-btn').evaluate((button) => button.click());
    expect(await save(peer)).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(input).toHaveValue(field.draft);
    await expect(input).toBeFocused();
    await page.keyboard.insertText('beta');
    expect(await save(page)).toBe(true);
    const expected = field.name === 'tag separator' ? ['alpha', 'beta'] : `${field.draft}beta`;
    expect(await page.evaluate(({ key, path }) => path.reduce((value, part) => value[part], JSON.parse(localStorage.getItem(key))),
      { key: storageKey, path: field.path })).toEqual(expected);
  });
}

test('actual remote changes replace the focused tag value instead of restoring an old draft', async ({ page, context }) => {
  await prepare(page);
  const peer = await context.newPage();
  await openApp(peer);
  await peer.locator('.note-card').click();
  await page.bringToFront();
  const input = await openField(page, { selector: '#note-tags-input', open: '.note-card' });
  await input.fill('alpha, ');
  await peer.locator('#note-tags-input').evaluate((element) => {
    element.value = 'remote';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await save(peer)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(input).toHaveValue('remote');
  await page.keyboard.press('End');
  await page.keyboard.insertText(', beta');
  expect(await save(page)).toBe(true);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).board.columns[0].notes[0].tags, storageKey)).toEqual(['remote', 'beta']);
});

for (const action of ['add-column', 'move-column', 'move-note', 'duplicate-note', 'delete-note', 'restore-note']) {
  test(`long columns retain their reading position after ${action}`, async ({ page }) => {
    await seedState(page, makeMinimalState({ columns: ['a', 'b', 'c'].map((id) => ({
      id: `col_${id}`, title: `列 ${id}`, notes: Array.from({ length: 35 }, (_, index) => makeNote({
        id: `note_${id}_${index}`, title: `仕事 ${index}`, body: '一覧の閲覧位置を維持する'
      }))
    })) }));
    if (['move-note', 'duplicate-note', 'delete-note', 'restore-note'].includes(action)) {
      await page.locator('[data-note-id="note_a_0"]').click();
      await expect(page.locator('#note-title-input')).toBeFocused();
    }
    const list = page.locator('.note-list[data-column-id="col_b"]');
    await list.evaluate((element) => { element.scrollTop = 650; });
    const before = await list.evaluate((element) => element.scrollTop);
    expect(before).toBeGreaterThan(0);
    if (action === 'add-column') await page.locator('.add-column-panel button').click();
    if (action === 'move-column') await page.locator('.column[data-column-id="col_a"]').getByRole('button', { name: '右へ移動' }).click();
    if (action === 'move-note') await page.locator('#note-column-input').selectOption('col_c');
    if (action === 'duplicate-note') await page.locator('#duplicate-note-btn').click();
    if (action === 'delete-note' || action === 'restore-note') {
      await page.locator('#delete-note-btn').click();
      await page.locator('#confirm-ok-btn').click();
      await expect(page.locator('#note-drawer')).toBeHidden();
      if (action === 'restore-note') {
        await list.evaluate((element) => { element.scrollTop = 650; });
        await page.locator('#deletion-undo-btn').click();
      }
    }
    expect(await list.evaluate((element) => element.scrollTop)).toBe(before);
    expect(await save(page)).toBe(true);
  });
}

test('a newly opened note starts at the beginning of its checklist', async ({ page }) => {
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_a', title: '作業', notes: ['a', 'b'].map((id) => makeNote({
    id: `note_${id}`, title: `付箋 ${id}`, checklist: Array.from({ length: 30 }, (_, index) => ({
      id: `check_${id}_${index}`, text: `手順 ${index}`, done: false
    }))
  })) }] }));
  await page.locator('[data-note-id="note_a"]').click();
  await expect(page.locator('#note-title-input')).toBeFocused();
  await page.locator('#checklist').evaluate((element) => { element.scrollTop = 600; });
  expect(await page.locator('#checklist').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.locator('#close-drawer-btn').click();
  await page.locator('[data-note-id="note_b"]').click();
  await expect(page.locator('#note-title-input')).toBeFocused();
  expect(await page.locator('#checklist').evaluate((element) => element.scrollTop)).toBe(0);
});

test('scrolling over a read-only due date still scrolls the small-screen editor', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 500 });
  await prepare(page);
  await page.locator('.note-card').click();
  await expect(page.locator('#note-title-input')).toBeFocused();
  const due = page.locator('#note-due-input');
  const body = page.locator('.drawer-body');
  // 検証前に、WebKitのlocator.hoverによる自動スクロールで末尾まで移動しないようにする。
  const position = await body.evaluate((element) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
    const viewport = element.getBoundingClientRect();
    const input = document.querySelector('#note-due-input').getBoundingClientRect();
    const top = Math.max(viewport.top, input.top);
    const bottom = Math.min(viewport.bottom, input.bottom);
    return { x: input.left + input.width / 2, y: (top + bottom) / 2, visibleHeight: bottom - top, before: element.scrollTop };
  });
  expect(position.before).toBeGreaterThan(0);
  expect(position.visibleHeight).toBeGreaterThan(0);
  await page.mouse.move(position.x, position.y);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, position)).toBe('note-due-input');
  await page.mouse.wheel(0, -160);
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeLessThan(position.before);
  await expect(due).toHaveValue('');
  await expect(page.locator('#date-popover')).toBeHidden();
});

test('remote checklist content changes are kept when the focused old row is replaced', async ({ page, context }) => {
  await prepare(page);
  const peer = await context.newPage();
  await openApp(peer);
  await peer.locator('.note-card').click();
  await page.bringToFront();
  const input = await openField(page, fields[2]);
  await input.fill('確認 ');
  await peer.locator('#checklist input[type="text"]').evaluate((element) => {
    element.value = '別タブの手順';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await save(peer)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(input).toHaveValue('別タブの手順');
  expect(await save(page)).toBe(true);
  await page.reload();
  await page.locator('.note-card').click();
  await expect(input).toHaveValue('別タブの手順');
});

test('frequent body matches keep search rendering bounded without losing text or results', async ({ page }) => {
  const body = 'ab'.repeat(2000);
  const board = (count) => makeMinimalState({ columns: [{ id: 'col_a', title: '作業', notes: Array.from({ length: count }, (_, index) => makeNote({
    id: `note_${index}`, title: index ? `付箋 ${index}` : 'needle', body
  })) }] });
  // 最大件数のボードを検証する前に、1枚の付箋で描画要素数の上限が働くことを確認する。
  await seedState(page, board(1));
  await page.locator('#search-input').fill('a');
  expect(await page.locator('.note-body .search-hit').count()).toBeLessThanOrEqual(128);
  await expect(page.locator('.note-body')).toHaveText(body);
  await seedState(page, board(500));
  const original = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  await page.locator('#search-input').fill('a');
  await expect(page.locator('.note-card')).toHaveCount(500);
  expect(await page.locator('.note-body .search-hit').count()).toBeLessThanOrEqual(500 * 128);
  expect(await page.locator('.note-body').evaluateAll((elements, expected) => elements.every((element) => element.textContent === expected), body)).toBe(true);
  await page.locator('#search-input').fill('needle');
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.note-title')).toHaveText('needle');
  await page.locator('#search-input').press('Escape');
  await expect(page.locator('.note-card')).toHaveCount(500);
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(original);
});

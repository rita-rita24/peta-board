import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, openApp, seedState, storageKey } from '../helpers/peta-page.mjs';

const save = (page) => page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }));
const stored = (page) => page.evaluate((key) => localStorage.getItem(key), storageKey);

async function remoteThemeChange(page, context, existingPeer = null) {
  const peer = existingPeer || await context.newPage();
  if (!existingPeer) await openApp(peer);
  await page.bringToFront();
  await peer.locator('#theme-btn').evaluate((button) => button.click());
  expect(await save(peer)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
}

async function prepare(page) {
  await seedState(page, makeMinimalState({ columns: [
    { id: 'col_a', title: '列A', notes: [
      makeNote({ id: 'note_a', title: '保持する付箋', body: '本文を編集します', checklist: [
        { id: 'check_a', text: '確認する項目', done: false },
        { id: 'check_b', text: '次の項目', done: false }
      ] }),
      makeNote({ id: 'note_b', title: '次の付箋' })
    ] },
    { id: 'col_b', title: '列B', notes: [] }
  ] }));
}

test('followup round 3: checklist selection survives an unrelated remote update', async ({ page, context }) => {
  await prepare(page);
  await page.locator('[data-note-id="note_a"]').click();
  await expect(page.locator('#note-title-input')).toBeFocused();
  const input = page.locator('[data-check-id="check_a"] input[type="text"]');
  await input.focus();
  await input.evaluate((element) => element.setSelectionRange(0, 2, 'backward'));
  await remoteThemeChange(page, context);
  await expect(input).toBeFocused();
  expect(await input.evaluate((element) => [element.selectionStart, element.selectionEnd, element.selectionDirection])).toEqual([0, 2, 'backward']);
  await page.keyboard.insertText('検証');
  expect(await save(page)).toBe(true);
  await page.reload();
  await page.locator('[data-note-id="note_a"]').click();
  await expect(input).toHaveValue('検証する項目');
});

test('followup round 4: remote board renaming updates the focused settings field before further typing', async ({ page, context }) => {
  await prepare(page);
  const peer = await context.newPage();
  await openApp(peer);
  await peer.locator('#settings-btn').click();
  await page.bringToFront();
  await page.locator('#settings-btn').click();
  await expect(page.locator('#close-settings-btn')).toBeFocused();
  const name = page.locator('#board-name-input');
  await name.focus();
  await peer.locator('#board-name-input').evaluate((input) => {
    input.value = '別タブの新しい名前';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await save(peer)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('#board-title')).toHaveText('別タブの新しい名前');
  await expect(name).toHaveValue('別タブの新しい名前');
  await expect(name).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.insertText('を編集');
  expect(await save(page)).toBe(true);
  await page.reload();
  await expect(page.locator('#board-title')).toHaveText('別タブの新しい名前を編集');
});

test('followup round 5: a read-only due date still supports select-all and copy shortcuts', async ({ page }) => {
  await prepare(page);
  await page.locator('[data-note-id="note_a"]').click();
  await page.locator('#note-due-input').click();
  await page.locator('#date-today-btn').click();
  const due = page.locator('#note-due-input');
  await expect(due).toBeFocused();
  const value = await due.inputValue();
  const original = await page.evaluate(() => window.__PETA_BOARD_TEST__.getState().board.columns[0].notes[0].dueDate);
  await page.keyboard.press('ControlOrMeta+A');
  expect(await due.evaluate((input) => input.value.slice(input.selectionStart, input.selectionEnd))).toBe(value);
  for (const modifier of ['ctrlKey', 'metaKey']) {
    expect(await due.evaluate((input, modifier) => {
      const event = new KeyboardEvent('keydown', { key: 'c', [modifier]: true, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    }, modifier)).toBe(false);
  }
  await page.keyboard.insertText('invalid');
  await expect(due).toHaveValue(original);
  await expect(page.locator('#date-popover')).toBeHidden();
});

test('followup round 6: every search term within the input limit participates in filtering', async ({ page }) => {
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_a', title: '対象', notes: [
    makeNote({ id: 'note_a', title: 'a b c d e f g h', body: '前半だけ一致' }),
    makeNote({ id: 'note_b', title: 'a b c d e f g h', body: '最後まで一致 needle' })
  ] }] }));
  const original = await stored(page);
  await page.locator('#search-input').fill('a b c d e f g h needle');
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.note-card')).toHaveAttribute('data-note-id', 'note_b');
  await expect(page.locator('.note-body mark')).toHaveText('needle');
  await expect(page.locator('#board-summary')).toHaveText('検索結果 1件 / 付箋 2件');
  await page.locator('#search-input').fill('a b c d e f g h needle missing');
  await expect(page.locator('.note-card')).toHaveCount(0);
  await page.locator('#search-input').press('Escape');
  await expect(page.locator('.note-card')).toHaveCount(2);
  expect(await stored(page)).toBe(original);
});

test('followup round 7: search composition is not truncated or replaced by remote rendering', async ({ page, context }) => {
  await prepare(page);
  const peer = await context.newPage();
  await openApp(peer);
  await page.bringToFront();
  const search = page.locator('#search-input');
  await search.fill('保持');
  const composingValue = 'あ'.repeat(79) + '𠮷';
  await search.evaluate((input, value) => {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  }, composingValue);
  await expect(search).toHaveValue(composingValue);
  await expect(page.locator('.note-card')).toHaveCount(1);
  await remoteThemeChange(page, context, peer);
  await expect(search).toHaveValue(composingValue);
  await search.evaluate((input) => {
    input.value = '次の付箋';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '次の付箋' }));
  });
  await expect(search).toHaveValue('次の付箋');
  await expect(page.locator('.note-card')).toHaveCount(1);
  await expect(page.locator('.note-card')).toHaveAttribute('data-note-id', 'note_b');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(page.locator('.note-card')).toHaveCount(2);
});

test('followup round 8: remote synchronization preserves the reading position in long columns', async ({ page, context }) => {
  await seedState(page, makeMinimalState({ columns: [
    { id: 'col_a', title: '長い列', notes: Array.from({ length: 40 }, (_, index) => makeNote({ id: `note_${index}`, title: `付箋 ${index}`, body: 'スクロール位置を保つ本文' })) },
    { id: 'col_b', title: '別の列', notes: [] }
  ] }));
  const peer = await context.newPage();
  await openApp(peer);
  await page.bringToFront();
  const list = page.locator('.note-list').first();
  await list.evaluate((element) => { element.scrollTop = 700; });
  const before = await list.evaluate((element) => element.scrollTop);
  expect(before).toBeGreaterThan(0);
  await remoteThemeChange(page, context, peer);
  expect(await list.evaluate((element) => element.scrollTop)).toBe(before);
  await page.locator('#search-input').fill('付箋 39');
  await expect(page.locator('[data-note-id="note_39"]')).toBeVisible();
  expect(await list.evaluate((element) => element.scrollTop)).toBe(0);
});

for (const dialog of ['editor', 'settings']) {
  test(`followup round 9: remote updates preserve the keyboard color choice in ${dialog}`, async ({ page, context }) => {
    await prepare(page);
    const peer = await context.newPage();
    await openApp(peer);
    await page.bringToFront();
    const editor = dialog === 'editor';
    await page.locator(editor ? '[data-note-id="note_a"]' : '#settings-btn').click();
    await expect(page.locator(editor ? '#note-title-input' : '#close-settings-btn')).toBeFocused();
    const grid = page.locator(editor ? '#note-color-grid' : '#default-color-grid');
    const blue = grid.getByRole('button', { name: editor ? '青' : '付箋の初期色: 青', exact: true });
    await blue.focus();
    await expect(blue).toHaveAttribute('aria-pressed', 'false');
    await remoteThemeChange(page, context, peer);
    await expect(blue).toBeFocused();
    await expect(blue).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Enter');
    await expect(blue).toHaveAttribute('aria-pressed', 'true');
    expect(await save(page)).toBe(true);
    const saved = JSON.parse(await stored(page));
    expect(editor ? saved.board.columns[0].notes[0].color : saved.settings.defaultColor).toBe('blue');
  });
}

for (const action of [
  { name: 'column addition', trigger: '.add-column-panel button', target: '#search-input' },
  { name: 'checklist addition', trigger: '#add-check-btn', target: '#note-body-input', editor: true },
  { name: 'checklist undo', trigger: '#checklist-undo-btn', target: '#note-body-input', editor: true, remove: true },
  { name: 'editor closing', trigger: '#close-drawer-btn', target: '#search-input', editor: true },
  { name: 'settings closing', trigger: '#close-settings-btn', target: '#search-input', open: '#settings-btn', initial: '#close-settings-btn' },
  { name: 'help closing', trigger: '#close-help-btn', target: '#search-input', open: '#help-btn', initial: '#close-help-btn' },
  { name: 'confirmation closing', trigger: '#confirm-cancel-btn', target: '#note-body-input', editor: true, confirm: true }
]) {
  test(`followup round 10: delayed ${action.name} keeps a newer focus choice`, async ({ page }) => {
    await prepare(page);
    if (action.editor) {
      await page.locator('[data-note-id="note_a"]').click();
      await expect(page.locator('#note-title-input')).toBeFocused();
    }
    if (action.open) {
      await page.locator(action.open).click();
      await expect(page.locator(action.initial)).toBeFocused();
    }
    if (action.remove) await page.locator('[data-check-id="check_a"] button').click();
    if (action.confirm) {
      await page.locator('#delete-note-btn').click();
      await expect(page.locator('#confirm-cancel-btn')).toBeFocused();
    }
    await page.evaluate(({ trigger, target }) => {
      const callbacks = [];
      const request = window.requestAnimationFrame;
      window.requestAnimationFrame = (callback) => callbacks.push(callback);
      document.querySelector(trigger).click();
      document.querySelector(target).focus();
      window.requestAnimationFrame = request;
      for (const callback of callbacks) callback(performance.now());
    }, action);
    await expect(page.locator(action.target)).toBeFocused();
  });
}

test('followup round 10: an earlier drag timer cannot enable a click after a later cancellation', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-22T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-22T00:00:01Z'));
  await prepare(page);
  let handle = page.locator('[data-note-id="note_a"] .note-drag-handle');
  let box = await handle.boundingBox();
  const target = await page.locator('.column').nth(1).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width - 20, target.y + 110, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.column[data-column-id="col_b"] [data-note-id="note_a"]')).toHaveCount(1);
  expect(await save(page)).toBe(true);
  const original = await stored(page);
  handle = page.locator('[data-note-id="note_a"] .note-drag-handle');
  box = await handle.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(() => document.addEventListener('pointerdown', (event) => { window.lastPointerId = event.pointerId; }, { once: true }));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 15, y, { steps: 3 });
  await handle.evaluate((element) => element.closest('.note-card').releasePointerCapture(window.lastPointerId));
  await page.mouse.move(x + 20, y);
  await expect(page.locator('.is-dragging, .drop-marker')).toHaveCount(0);
  await page.clock.runFor(300);
  await page.mouse.up();
  await page.clock.runFor(20);
  await expect(page.locator('#note-drawer')).toBeHidden();
  expect(await save(page)).toBe(true);
  expect(await stored(page)).toBe(original);
});

for (const kind of ['note', 'column']) {
  test(`followup round 1: dropping a ${kind} in its original position does not write an edit`, async ({ page }) => {
    await prepare(page);
    const original = await stored(page);
    const handle = page.locator(kind === 'note' ? '.note-drag-handle' : '.column-handle').first();
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 12, y, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator('.column').first()).toHaveAttribute('data-column-id', 'col_a');
    await expect(page.locator('.note-card').first()).toHaveAttribute('data-note-id', 'note_a');
    expect(await save(page)).toBe(true);
    expect(await stored(page)).toBe(original);
    await expect(page.locator('.is-dragging, .is-column-dragging, .drop-marker, .column-drop-marker')).toHaveCount(0);
  });
}

for (const kind of ['note', 'column']) {
  test(`followup round 2: losing pointer capture cancels a ${kind} drag and frees the next gesture`, async ({ page }) => {
    await prepare(page);
    const original = await stored(page);
    const handle = page.locator(kind === 'note' ? '.note-drag-handle' : '.column-handle').first();
    await page.evaluate(() => document.addEventListener('pointerdown', (event) => { window.lastPointerId = event.pointerId; }, { once: true }));
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 20, y, { steps: 3 });
    await expect(page.locator('.is-dragging, .is-column-dragging')).toHaveCount(1);
    await handle.evaluate((element, kind) => {
      (kind === 'note' ? element.closest('.note-card') : element).releasePointerCapture(window.lastPointerId);
    }, kind);
    await page.mouse.move(x + 25, y);
    await expect(page.locator('.is-dragging, .is-column-dragging, .drop-marker, .column-drop-marker')).toHaveCount(0);
    await page.mouse.up();
    expect(await save(page)).toBe(true);
    expect(await stored(page)).toBe(original);
    const target = await page.locator('.column').nth(1).boundingBox();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width - 15, target.y + 110, { steps: 5 });
    await page.mouse.up();
    if (kind === 'note') await expect(page.locator('[data-column-id="col_b"] .note-card')).toHaveCount(1);
    else await expect(page.locator('.column').last()).toHaveAttribute('data-column-id', 'col_a');
  });
}

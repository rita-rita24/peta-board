import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, seedState, storageKey } from '../helpers/peta-page.mjs';

const checklistRow = (page, id) => page.locator(`#checklist [data-check-id="${id}"]`);
const checklistText = (page, id) => checklistRow(page, id).getByRole('textbox', { name: 'チェック項目' });

async function expectSavedChecklist(page, expected) {
  await expect.poll(() => page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key));
    return saved?.board.columns[0].notes[0].checklist;
  }, storageKey)).toEqual(expected);
  await page.reload();
  const restored = await page.evaluate(() => window.__PETA_BOARD_TEST__.getState().board.columns[0].notes[0].checklist);
  expect(restored).toEqual(expected);
}

test.describe('checklist focus and stable item identity', () => {
  let errors = [];
  const second = { id: 'check_b', text: 'Bの項目', done: false };
  const third = { id: 'check_c', text: 'Cの項目', done: false };

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await seedState(page, makeMinimalState({
      columns: [{
        id: 'col_checks', title: 'Checks', notes: [makeNote({
          id: 'note_checks', title: '項目の対応確認', checklist: [
            { id: 'check_a', text: 'Aの項目', done: false }, second, third
          ]
        })]
      }]
    }));
    await page.locator('[data-note-id="note_checks"]').click();
    await expect(page.locator('#note-drawer')).toBeVisible();
    await expect(page.locator('#note-title-input')).toBeFocused();
    await checklistText(page, 'check_a').fill('');
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('checking a later item after emptying the first updates only that item', async ({ page }) => {
    await checklistRow(page, 'check_b').getByRole('checkbox', { name: '完了' }).check();
    await expect(checklistRow(page, 'check_a')).toHaveCount(0);
    await expectSavedChecklist(page, [{ ...second, done: true }, third]);
  });

  test('the pressed checkbox stays in place until the pointer click completes', async ({ page }) => {
    const checkbox = checklistRow(page, 'check_b').getByRole('checkbox', { name: '完了' });
    await checkbox.click({ trial: true });
    const before = await checkbox.boundingBox();
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    // ポインターを押している間は、blur後の遅延処理でクリック対象が失われないようにする。
    await page.waitForTimeout(200);
    const pressed = await checkbox.boundingBox();
    expect(pressed).toEqual(before);
    await page.mouse.up();
    await expect(checkbox).toBeChecked();
    await expect(checklistRow(page, 'check_a')).toHaveCount(0);
    await expectSavedChecklist(page, [{ ...second, done: true }, third]);
  });

  test('editing a later item keeps its input focused when an empty row is removed', async ({ page }) => {
    await checklistText(page, 'check_b').fill('Bだけを編集');
    await expect(checklistText(page, 'check_b')).toBeFocused();
    await expect(checklistText(page, 'check_c')).toHaveValue(third.text);
    await expectSavedChecklist(page, [{ ...second, text: 'Bだけを編集' }, third]);
  });

  test('deleting the empty row preserves both following items', async ({ page }) => {
    await checklistRow(page, 'check_a').getByRole('button', { name: '項目を削除' }).click();
    await expectSavedChecklist(page, [second, third]);
  });

  test('deleting a different row after emptying the first removes the intended IDs', async ({ page }) => {
    await checklistRow(page, 'check_b').getByRole('button', { name: '項目を削除' }).click();
    await expectSavedChecklist(page, [third]);
  });

  test('Tab preserves the next control while leaving an empty checklist row', async ({ page }) => {
    await page.keyboard.press('Tab');
    await expect(checklistRow(page, 'check_a').getByRole('button', { name: '項目を削除' })).toBeFocused();
    await page.keyboard.press('Tab');
    const checkbox = checklistRow(page, 'check_b').getByRole('checkbox', { name: '完了' });
    await expect(checkbox).toBeFocused();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    await expectSavedChecklist(page, [{ ...second, done: true }, third]);
  });

  test('moving within the same row permits completing an unfinished edit', async ({ page }) => {
    await checklistRow(page, 'check_a').getByRole('checkbox', { name: '完了' }).check();
    await checklistText(page, 'check_a').fill('Aの入力を続ける');
    await checklistText(page, 'check_b').focus();
    await expectSavedChecklist(page, [{ id: 'check_a', text: 'Aの入力を続ける', done: true }, second, third]);
  });

  for (const close of ['Escape', 'backdrop']) {
    test(`${close} commits checklist whitespace so the exported board can be imported again`, async ({ page }) => {
      await checklistText(page, 'check_b').fill('  Bの確定した項目  ');
      if (close === 'Escape') await page.keyboard.press('Escape');
      else await page.locator('#drawer-backdrop').click({ position: { x: 5, y: 5 } });
      await expect(page.locator('#note-drawer')).toBeHidden();
      await page.locator('#settings-btn').click();
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#export-board-btn').click();
      const download = await downloadPromise;
      const chunks = [];
      for await (const chunk of await download.createReadStream()) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      const exported = JSON.parse(buffer.toString('utf8'));
      expect(exported.board.columns[0].notes[0].checklist).toEqual([{ ...second, text: 'Bの確定した項目' }, third]);
      await page.setInputFiles('#import-board-file', { name: 'checklist-roundtrip.json', mimeType: 'application/json', buffer });
      await expect(page.locator('#confirm-modal')).toBeVisible();
      await page.locator('#confirm-ok-btn').click();
      await expectSavedChecklist(page, [{ ...second, text: 'Bの確定した項目' }, third]);
    });
  }
});

async function touchDrag(page, start, end) {
  const session = await page.context().newCDPSession(page);
  const point = (x, y) => ({ x, y, radiusX: 2, radiusY: 2, force: 1 });
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(start.x, start.y)] });
    for (let step = 1; step <= 12; step += 1) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [point(start.x + (end.x - start.x) * step / 12, start.y + (end.y - start.y) * step / 12)]
      });
      await page.waitForTimeout(16);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

function touchBoard(noteCount = 1) {
  return makeMinimalState({ columns: [
    {
      id: 'col_source', title: '移動元', notes: Array.from({ length: noteCount }, (_, index) => makeNote({
        id: `note_touch_${index}`, title: `タッチ操作の付箋${index}`, body: 'カードの本文からスクロールできます。'
      }))
    },
    { id: 'col_target', title: '移動先', notes: [] }
  ] });
}

async function expectMovedNote(page) {
  await expect.poll(() => page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key));
    return saved?.board.columns.map((column) => column.notes.map((note) => note.id));
  }, storageKey)).toEqual([[], ['note_touch_0']]);
  await expect(page.locator('#note-drawer')).toBeHidden();
  await expect(page.locator('.note-card.is-dragging')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-column-id="col_target"] [data-note-id="note_touch_0"]')).toHaveCount(1);
}

test.describe('touch scrolling and note drag handle', () => {
  test.use({ hasTouch: true, viewport: { width: 900, height: 700 } });
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Raw touch injection uses Chromium CDP; other engines run the pointer and responsive coverage.');
  });

  test('a real touch pan beginning on a card scrolls its list without moving notes', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await seedState(page, touchBoard(20));
    const list = page.locator('.note-list[data-column-id="col_source"]');
    const card = await page.locator('[data-note-id="note_touch_1"]').boundingBox();
    const start = { x: card.x + 36, y: card.y + 60 };
    await touchDrag(page, start, { x: start.x, y: start.y - 180 });

    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    await expect(page.locator('#note-drawer')).toBeHidden();
    await expect(page.locator('.note-card.is-dragging')).toHaveCount(0);
    const ids = await page.evaluate(() => window.__PETA_BOARD_TEST__.getState().board.columns.map((column) => column.notes.map((note) => note.id)));
    expect(ids).toEqual([Array.from({ length: 20 }, (_, index) => `note_touch_${index}`), []]);
    expect(errors).toEqual([]);
  });

  test('a real touch drag on the handle moves and saves a note', async ({ page }) => {
    await seedState(page, touchBoard());
    const handle = await page.locator('[data-note-id="note_touch_0"] .note-drag-handle').boundingBox();
    const target = await page.locator('.note-list[data-column-id="col_target"]').boundingBox();
    await touchDrag(page,
      { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
      { x: target.x + 70, y: target.y + 60 });
    await expectMovedNote(page);
  });
});

test('mouse users can still drag from the card body outside the handle', async ({ page }) => {
  await seedState(page, touchBoard());
  const card = await page.locator('[data-note-id="note_touch_0"]').boundingBox();
  const target = await page.locator('.note-list[data-column-id="col_target"]').boundingBox();
  await page.mouse.move(card.x + 36, card.y + 60);
  await page.mouse.down();
  await page.mouse.move(target.x + 70, target.y + 60, { steps: 10 });
  await page.mouse.up();
  await expectMovedNote(page);
});

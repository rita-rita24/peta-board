import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, seedState, storageKey } from '../helpers/peta-page.mjs';

async function startDrag(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

for (const kind of ['note', 'column']) {
  test(`a ${kind} can be dragged to a column beyond the horizontal viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await seedState(page, makeMinimalState({ columns: Array.from({ length: 7 }, (_, index) => ({
      id: `col_${index}`, title: `列 ${index}`, notes: index === 0 ? [makeNote({ id: 'note_drag', title: '遠くへ移動' })] : []
    })) }));
    const shell = page.locator('.board-shell');
    const edge = await shell.boundingBox();
    await startDrag(page, page.locator(kind === 'note' ? '.note-drag-handle' : '.column-handle').first());
    await page.mouse.move(edge.x + edge.width - 8, edge.y + 120, { steps: 4 });
    await expect.poll(() => page.locator('.column[data-column-id="col_6"]').evaluate((element) => element.getBoundingClientRect().right), { timeout: 5000 }).toBeLessThan(edge.x + edge.width - 16);
    const target = await page.locator('.column[data-column-id="col_6"] .note-list').boundingBox();
    await page.mouse.move(Math.min(target.x + target.width - 15, edge.x + edge.width - 25), target.y + 30);
    await page.mouse.up();
    if (kind === 'note') {
      await expect(page.locator('.column[data-column-id="col_6"] .note-card')).toHaveAttribute('data-note-id', 'note_drag');
    } else {
      await expect(page.locator('.column').last()).toHaveAttribute('data-column-id', 'col_0');
    }
    await expect(page.locator('.drop-marker, .column-drop-marker, .is-dragging, .is-column-dragging')).toHaveCount(0);
    const stopped = await shell.evaluate((element) => element.scrollLeft);
    await page.waitForTimeout(100);
    expect(await shell.evaluate((element) => element.scrollLeft)).toBe(stopped);
    expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }))).toBe(true);
    await page.reload();
    if (kind === 'note') await expect(page.locator('.column[data-column-id="col_6"] .note-card')).toHaveAttribute('data-note-id', 'note_drag');
    else await expect(page.locator('.column').last()).toHaveAttribute('data-column-id', 'col_0');
  });
}

for (const direction of ['down', 'up']) {
  test(`dragging a note ${direction} scrolls a long destination list`, async ({ page }) => {
    await seedState(page, makeMinimalState({ columns: [
      { id: 'col_source', title: '移動元', notes: [makeNote({ id: 'note_drag', title: '移動対象' })] },
      { id: 'col_target', title: '移動先', notes: Array.from({ length: 30 }, (_, index) => makeNote({ id: `note_${index}`, title: `項目 ${index}` })) }
    ] }));
    const list = page.locator('.note-list[data-column-id="col_target"]');
    if (direction === 'up') await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const before = await list.evaluate((element) => element.scrollTop);
    await startDrag(page, page.locator('.column[data-column-id="col_source"] .note-drag-handle'));
    const box = await list.boundingBox();
    await page.mouse.move(box.x + box.width / 2, direction === 'down' ? box.y + box.height - 8 : box.y + 8, { steps: 4 });
    if (direction === 'down') await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(before + 350);
    else await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeLessThan(before - 350);
    await page.mouse.up();
    await expect(page.locator('.column[data-column-id="col_target"] [data-note-id="note_drag"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }))).toBe(true);
    const ids = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).board.columns[1].notes.map((note) => note.id), storageKey);
    expect(new Set(ids).size).toBe(31);
    expect(ids.indexOf('note_drag')).toBeGreaterThan(0);
    expect(ids.indexOf('note_drag')).toBeLessThan(30);
  });
}

for (const cancel of ['Escape', 'blur', 'outside']) {
  test(`${cancel} stops edge scrolling and leaves the dragged note in its original column`, async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await seedState(page, makeMinimalState({ columns: Array.from({ length: 7 }, (_, index) => ({
      id: `col_${index}`, title: `列 ${index}`, notes: index === 0 ? [makeNote({ id: 'note_drag', title: 'キャンセル対象' })] : []
    })) }));
    await startDrag(page, page.locator('.note-drag-handle'));
    const shell = page.locator('.board-shell');
    const box = await shell.boundingBox();
    await page.mouse.move(box.x + box.width - 8, box.y + 120);
    await expect.poll(() => shell.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    if (cancel === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (cancel === 'outside') await page.mouse.move(500, 10);
    const stopped = await shell.evaluate((element) => element.scrollLeft);
    await page.waitForTimeout(100);
    expect(await shell.evaluate((element) => element.scrollLeft)).toBe(stopped);
    await page.mouse.up();
    await expect(page.locator('.column[data-column-id="col_0"] .note-card')).toHaveAttribute('data-note-id', 'note_drag');
    await expect(page.locator('#note-drawer')).toBeHidden();
  });
}

test('a touch handle can scroll left to a column that starts outside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await seedState(page, makeMinimalState({ columns: Array.from({ length: 7 }, (_, index) => ({
    id: `col_${index}`, title: `列 ${index}`, notes: index === 6 ? [makeNote({ id: 'note_drag', title: '左へ移動' })] : []
  })) }));
  const shell = page.locator('.board-shell');
  await shell.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  const before = await shell.evaluate((element) => element.scrollLeft);
  expect(before).toBeGreaterThan(1000);
  await page.locator('.note-drag-handle').evaluate((handle) => {
    const rect = handle.getBoundingClientRect();
    const shell = document.querySelector('.board-shell').getBoundingClientRect();
    window.touchDragPoint = { x: shell.left + 8, y: shell.top + 120 };
    const fire = (type, x, y) => handle.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 77, pointerType: 'touch',
      button: 0, buttons: 1, clientX: x, clientY: y
    }));
    fire('pointerdown', rect.left + rect.width / 2, rect.top + rect.height / 2);
    fire('pointermove', window.touchDragPoint.x, window.touchDragPoint.y);
  });
  await expect.poll(() => shell.evaluate((element) => element.scrollLeft)).toBe(0);
  await page.evaluate(() => {
    const target = document.querySelector('.column[data-column-id="col_0"] .note-list').getBoundingClientRect();
    document.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, pointerId: 77, pointerType: 'touch',
      button: 0, buttons: 0, clientX: target.left + target.width / 2, clientY: target.top + 30
    }));
  });
  await expect(page.locator('.column[data-column-id="col_0"] .note-card')).toHaveAttribute('data-note-id', 'note_drag');
  expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }))).toBe(true);
  await page.reload();
  await expect(page.locator('.column[data-column-id="col_0"] .note-card')).toHaveAttribute('data-note-id', 'note_drag');
});

test('equal animation timestamps do not strand an active edge drag', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await seedState(page, makeMinimalState({ columns: Array.from({ length: 7 }, (_, index) => ({
    id: `col_${index}`, title: `列 ${index}`, notes: index === 0 ? [makeNote({ id: 'note_drag', title: '移動対象' })] : []
  })) }));
  const result = await page.evaluate(() => {
    const frames = [];
    window.requestAnimationFrame = (callback) => frames.push(callback);
    const handle = document.querySelector('.note-drag-handle');
    const box = handle.getBoundingClientRect();
    const shell = document.querySelector('.board-shell');
    const edge = shell.getBoundingClientRect();
    const fire = (type, x, y) => handle.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 77, pointerType: 'mouse',
      button: 0, buttons: 1, clientX: x, clientY: y
    }));
    fire('pointerdown', box.left + box.width / 2, box.top + box.height / 2);
    fire('pointermove', edge.right - 8, edge.top + 120);
    for (const time of [100, 100, 116, 133]) {
      for (const frame of frames.splice(0)) frame(time);
    }
    const left = shell.scrollLeft;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return left;
  });
  expect(result).toBeGreaterThan(24);
});

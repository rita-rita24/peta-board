import { expect, test } from '@playwright/test';
import { makeMinimalState, seedState, storageKey } from '../helpers/peta-page.mjs';

for (const movement of ['outdated-move', 'no-move', 'unrelated-cancel']) {
  test(`column drag commits the release position and persists with ${movement}`, async ({ page }) => {
    await seedState(page, makeMinimalState({ columns: ['a', 'b', 'c'].map((id) => ({
      id: `col_${id}`, title: id.toUpperCase(), notes: []
    })) }));
    await page.evaluate((movement) => {
      const column = document.querySelector('[data-column-id="col_a"]');
      const handle = column.querySelector('.column-handle');
      const first = column.getBoundingClientRect();
      const last = document.querySelector('[data-column-id="col_c"]').getBoundingClientRect();
      const startX = first.left + 20;
      const y = first.top + 20;
      const fire = (type, x, pointerId = 19) => handle.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerType: 'mouse', pointerId,
        button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y
      }));
      fire('pointerdown', startX);
      if (movement !== 'no-move') fire('pointermove', startX + 20);
      if (movement === 'unrelated-cancel') fire('pointercancel', startX + 20, 20);
      fire('pointerup', last.right - 20);
    }, movement);
    await expect.poll(() => page.locator('.column-title').evaluateAll((inputs) => inputs.map((input) => input.value))).toEqual(['B', 'C', 'A']);
    await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).board.columns.map((column) => column.id), storageKey))
      .toEqual(['col_b', 'col_c', 'col_a']);
    await page.reload();
    await expect.poll(() => page.locator('.column-title').evaluateAll((inputs) => inputs.map((input) => input.value))).toEqual(['B', 'C', 'A']);
  });
}

test('a short column handle click never reorders columns', async ({ page }) => {
  await seedState(page, makeMinimalState());
  const original = await page.evaluate(() => window.__PETA_BOARD_TEST__.getState());
  await page.locator('.column-handle').first().click();
  expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.getState())).toEqual(original);
});

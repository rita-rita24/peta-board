import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, seedState } from '../helpers/peta-page.mjs';

test('high-speed note drag uses the release point under monkeyed pointer paths', async ({ page }) => {
  const baseState = makeMinimalState({
    columns: [
      {
        id: 'col_a',
        title: 'A',
        notes: [makeNote({ id: 'note_fast', title: 'Fast note' })]
      },
      {
        id: 'col_b',
        title: 'B',
        notes: [makeNote({ id: 'note_anchor', title: 'Anchor note' })]
      },
      {
        id: 'col_c',
        title: 'C',
        notes: []
      }
    ]
  });

  await seedState(page, baseState);

  const result = await page.evaluate((state) => {
    let seed = 0x5eed1234;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const cloneState = () => JSON.parse(JSON.stringify(state));
    const pointInRect = (rect, insetX, insetY) => ({
      x: rect.left + insetX + random() * Math.max(1, rect.width - insetX * 2),
      y: rect.top + insetY + random() * Math.max(1, rect.height - insetY * 2)
    });
    const centerOf = (rect) => ({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    });
    const firePointer = (target, type, point, buttons) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 4921,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons,
      clientX: point.x,
      clientY: point.y
    }));

    const failures = [];
    for (let iteration = 0; iteration < 40; iteration += 1) {
      window.__PETA_BOARD_TEST__.setState(cloneState());

      const card = document.querySelector('[data-note-id="note_fast"]');
      const targetColumn = document.querySelector('[data-column-id="col_c"]');
      const targetList = targetColumn.querySelector('.note-list');
      const cardRect = card.getBoundingClientRect();
      const columnRect = targetColumn.getBoundingClientRect();
      const listRect = targetList.getBoundingClientRect();
      const start = centerOf(cardRect);
      const missedMove = {
        x: Math.min(window.innerWidth - 8, columnRect.right + 24 + random() * 160),
        y: Math.max(8, columnRect.top + 12 + random() * 120)
      };
      const release = pointInRect(listRect, 16, 16);

      firePointer(card, 'pointerdown', start, 1);
      firePointer(card, 'pointermove', missedMove, 1);
      firePointer(card, 'pointerup', release, 0);

      const columns = window.__PETA_BOARD_TEST__.getState().board.columns.map((column) => ({
        id: column.id,
        notes: column.notes.map((note) => note.id)
      }));
      if (!columns.find((column) => column.id === 'col_c')?.notes.includes('note_fast')) {
        failures.push({ iteration, start, missedMove, release, columns });
      }
    }

    return { failures };
  }, baseState);

  expect(result.failures).toEqual([]);
});

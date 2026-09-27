import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, seedState, storageKey } from '../helpers/peta-page.mjs';

async function save(page) {
  expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }))).toBe(true);
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
}

async function deleteNote(page, id) {
  await page.locator(`[data-note-id="${id}"]`).click();
  await page.locator('#delete-note-btn').click();
  await page.locator('#confirm-ok-btn').click();
  await expect(page.locator('#note-drawer')).toBeHidden();
}

async function deleteColumn(page, id) {
  await page.locator(`[data-column-id="${id}"].column`).getByRole('button', { name: '列を削除' }).click();
  await page.locator('#confirm-ok-btn').click();
}

test('the last column can be deleted, saved, reloaded, imported and replaced with a new column', async ({ page }) => {
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_last', title: '最後の列', notes: [] }] }));
  await deleteColumn(page, 'col_last');
  await expect(page.locator('.column')).toHaveCount(0);
  const empty = await save(page);
  expect(empty.board.columns).toEqual([]);
  await page.reload();
  await expect(page.locator('.add-column-panel')).toBeVisible();
  await expect(page.locator('.column')).toHaveCount(0);
  expect(await save(page)).toEqual(empty);
  await page.locator('.add-column-panel button').click();
  await expect(page.locator('.column')).toHaveCount(1);
  await save(page);
  await page.setInputFiles('#import-board-file', {
    name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(empty))
  });
  await page.locator('#confirm-ok-btn').click();
  await expect(page.locator('.column')).toHaveCount(0);
  await expect(page.locator('#toast')).toHaveText('ボードを読み込みました');
  await page.reload();
  await expect(page.locator('.column')).toHaveCount(0);
  await expect(page.locator('.add-column-panel')).toBeVisible();
});

test('undoing the last column restores every note and its metadata durably', async ({ page }) => {
  const original = makeMinimalState({ columns: [{ id: 'col_last', title: '最後の列', notes: [
    makeNote({ id: 'note_rich', title: '残したい付箋', body: '本文', color: 'blue', tags: ['重要'], dueDate: '2026-09-30',
      checklist: [{ id: 'check_done', text: '確認済み', done: true }] })
  ] }] });
  await seedState(page, original);
  await deleteColumn(page, 'col_last');
  await expect(page.locator('#deletion-undo')).toContainText('最後の列');
  await page.locator('#deletion-undo-btn').click();
  expect((await save(page)).board.columns).toEqual(original.board.columns);
  await page.reload();
  await expect(page.locator('.note-title')).toHaveText('残したい付箋');
  expect((await save(page)).board.columns).toEqual(original.board.columns);
});

test('consecutive note deletions undo in order without reverting edits to surviving notes', async ({ page }) => {
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_work', title: '作業', notes: [
    makeNote({ id: 'note_a', title: 'A' }), makeNote({ id: 'note_b', title: 'B' }), makeNote({ id: 'note_c', title: 'C' })
  ] }] }));
  await deleteNote(page, 'note_b');
  await deleteNote(page, 'note_a');
  await page.locator('[data-note-id="note_c"]').click();
  await page.locator('#note-body-input').fill('削除後の編集も保持する');
  await page.locator('#close-drawer-btn').click();
  await page.locator('#deletion-undo-btn').click();
  await expect(page.locator('.note-title')).toHaveText(['A', 'C']);
  await page.locator('#deletion-undo-btn').click();
  await expect(page.locator('.note-title')).toHaveText(['A', 'B', 'C']);
  const saved = await save(page);
  expect(saved.board.columns[0].notes[2].body).toBe('削除後の編集も保持する');
  await expect(page.locator('#deletion-undo')).toBeHidden();
});

test('a deleted note and its subsequently deleted parent column can both be restored', async ({ page }) => {
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_work', title: '作業', notes: [
    makeNote({ id: 'note_a', title: 'A' }), makeNote({ id: 'note_b', title: 'B' })
  ] }] }));
  await deleteNote(page, 'note_a');
  await deleteColumn(page, 'col_work');
  await page.locator('#deletion-undo-btn').click();
  await expect(page.locator('.note-title')).toHaveText(['B']);
  await page.locator('#deletion-undo-btn').click();
  await expect(page.locator('.note-title')).toHaveText(['A', 'B']);
  expect((await save(page)).board.columns[0].notes.map((note) => note.id)).toEqual(['note_a', 'note_b']);
});

test('consecutive checklist deletions can be undone after closing the editor', async ({ page }) => {
  const checklist = [{ id: 'check_a', text: 'A', done: true }, { id: 'check_b', text: 'B', done: false }];
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_work', title: '作業', notes: [
    makeNote({ id: 'note_a', title: '手順', checklist })
  ] }] }));
  await page.locator('.note-card').click();
  await page.locator('[data-check-id="check_a"]').getByRole('button', { name: '項目を削除' }).click();
  await page.locator('[data-check-id="check_b"]').getByRole('button', { name: '項目を削除' }).click();
  await page.locator('#close-drawer-btn').click();
  await page.locator('#deletion-undo-btn').click();
  await page.locator('.note-card').click();
  await page.locator('#checklist-undo-btn').click();
  expect((await save(page)).board.columns[0].notes[0].checklist).toEqual(checklist);
});

test('the deletion grace period expires after thirty seconds', async ({ page }) => {
  await page.clock.install();
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_work', title: '作業', notes: [makeNote({ id: 'note_a', title: '削除対象' })] }] }));
  await deleteNote(page, 'note_a');
  await page.clock.runFor(29000);
  await expect(page.locator('#deletion-undo')).toBeVisible();
  await page.clock.runFor(1100);
  await expect(page.locator('#deletion-undo')).toBeHidden();
  expect((await save(page)).board.columns[0].notes).toEqual([]);
});

test('undo restores a deleted checklist item even when its empty new draft was dismissed', async ({ page }) => {
  await seedState(page, makeMinimalState());
  await page.locator('.add-note-btn').first().click();
  await page.locator('#add-check-btn').click();
  await page.locator('#checklist input[type="text"]').fill('唯一の内容');
  await page.locator('#checklist').getByRole('button', { name: '項目を削除' }).click();
  await page.locator('#close-drawer-btn').click();
  await expect(page.locator('.note-card')).toHaveCount(0);
  await page.locator('#deletion-undo-btn').click();
  await expect(page.locator('.note-card')).toHaveCount(1);
  expect((await save(page)).board.columns[0].notes[0].checklist[0].text).toBe('唯一の内容');
});

test('importing or resetting the board clears undo actions belonging to the previous board', async ({ page }) => {
  for (const action of ['import', 'reset']) {
    await seedState(page, makeMinimalState({ columns: [{ id: 'col_old', title: '旧ボード', notes: [makeNote({ id: 'note_old', title: '古い付箋' })] }] }));
    await deleteNote(page, 'note_old');
    if (action === 'import') {
      await page.setInputFiles('#import-board-file', {
        name: 'new.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(makeMinimalState()))
      });
    } else {
      await page.locator('#settings-btn').click();
      await page.locator('#reset-board-btn').click();
    }
    await page.locator('#confirm-ok-btn').click();
    await expect(page.locator('#deletion-undo')).toBeHidden();
    expect((await save(page)).board.columns.some((column) => column.id === 'col_old')).toBe(false);
  }
});

test('undo never exceeds the checklist limit or discards a newly added item', async ({ page }) => {
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_work', title: '作業', notes: [makeNote({ id: 'note_a', title: '手順',
    checklist: Array.from({ length: 30 }, (_, index) => ({ id: `check_${index}`, text: `項目${index}`, done: false }))
  })] }] }));
  await page.locator('.note-card').click();
  await page.locator('[data-check-id="check_0"]').getByRole('button', { name: '項目を削除' }).click();
  await page.locator('#add-check-btn').click();
  await page.locator('#checklist input[type="text"]').last().fill('新しい項目');
  await page.locator('#checklist-undo-btn').click();
  await expect(page.locator('#toast')).toHaveText('チェック項目は30件までです');
  const checklist = (await save(page)).board.columns[0].notes[0].checklist;
  expect(checklist).toHaveLength(30);
  expect(checklist.at(-1).text).toBe('新しい項目');
  expect(checklist.some((item) => item.id === 'check_0')).toBe(false);
});

test('checklist undo stays visible beside add on a small phone without scrolling the editor', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_work', title: '作業', notes: [makeNote({ title: '手順',
    checklist: [{ id: 'check_1', text: '誤って削除した項目', done: true }]
  })] }] }));
  await page.locator('.note-card').click();
  await page.locator('#checklist').getByRole('button', { name: '項目を削除' }).click();
  await expect(page.locator('#checklist-undo-btn')).toBeInViewport();
  await expect(page.locator('#add-check-btn')).toBeInViewport();
  const overflow = await page.locator('.drawer-body').evaluate((element) => ({
    vertical: element.scrollHeight - element.clientHeight, horizontal: element.scrollWidth - element.clientWidth, top: element.scrollTop
  }));
  expect(overflow.vertical).toBeLessThanOrEqual(1);
  expect(overflow.horizontal).toBeLessThanOrEqual(1);
  expect(overflow.top).toBe(0);
  await page.locator('#checklist-undo-btn').click();
  await expect(page.locator('[data-check-id="check_1"] input[type="checkbox"]')).toBeChecked();
});

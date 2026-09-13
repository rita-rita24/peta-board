import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, seedState, storageKey } from '../helpers/peta-page.mjs';

async function prepareBoard(page) {
  await seedState(page, makeMinimalState({
    columns: [
      { id: 'col_inbox', title: '受信箱', notes: [makeNote({ id: 'note_keyboard', title: 'キーボードで操作' })] },
      { id: 'col_work', title: '進行中', notes: [] },
      { id: 'col_done', title: '完了', notes: [] }
    ]
  }));
}

async function openNoteWithKeyboard(page) {
  await page.locator('[data-note-id="note_keyboard"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#note-title-input')).toBeFocused();
}

test('editing a note restores focus to its replacement card when the dialog closes', async ({ page }) => {
  await prepareBoard(page);
  await openNoteWithKeyboard(page);
  await page.locator('#note-title-input').fill('更新した付箋');
  await page.keyboard.press('Escape');
  await expect(page.locator('#note-drawer')).toBeHidden();
  await expect(page.locator('[data-note-id="note_keyboard"]')).toBeFocused();
  await expect(page.locator('.app-shell')).not.toHaveAttribute('inert', '');
});

test('column movement keeps keyboard focus on the moved column', async ({ page }) => {
  await prepareBoard(page);
  await page.locator('.column[data-column-id="col_inbox"]').getByRole('button', { name: '右へ移動' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.column').nth(1)).toHaveAttribute('data-column-id', 'col_inbox');
  await expect(page.locator('.column[data-column-id="col_inbox"]').getByRole('button', { name: '右へ移動' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.column').nth(2)).toHaveAttribute('data-column-id', 'col_inbox');
  await expect(page.locator('.column[data-column-id="col_inbox"] .column-title')).toBeFocused();
});

test('calendar Tab reaches today and clear and stays within the active dialog', async ({ page }) => {
  await prepareBoard(page);
  await openNoteWithKeyboard(page);
  await page.locator('#note-due-input').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.date-day[tabindex="0"]')).toBeFocused();
  await expect(page.locator('#note-drawer')).toHaveAttribute('inert', '');
  await page.keyboard.press('Tab');
  await expect(page.locator('#date-today-btn')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#date-clear-btn')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#date-prev-month-btn')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#date-clear-btn')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#date-popover')).toBeHidden();
  await expect(page.locator('#note-due-input')).toBeFocused();
  await expect(page.locator('#note-drawer')).not.toHaveAttribute('inert', '');
});

test('note column selection moves the note, keeps focus, and persists after reload', async ({ page }) => {
  await prepareBoard(page);
  await openNoteWithKeyboard(page);
  const destination = page.getByLabel('移動先の列');
  await expect(destination).toHaveValue('col_inbox');
  await destination.focus();
  await destination.selectOption('col_done');
  await expect(destination).toBeFocused();
  await expect(page.locator('#drawer-subtitle')).toHaveText('完了');
  await expect(page.locator('.column[data-column-id="col_done"] [data-note-id="note_keyboard"]')).toHaveCount(1);
  await page.waitForFunction((key) => {
    const board = JSON.parse(localStorage.getItem(key)).board;
    return board.columns.find((column) => column.id === 'col_done').notes.some((note) => note.id === 'note_keyboard');
  }, storageKey);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-note-id="note_keyboard"]')).toBeFocused();
  await page.reload();
  await openNoteWithKeyboard(page);
  await expect(page.getByLabel('移動先の列')).toHaveValue('col_done');
});

test('nested confirmation isolates background controls and returns to the note dialog', async ({ page }) => {
  await prepareBoard(page);
  await openNoteWithKeyboard(page);
  await expect(page.locator('.app-shell')).toHaveAttribute('inert', '');
  await page.locator('#delete-note-btn').click();
  await expect(page.locator('#confirm-cancel-btn')).toBeFocused();
  await expect(page.locator('#note-drawer')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('#delete-note-btn')).toBeFocused();
  await expect(page.locator('#note-drawer')).not.toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-note-id="note_keyboard"]')).toBeFocused();
});

test('color selection exposes its state and retains keyboard focus in both dialogs', async ({ page }) => {
  await prepareBoard(page);
  await openNoteWithKeyboard(page);
  const blue = page.locator('#note-color-grid').getByRole('button', { name: '青', exact: true });
  await blue.focus();
  await page.keyboard.press('Enter');
  await expect(blue).toBeFocused();
  await expect(blue).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#note-color-grid [aria-pressed="true"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#note-drawer')).toBeHidden();
  await page.locator('#settings-btn').click();
  await expect(page.locator('#close-settings-btn')).toBeFocused();
  const yellow = page.locator('#default-color-grid').getByRole('button', { name: '付箋の初期色: 黄', exact: true });
  await yellow.focus();
  await page.keyboard.press('Enter');
  await expect(yellow).toBeFocused();
  await expect(yellow).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#default-color-grid [aria-pressed="true"]')).toHaveCount(1);
});

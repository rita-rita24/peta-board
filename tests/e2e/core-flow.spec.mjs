import { expect, test } from '@playwright/test';
import {
  corruptBackupKey,
  loadWithStoredText,
  makeMinimalState,
  makeNote,
  openApp,
  seedState,
  storageKey,
  waitForSavedNote
} from '../helpers/peta-page.mjs';

async function readSavedState(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
}

async function waitForSavedNoteTitles(page, { present = [], absent = [] }) {
  await page.waitForFunction(
    ({ key, presentTitles, absentTitles }) => {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (!saved) return false;
      const titles = saved.board.columns.flatMap((column) => column.notes || []).map((note) => note.title);
      return presentTitles.every((title) => titles.includes(title))
        && absentTitles.every((title) => !titles.includes(title));
    },
    { key: storageKey, presentTitles: present, absentTitles: absent }
  );
}

async function openSettings(page) {
  await page.getByRole('button', { name: '設定' }).click();
  await expect(page.locator('#settings-modal')).toBeVisible();
}

test('default board starts with memo task and later columns', async ({ page }) => {
  await openApp(page);

  const titles = await page.locator('.column-title').evaluateAll((inputs) => inputs.map((input) => input.value));
  expect(titles).toEqual(['メモ', 'タスク', 'あとで']);
});

test('user can create a note and the note persists after reload', async ({ page }) => {
  await openApp(page);

  await page.locator('.column').first().locator('.column-footer').getByRole('button', { name: '付箋を追加' }).click();
  await expect(page.locator('#note-drawer')).toBeVisible();
  await page.locator('#note-title-input').fill('永続化される付箋');
  await page.locator('#note-body-input').fill('リロード後も残る本文');
  await page.locator('#close-drawer-btn').click();

  await expect(page.locator('.note-title', { hasText: '永続化される付箋' })).toBeVisible();
  await waitForSavedNote(page, '永続化される付箋');

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.board.columns.flatMap((column) => column.notes).some((note) => note.title === '永続化される付箋')).toBe(true);

  await page.reload();
  await expect(page.locator('.note-title', { hasText: '永続化される付箋' })).toBeVisible();
});

test('malicious note text remains text when rendered in cards and drawer', async ({ page }) => {
  await openApp(page);

  const payload = '<img src=x onerror="window.__xss=1">';
  await page.locator('.column').first().locator('.column-footer').getByRole('button', { name: '付箋を追加' }).click();
  await page.locator('#note-title-input').fill(payload);
  await page.locator('#note-body-input').fill(payload);
  await page.locator('#close-drawer-btn').click();

  await expect(page.locator('.note-title', { hasText: payload })).toBeVisible();
  await page.locator('.note-card', { hasText: payload }).click();
  await expect(page.locator('#note-title-input')).toHaveValue(payload);
  await expect(page.locator('#note-body-input')).toHaveValue(payload);

  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator('.note-title img, .note-body img, #note-drawer img').count()).toBe(0);
});

test('lossy stored JSON is normalized for rendering and backed up on startup', async ({ page }) => {
  await openApp(page);
  const limits = await page.evaluate(() => window.__PETA_BOARD_TEST__.LIMITS);
  await page.goto('about:blank');

  const payload = '<img src=x onerror="window.__xss=1">';
  const unsafeState = {
    version: 1,
    theme: 'light',
    board: {
      title: 'Unsafe Board'.padEnd(limits.boardTitle + 8, 'B'),
      columns: [
        {
          id: 'col"]><img src=x onerror="window.__xss=1">',
          title: 'Unsafe List'.padEnd(limits.columnTitle + 8, 'C'),
          notes: [
            {
              id: 'note"] onclick="window.__xss=1',
              title: payload,
              body: '本文'.padEnd(limits.noteBody + 8, 'D'),
              tags: Array.from({ length: limits.tags + 1 }, (_, index) => `tag-${index}`.padEnd(limits.tag + 4, 'T')),
              dueDate: '2024-02-31',
              checklist: Array.from({ length: limits.checklistItems + 1 }, (_, index) => ({
                id: index === 0 ? 'check bad"' : `check_${index}`,
                text: `確認${index}`.padEnd(limits.checklistText + 4, 'K'),
                done: true
              }))
            }
          ]
        },
        {
          id: 'col"]><img src=x onerror="window.__xss=1">',
          title: 'Duplicate List',
          notes: [
            {
              id: 'note"] onclick="window.__xss=1',
              title: '重複ID',
              dueDate: 'not-a-date',
              checklist: []
            }
          ]
        }
      ]
    }
  };
  const storedText = JSON.stringify(unsafeState);

  await loadWithStoredText(page, storedText);

  await expect(page.locator('.note-title', { hasText: payload })).toBeVisible();
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();

  const stored = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  const backup = await page.evaluate((key) => localStorage.getItem(key), corruptBackupKey);
  const rendered = await page.evaluate(() => window.__PETA_BOARD_TEST__.getState());
  const ids = rendered.board.columns.flatMap((column) => [
    column.id,
    ...column.notes.flatMap((note) => [note.id, ...note.checklist.map((item) => item.id)])
  ]);
  const notes = rendered.board.columns.flatMap((column) => column.notes);
  const dates = notes.map((note) => note.dueDate);

  expect(stored).toBe(storedText);
  expect(backup).toBe(storedText);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.every((id) => /^[A-Za-z0-9_-]{1,96}$/.test(id))).toBe(true);
  expect(dates).toEqual(['', '']);
  expect(rendered.board.title).toHaveLength(limits.boardTitle);
  expect(rendered.board.columns[0].title).toHaveLength(limits.columnTitle);
  expect(notes[0].body).toHaveLength(limits.noteBody);
  expect(notes[0].tags).toHaveLength(limits.tags);
  expect(notes[0].tags.every((tag) => tag.length === limits.tag)).toBe(true);
  expect(notes[0].checklist).toHaveLength(limits.checklistItems);
  expect(notes[0].checklist.every((item) => item.text.length === limits.checklistText)).toBe(true);
});

test('reset query parameter does not erase existing board data', async ({ page }) => {
  const state = makeMinimalState({
    columns: [
      {
        id: 'col_todo',
        title: 'Todo',
        notes: [makeNote({ id: 'note_keep', title: '消えてはいけない付箋' })]
      }
    ]
  });
  await seedState(page, state);

  await openApp(page, '?reset=1');

  await expect(page.locator('.note-title', { hasText: '消えてはいけない付箋' })).toBeVisible();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.board.columns.flatMap((column) => column.notes).map((note) => note.title)).toContain('消えてはいけない付箋');
});

test('corrupt localStorage is backed up and not overwritten on startup', async ({ page }) => {
  await loadWithStoredText(page, '{"board":');

  await expect(page.locator('.column-title')).toHaveCount(3);
  const stored = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  const backup = await page.evaluate((key) => localStorage.getItem(key), corruptBackupKey);

  expect(stored).toBe('{"board":');
  expect(backup).toBe('{"board":');
});

test('non-board stored JSON is backed up and not overwritten on startup', async ({ page }) => {
  const storedText = JSON.stringify({ unrelated: true });
  await loadWithStoredText(page, storedText);

  await expect(page.locator('.column-title')).toHaveCount(3);
  const stored = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  const backup = await page.evaluate((key) => localStorage.getItem(key), corruptBackupKey);

  expect(stored).toBe(storedText);
  expect(backup).toBe(storedText);
});

test('over-limit stored board is backed up without saving the trimmed state on startup', async ({ page }) => {
  await openApp(page);
  const limits = await page.evaluate(() => window.__PETA_BOARD_TEST__.LIMITS);
  await page.goto('about:blank');

  const storedState = makeMinimalState({
    columns: [
      {
        id: 'col_full',
        title: 'Full',
        notes: Array.from({ length: limits.notes + 1 }, (_, index) => makeNote({
          id: `note_${index}`,
          title: `保存済み付箋${index}`
        }))
      }
    ]
  });
  const storedText = JSON.stringify(storedState);

  await loadWithStoredText(page, storedText);

  await expect(page.locator('.note-card')).toHaveCount(limits.notes);
  const stored = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  const backup = await page.evaluate((key) => localStorage.getItem(key), corruptBackupKey);

  expect(stored).toBe(storedText);
  expect(backup).toBe(storedText);
});

test('stored checklist completion coercion is backed up instead of overwritten on startup', async ({ page }) => {
  const storedState = makeMinimalState({
    columns: [
      {
        id: 'col_checklist',
        title: 'Checklist',
        notes: [
          makeNote({
            id: 'note_checklist',
            title: '完了状態の退避',
            checklist: [{ id: 'check_done', text: '完了済み項目', done: 'true' }]
          })
        ]
      }
    ]
  });
  const storedText = JSON.stringify(storedState);

  await loadWithStoredText(page, storedText);

  await expect(page.locator('.note-title', { hasText: '完了状態の退避' })).toBeVisible();
  const stored = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  const backup = await page.evaluate((key) => localStorage.getItem(key), corruptBackupKey);

  expect(stored).toBe(storedText);
  expect(backup).toBe(storedText);
});

test('import rejects non-board JSON before replacement confirmation', async ({ page }) => {
  const existing = makeMinimalState({
    columns: [
      {
        id: 'col_keep',
        title: 'Keep',
        notes: [makeNote({ id: 'note_keep', title: '残す付箋' })]
      }
    ]
  });
  await seedState(page, existing);

  await page.setInputFiles('#import-board-file', {
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ unrelated: true }))
  });

  await expect(page.locator('#toast')).toHaveText('PetaBoardのJSON形式ではありません');
  await expect(page.locator('#confirm-modal')).toBeHidden();
  await expect(page.locator('.note-title', { hasText: '残す付箋' })).toBeVisible();

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.board.columns.flatMap((column) => column.notes).map((note) => note.title)).toContain('残す付箋');
});

test('successful import saves the replacement board and survives reload', async ({ page }) => {
  const existing = makeMinimalState({
    columns: [
      {
        id: 'col_keep',
        title: 'Keep',
        notes: [makeNote({ id: 'note_old', title: '置換前の付箋' })]
      }
    ]
  });
  const imported = makeMinimalState({
    title: '読み込み後ボード',
    columns: [
      {
        id: 'col_imported',
        title: 'Imported',
        notes: [makeNote({ id: 'note_imported', title: '読み込まれた付箋' })]
      }
    ]
  });
  await seedState(page, existing);

  await page.setInputFiles('#import-board-file', {
    name: 'peta-board.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported))
  });
  await expect(page.locator('#confirm-modal')).toBeVisible();
  await page.locator('#confirm-ok-btn').click();

  await expect(page.locator('.note-title', { hasText: '読み込まれた付箋' })).toBeVisible();
  await expect(page.locator('.note-title', { hasText: '置換前の付箋' })).toHaveCount(0);
  await waitForSavedNoteTitles(page, { present: ['読み込まれた付箋'], absent: ['置換前の付箋'] });

  const saved = await readSavedState(page);
  expect(saved.board.title).toBe('読み込み後ボード');
  expect(saved.board.columns[0].title).toBe('Imported');

  await page.reload();
  await expect(page.locator('.note-title', { hasText: '読み込まれた付箋' })).toBeVisible();
  await expect(page.locator('.note-title', { hasText: '置換前の付箋' })).toHaveCount(0);
});

test('cancelled import keeps the current board and saved state unchanged', async ({ page }) => {
  const existing = makeMinimalState({
    columns: [
      {
        id: 'col_keep',
        title: 'Keep',
        notes: [makeNote({ id: 'note_keep', title: 'キャンセル後も残る付箋' })]
      }
    ]
  });
  const imported = makeMinimalState({
    title: 'キャンセルされたボード',
    columns: [
      {
        id: 'col_imported',
        title: 'Imported',
        notes: [makeNote({ id: 'note_imported', title: '表示されてはいけない付箋' })]
      }
    ]
  });
  await seedState(page, existing);

  await page.setInputFiles('#import-board-file', {
    name: 'cancelled-peta-board.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported))
  });
  await expect(page.locator('#confirm-modal')).toBeVisible();
  await page.locator('#confirm-cancel-btn').click();

  await expect(page.locator('.note-title', { hasText: 'キャンセル後も残る付箋' })).toBeVisible();
  await expect(page.locator('.note-title', { hasText: '表示されてはいけない付箋' })).toHaveCount(0);
  await waitForSavedNoteTitles(page, { present: ['キャンセル後も残る付箋'], absent: ['表示されてはいけない付箋'] });

  const saved = await readSavedState(page);
  expect(saved.board.title).toBe(existing.board.title);
  expect(saved.board.columns[0].title).toBe('Keep');
});

test('reset cancel preserves data and reset ok saves the default board', async ({ page }) => {
  const existing = makeMinimalState({
    columns: [
      {
        id: 'col_keep',
        title: 'Keep',
        notes: [makeNote({ id: 'note_keep', title: '初期化前の付箋' })]
      }
    ]
  });
  await seedState(page, existing);

  await openSettings(page);
  await page.locator('#reset-board-btn').click();
  await expect(page.locator('#confirm-modal')).toBeVisible();
  await page.locator('#confirm-cancel-btn').click();
  await expect(page.locator('#confirm-modal')).toBeHidden();

  await expect(page.locator('.note-title', { hasText: '初期化前の付箋' })).toBeVisible();
  await waitForSavedNoteTitles(page, { present: ['初期化前の付箋'] });

  await page.reload();
  await expect(page.locator('.note-title', { hasText: '初期化前の付箋' })).toBeVisible();

  await openSettings(page);
  await page.locator('#reset-board-btn').click();
  await expect(page.locator('#confirm-modal')).toBeVisible();
  await page.locator('#confirm-ok-btn').click();

  await expect(page.locator('.column-title')).toHaveCount(3);
  const titles = await page.locator('.column-title').evaluateAll((inputs) => inputs.map((input) => input.value));
  expect(titles).toEqual(['メモ', 'タスク', 'あとで']);
  await waitForSavedNoteTitles(page, { absent: ['初期化前の付箋'] });

  const saved = await readSavedState(page);
  expect(saved.board.columns.flatMap((column) => column.notes)).toHaveLength(0);

  await page.reload();
  await expect(page.locator('.column-title')).toHaveCount(3);
  await expect(page.locator('.note-title', { hasText: '初期化前の付箋' })).toHaveCount(0);
});

test('confirmed column delete is saved and stays deleted after reload', async ({ page }) => {
  const existing = makeMinimalState({
    columns: [
      {
        id: 'col_keep',
        title: '残す列',
        notes: [makeNote({ id: 'note_keep', title: '残る付箋' })]
      },
      {
        id: 'col_delete',
        title: '削除する列',
        notes: [makeNote({ id: 'note_delete', title: '列ごと削除される付箋' })]
      }
    ]
  });
  await seedState(page, existing);

  await page.locator('.column').nth(1).getByRole('button', { name: '列を削除' }).click();
  await expect(page.locator('#confirm-modal')).toBeVisible();
  await page.locator('#confirm-ok-btn').click();

  await expect(page.locator('.note-title', { hasText: '列ごと削除される付箋' })).toHaveCount(0);
  await waitForSavedNoteTitles(page, { present: ['残る付箋'], absent: ['列ごと削除される付箋'] });

  const saved = await readSavedState(page);
  expect(saved.board.columns.map((column) => column.title)).toEqual(['残す列']);

  await page.reload();
  await expect(page.locator('.note-title', { hasText: '残る付箋' })).toBeVisible();
  await expect(page.locator('.note-title', { hasText: '列ごと削除される付箋' })).toHaveCount(0);
});

test('confirmed note delete is saved and stays deleted after reload', async ({ page }) => {
  const existing = makeMinimalState({
    columns: [
      {
        id: 'col_notes',
        title: 'Notes',
        notes: [
          makeNote({ id: 'note_keep', title: '残す付箋' }),
          makeNote({ id: 'note_delete', title: '削除する付箋' })
        ]
      }
    ]
  });
  await seedState(page, existing);

  await page.locator('.note-card', { hasText: '削除する付箋' }).click();
  await expect(page.locator('#note-drawer')).toBeVisible();
  await page.locator('#delete-note-btn').click();
  await expect(page.locator('#confirm-modal')).toBeVisible();
  await page.locator('#confirm-ok-btn').click();

  await expect(page.locator('.note-title', { hasText: '削除する付箋' })).toHaveCount(0);
  await waitForSavedNoteTitles(page, { present: ['残す付箋'], absent: ['削除する付箋'] });

  const saved = await readSavedState(page);
  expect(saved.board.columns[0].notes.map((note) => note.title)).toEqual(['残す付箋']);

  await page.reload();
  await expect(page.locator('.note-title', { hasText: '残す付箋' })).toBeVisible();
  await expect(page.locator('.note-title', { hasText: '削除する付箋' })).toHaveCount(0);
});

test('checklist controls stay usable when moving focus from a checklist text input', async ({ page }) => {
  const existing = makeMinimalState({
    columns: [
      {
        id: 'col_checks',
        title: 'Checks',
        notes: [
          makeNote({
            id: 'note_checks',
            title: 'チェックリスト操作',
            checklist: [
              { id: 'check_first', text: '最初の項目', done: false },
              { id: 'check_second', text: '次の項目', done: false }
            ]
          })
        ]
      }
    ]
  });
  await seedState(page, existing);

  await page.locator('.note-card', { hasText: 'チェックリスト操作' }).click();
  await expect(page.locator('#note-drawer')).toBeVisible();
  await expect(page.locator('#note-title-input')).toBeFocused();
  const checklistInputs = page.locator('#checklist input[aria-label="チェック項目"]');
  await expect(checklistInputs).toHaveCount(2);

  await checklistInputs.first().focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#checklist').getByRole('button', { name: '項目を削除' }).first()).toBeFocused();

  await page.locator('#checklist').getByRole('button', { name: '項目を削除' }).first().click();

  await expect(checklistInputs).toHaveCount(1);
  await expect(checklistInputs.first()).toHaveValue('次の項目');
});

test('keyboard-opened note drawer moves focus inside and restores it on close', async ({ page }) => {
  const existing = makeMinimalState({
    columns: [
      {
        id: 'col_focus',
        title: 'Focus',
        notes: [makeNote({ id: 'note_focus', title: 'フォーカス確認' })]
      }
    ]
  });
  await seedState(page, existing);

  const card = page.locator('.note-card', { hasText: 'フォーカス確認' });
  await card.focus();
  await page.keyboard.press('Enter');

  await expect(page.locator('#note-drawer')).toBeVisible();
  await expect(page.locator('#note-title-input')).toBeFocused();

  await page.keyboard.press('Escape');

  await expect(page.locator('#note-drawer')).toBeHidden();
  await expect(card).toBeFocused();
});

test('settings and confirm dialogs trap Tab focus inside the topmost modal', async ({ page }) => {
  await openApp(page);

  await page.getByRole('button', { name: '設定' }).click();
  await expect(page.locator('#close-settings-btn')).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#settings-done-btn')).toBeFocused();

  await page.locator('#reset-board-btn').click();
  await expect(page.locator('#confirm-modal')).toBeVisible();
  await expect(page.locator('#confirm-cancel-btn')).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#confirm-ok-btn')).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(page.locator('#confirm-cancel-btn')).toBeFocused();
});

test('manual add and duplicate controls stop at board count limits', async ({ page }) => {
  await openApp(page);
  const limits = await page.evaluate(() => window.__PETA_BOARD_TEST__.LIMITS);
  const fullColumns = makeMinimalState({
    columns: Array.from({ length: limits.columns }, (_, index) => ({
      id: `col_${index}`,
      title: `列${index}`,
      notes: []
    }))
  });
  await seedState(page, fullColumns);

  await expect(page.locator('.add-column-panel').getByRole('button', { name: '列を追加' })).toBeDisabled();
  expect(await page.locator('.column').count()).toBe(limits.columns);

  const fullNotes = makeMinimalState({
    columns: [
      {
        id: 'col_full',
        title: 'Full',
        notes: Array.from({ length: limits.notes }, (_, index) => makeNote({
          id: `note_${index}`,
          title: `付箋${index}`
        }))
      }
    ]
  });
  await seedState(page, fullNotes);

  await expect(page.locator('.column-footer').getByRole('button', { name: '付箋を追加' })).toBeDisabled();
  await page.locator('.note-card').first().click();
  await expect(page.locator('#duplicate-note-btn')).toBeDisabled();
});

test('theme toggle updates the current state model', async ({ page }) => {
  await openApp(page);

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'テーマ切替' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) || '{}').theme === 'dark', storageKey);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(saved.theme).toBe('dark');
  expect(saved.board).not.toHaveProperty('background');
});

test('search results update immediately when a matching column title is edited', async ({ page }) => {
  const existing = makeMinimalState({
    columns: [
      {
        id: 'col_target',
        title: '未分類',
        notes: [makeNote({ id: 'note_column_match', title: '本文だけでは見つからない付箋' })]
      },
      {
        id: 'col_other',
        title: 'その他',
        notes: [makeNote({ id: 'note_other', title: '別の付箋' })]
      }
    ]
  });
  await seedState(page, existing);

  await page.locator('#search-input').fill('レビュー');
  await expect(page.locator('.note-card')).toHaveCount(0);

  await page.locator('.column-title').first().fill('レビュー対象');

  await expect(page.locator('.note-card', { hasText: '本文だけでは見つからない付箋' })).toBeVisible();
  const counts = await page.locator('.column-count').evaluateAll((items) => items.map((item) => item.textContent));
  expect(counts).toEqual(['1 / 1', '0 / 1']);
});

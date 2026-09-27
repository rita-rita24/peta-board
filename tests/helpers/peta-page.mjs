import { appUrl } from '../../tools/app-path.mjs';

export { appUrl };
export const storageKey = 'petaborad.state.v1';
export const corruptBackupKey = `${storageKey}.corrupt`;

export async function openApp(page, suffix = '') {
  await page.goto(`${appUrl}${suffix}`);
  await page.waitForSelector('#kanban-board');
  await page.waitForSelector('.add-column-panel');
}

export async function seedState(page, state, suffix = '') {
  await openApp(page, suffix);
  await page.evaluate(async (value) => {
    window.__PETA_BOARD_TEST__.setState(value);
    await window.__PETA_BOARD_TEST__.saveStateNow({ showError: false });
  }, state);
  await page.waitForSelector('#kanban-board');
  await page.waitForSelector('.add-column-panel');
}

export async function loadWithStoredState(page, state, suffix = '') {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: storageKey, value: state }
  );
  await openApp(page, suffix);
}

export async function loadWithStoredText(page, text, suffix = '') {
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: storageKey, value: text }
  );
  await openApp(page, suffix);
}

export function makeNote(overrides = {}) {
  const now = Date.now();
  return {
    id: `note_${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    body: '',
    color: 'paper',
    tags: [],
    dueDate: '',
    checklist: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

export function makeMinimalState(overrides = {}) {
  const now = Date.now();
  const columns = overrides.columns || [
    { id: 'col_todo', title: 'Todo', notes: [] },
    { id: 'col_done', title: 'Done', notes: [] }
  ];

  return {
    version: 1,
    theme: 'light',
    settings: {
      defaultColor: 'paper'
    },
    board: {
      title: overrides.title || 'テストボード',
      createdAt: now,
      updatedAt: now,
      columns
    }
  };
}

export async function waitForSavedNote(page, title) {
  await page.waitForFunction(
    ({ key, expected }) => {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      const notes = saved?.board?.columns?.flatMap((column) => column.notes || []) || [];
      return notes.some((note) => note.title === expected);
    },
    { key: storageKey, expected: title }
  );
}

import { expect, test } from '@playwright/test';
import fc from 'fast-check';
import { openApp } from '../helpers/peta-page.mjs';

const safeIdPattern = /^[A-Za-z0-9_-]{1,96}$/;

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('normalizeState sanitizes duplicate IDs and rejects impossible due dates', async ({ page }) => {
  const payload = '<img src=x onerror="window.__xss=1">';
  const result = await page.evaluate((rawState) => window.__PETA_BOARD_TEST__.normalizeState(rawState), {
    version: 1,
    theme: 'dark',
    board: {
      title: 'Unsafe Board',
      columns: [
        {
          id: 'col"] autofocus onfocus="window.__xss=1',
          title: 'Todo',
          notes: [
            {
              id: 'note_same',
              title: payload,
              body: 'body',
              tags: ['important', 'x'.repeat(80)],
              dueDate: '2024-02-31',
              checklist: [
                { id: 'check_same', text: 'Item 1', done: true },
                { id: 'check_same', text: 'Item 2', done: false }
              ]
            },
            {
              id: 'note_same',
              title: 'Duplicate',
              dueDate: 'not-a-date',
              checklist: []
            }
          ]
        },
        {
          id: 'col"] autofocus onfocus="window.__xss=1',
          title: 'Duplicate column',
          notes: []
        }
      ]
    }
  });

  const ids = result.board.columns.flatMap((column) => [
    column.id,
    ...column.notes.flatMap((note) => [
      note.id,
      ...note.checklist.map((item) => item.id)
    ])
  ]);

  expect(result.theme).toBe('dark');
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.every((id) => safeIdPattern.test(id))).toBe(true);
  expect(result.board.columns[0].notes[0].title).toBe(payload);
  expect(result.board.columns[0].notes[0].dueDate).toBe('');
  expect(result.board.columns[0].notes[1].dueDate).toBe('');
  expect(result.board.columns[0].notes[0].tags[1]).toHaveLength(32);
});

test('normalizeState only treats literal true checklist done values as complete', async ({ page }) => {
  const result = await page.evaluate(() => {
    const normalized = window.__PETA_BOARD_TEST__.normalizeState({
      board: {
        columns: [
          {
            title: 'Todo',
            notes: [
              {
                title: 'Checklist',
                checklist: [
                  { id: 'check_true', text: 'boolean true', done: true },
                  { id: 'check_false', text: 'boolean false', done: false },
                  { id: 'check_string_false', text: 'string false', done: 'false' },
                  { id: 'check_one', text: 'number one', done: 1 },
                  { id: 'check_null', text: 'null value', done: null }
                ]
              }
            ]
          }
        ]
      }
    });
    return normalized.board.columns[0].notes[0].checklist.map((item) => ({
      text: item.text,
      done: item.done
    }));
  });

  expect(result).toEqual([
    { text: 'boolean true', done: true },
    { text: 'boolean false', done: false },
    { text: 'string false', done: false },
    { text: 'number one', done: false },
    { text: 'null value', done: false }
  ]);
});

test('stored state reduction detects checklist done values that would lose completion state', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { hasStoredStateReduction, normalizeState } = window.__PETA_BOARD_TEST__;
    const raw = {
      board: {
        columns: [
          {
            id: 'col_done_loss',
            title: 'Todo',
            notes: [
              {
                id: 'note_done_loss',
                title: 'Checklist',
                checklist: [
                  { id: 'check_done_loss', text: '完了済み', done: 'true' }
                ]
              }
            ]
          }
        ]
      }
    };
    const normalized = normalizeState(raw);
    return {
      normalizedDone: normalized.board.columns[0].notes[0].checklist[0].done,
      reduction: hasStoredStateReduction(raw, normalized)
    };
  });

  expect(result).toEqual({
    normalizedDone: false,
    reduction: true
  });
});

test('parseDateValue accepts only real local calendar dates', async ({ page }) => {
  const cases = fc.sample(
    fc.record({
      y: fc.integer({ min: 1990, max: 2035 }),
      m: fc.integer({ min: 1, max: 12 }),
      d: fc.integer({ min: 1, max: 31 })
    }),
    160
  );
  cases.push({ y: 2024, m: 2, d: 29 }, { y: 2023, m: 2, d: 29 }, { y: 2024, m: 2, d: 31 });

  const results = await page.evaluate((items) => items.map(({ y, m, d }) => {
    const value = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const parsed = window.__PETA_BOARD_TEST__.parseDateValue(value);
    return {
      y,
      m,
      d,
      ok: Boolean(parsed),
      normalized: parsed ? window.__PETA_BOARD_TEST__.dateValue(parsed) : ''
    };
  }), cases);

  for (const item of results) {
    const maxDay = new Date(item.y, item.m, 0).getDate();
    if (item.d <= maxDay) {
      expect(item.ok, JSON.stringify(item)).toBe(true);
      expect(item.normalized).toBe(
        `${String(item.y).padStart(4, '0')}-${String(item.m).padStart(2, '0')}-${String(item.d).padStart(2, '0')}`
      );
    } else {
      expect(item.ok, JSON.stringify(item)).toBe(false);
    }
  }
});

test('normalizeState enforces import count and string length limits', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { LIMITS, normalizeState } = window.__PETA_BOARD_TEST__;
    const columns = Array.from({ length: LIMITS.columns + 4 }, (_, columnIndex) => ({
      id: `col_${columnIndex}`,
      title: `列${columnIndex}${'x'.repeat(120)}`,
      notes: Array.from({ length: 80 }, (_, noteIndex) => ({
        id: `note_${columnIndex}_${noteIndex}`,
        title: 't'.repeat(300),
        body: 'b'.repeat(5000),
        tags: Array.from({ length: LIMITS.tags + 4 }, (__, tagIndex) => `tag-${tagIndex}-${'x'.repeat(80)}`),
        dueDate: '2026-06-06',
        checklist: Array.from({ length: LIMITS.checklistItems + 4 }, (__, checkIndex) => ({
          id: `check_${columnIndex}_${noteIndex}_${checkIndex}`,
          text: 'c'.repeat(200),
          done: false
        }))
      }))
    }));
    return { limits: LIMITS, normalized: normalizeState({ board: { title: 'B'.repeat(200), columns } }) };
  });

  const { limits, normalized } = result;
  const notes = normalized.board.columns.flatMap((column) => column.notes);

  expect(normalized.board.title).toHaveLength(limits.boardTitle);
  expect(normalized.board.columns).toHaveLength(limits.columns);
  expect(notes).toHaveLength(limits.notes);
  expect(normalized.board.columns.every((column) => column.title.length <= limits.columnTitle)).toBe(true);
  expect(notes.every((note) => note.title.length <= limits.noteTitle)).toBe(true);
  expect(notes.every((note) => note.body.length <= limits.noteBody)).toBe(true);
  expect(notes.every((note) => note.tags.length <= limits.tags)).toBe(true);
  expect(notes.every((note) => note.tags.every((tag) => tag.length <= limits.tag))).toBe(true);
  expect(notes.every((note) => note.checklist.length <= limits.checklistItems)).toBe(true);
  expect(notes.every((note) => note.checklist.every((item) => item.text.length <= limits.checklistText))).toBe(true);
});

test('import format validation rejects JSON without board columns', async ({ page }) => {
  const results = await page.evaluate(() => {
    const { isImportableBoardState } = window.__PETA_BOARD_TEST__;
    return [
      isImportableBoardState({}),
      isImportableBoardState({ board: {} }),
      isImportableBoardState({ board: { columns: [] } }),
      isImportableBoardState({ board: { columns: [{ title: 'Todo' }] } }),
      isImportableBoardState({ board: { columns: [{ title: 'Todo', notes: [null] }] } }),
      isImportableBoardState({ board: { columns: [{ title: 'Todo', notes: [] }] } }),
      isImportableBoardState({ board: { columns: [{ title: 'Todo', notes: [{ title: 'Note' }] }] } })
    ];
  });

  expect(results).toEqual([false, false, true, false, false, true, true]);
});

test('stored state reduction detects lossy startup normalization only', async ({ page }) => {
  const results = await page.evaluate(() => {
    const { LIMITS, hasStoredStateReduction, normalizeState } = window.__PETA_BOARD_TEST__;
    const base = {
      board: {
        title: 'Board',
        columns: [
          {
            id: 'col_1',
            title: 'Todo',
            notes: [
              {
                id: 'note_1',
                title: 'Title',
                body: 'Body',
                tags: ['tag'],
                dueDate: '2026-06-10',
                checklist: [{ id: 'check_1', text: 'Item', done: true }]
              }
            ]
          }
        ]
      }
    };
    const reduced = (raw) => hasStoredStateReduction(raw, normalizeState(raw));

    return {
      validWithDefaultsAdded: reduced(base),
      nonBoard: reduced({ unrelated: true }),
      longString: reduced({ ...base, board: { ...base.board, title: 'B'.repeat(LIMITS.boardTitle + 1) } }),
      unsafeId: reduced({
        ...base,
        board: {
          ...base.board,
          columns: [{ ...base.board.columns[0], id: 'col bad id' }]
        }
      }),
      tooManyTags: reduced({
        ...base,
        board: {
          ...base.board,
          columns: [{
            ...base.board.columns[0],
            notes: [{
              ...base.board.columns[0].notes[0],
              tags: Array.from({ length: LIMITS.tags + 1 }, (_, index) => `tag-${index}`)
            }]
          }]
        }
      }),
      tooManyChecklistItems: reduced({
        ...base,
        board: {
          ...base.board,
          columns: [{
            ...base.board.columns[0],
            notes: [{
              ...base.board.columns[0].notes[0],
              checklist: Array.from({ length: LIMITS.checklistItems + 1 }, (_, index) => ({
                id: `check_${index}`,
                text: `Item ${index}`,
                done: false
              }))
            }]
          }]
        }
      }),
      invalidDueDate: reduced({
        ...base,
        board: {
          ...base.board,
          columns: [{
            ...base.board.columns[0],
            notes: [{ ...base.board.columns[0].notes[0], dueDate: '2026-02-31' }]
          }]
        }
      })
    };
  });

  expect(results).toEqual({
    validWithDefaultsAdded: false,
    nonBoard: true,
    longString: true,
    unsafeId: true,
    tooManyTags: true,
    tooManyChecklistItems: true,
    invalidDueDate: true
  });
});

test('saveStateNow reports localStorage write failure to callers', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__PETA_BOARD_TEST__;
    const nextState = structuredClone(api.getState());
    nextState.board.title = '保存失敗の検証';
    api.setState(nextState);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      return await api.saveStateNow({ showError: false });
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  expect(result).toBe(false);
});

import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, openApp, seedState, storageKey } from '../helpers/peta-page.mjs';

const MiB = 1024 * 1024;
const lossMessage = '上限超過や不正な値で内容が変わるため、読み込みを中止しました';

async function savedText(page) {
  return page.evaluate((key) => localStorage.getItem(key), storageKey);
}

async function readDownload(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('a downloaded Japanese board larger than 1 MiB imports without losing data', async ({ page }) => {
  const state = makeMinimalState({
    title: '大きな日本語バックアップ',
    columns: [{
      id: 'col_large',
      title: '日本語の付箋',
      notes: Array.from({ length: 100 }, (_, index) => makeNote({
        id: `note_large_${index}`,
        title: `付箋${index}`,
        body: 'あ'.repeat(4000),
        tags: ['日本語', `タグ${index}`],
        dueDate: '2026-09-11',
        checklist: [{ id: `check_large_${index}`, text: `確認${index}`, done: index % 2 === 0 }]
      }))
    }]
  });
  await seedState(page, state);
  const original = await page.evaluate(() => window.__PETA_BOARD_TEST__.getState());
  expect(JSON.parse(await savedText(page))).toEqual(original);

  await page.getByRole('button', { name: '設定', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-board-btn').click()
  ]);
  const buffer = await readDownload(download);
  expect(buffer.byteLength).toBeGreaterThan(MiB);
  expect(JSON.parse(buffer.toString('utf8'))).toEqual(original);

  await page.locator('#reset-board-btn').click();
  await page.locator('#confirm-ok-btn').click();
  await expect(page.locator('#toast')).toHaveText('ボードを初期化しました');
  await expect(page.locator('.note-card')).toHaveCount(0);

  await page.setInputFiles('#import-board-file', {
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer
  });
  await expect(page.locator('#confirm-modal')).toBeVisible();
  await page.locator('#confirm-ok-btn').click();
  await expect(page.locator('#toast')).toHaveText('ボードを読み込みました');
  expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.getState())).toEqual(original);
  expect(JSON.parse(await savedText(page))).toEqual(original);

  await page.reload();
  await expect(page.locator('.note-card')).toHaveCount(100);
  expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.getState())).toEqual(original);
  expect(JSON.parse(await savedText(page))).toEqual(original);
});

test('the import byte limit covers the maximum escaped and indented board representation', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    const { LIMITS, normalizeState, hasStoredStateReduction } = window.__PETA_BOARD_TEST__;
    let nextId = 0;
    const id = () => String(nextId++).padEnd(96, 'x');
    // A control character takes six ASCII bytes as a JSON \\uXXXX escape.
    // Safe IDs need only one byte per character; finite numbers need at most 25.
    const text = (length) => '\u0000'.repeat(length);
    const timestamp = -0.0000010000000000000002;
    const columns = Array.from({ length: LIMITS.columns }, () => ({
      id: id(), title: text(LIMITS.columnTitle), notes: []
    }));
    for (let index = 0; index < LIMITS.notes; index += 1) {
      columns[index % columns.length].notes.push({
        id: id(),
        title: text(LIMITS.noteTitle),
        body: text(LIMITS.noteBody),
        color: 'yellow',
        tags: Array.from({ length: LIMITS.tags }, () => text(LIMITS.tag)),
        dueDate: '9999-12-31',
        checklist: Array.from({ length: LIMITS.checklistItems }, () => ({
          id: id(), text: text(LIMITS.checklistText), done: false
        })),
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
    const raw = {
      version: 1,
      theme: 'light',
      settings: { density: 'comfortable', defaultColor: 'yellow' },
      board: { title: text(LIMITS.boardTitle), createdAt: timestamp, updatedAt: timestamp, columns }
    };
    const normalized = normalizeState(raw);
    return {
      bytes: new Blob([JSON.stringify(normalized, null, 2)]).size,
      limit: LIMITS.importBytes,
      reduction: hasStoredStateReduction(raw, normalized),
      columns: normalized.board.columns.length,
      notes: normalized.board.columns.flatMap((column) => column.notes).length
    };
  });
  expect(result.reduction).toBe(false);
  expect(result.columns).toBe(12);
  expect(result.notes).toBe(500);
  expect(result.bytes).toBeGreaterThan(27 * MiB);
  expect(result.bytes).toBeLessThan(28 * MiB);
  expect(result.bytes).toBeLessThanOrEqual(result.limit);
});

test('lossy imports are rejected before confirmation and preserve the current saved board', async ({ page }) => {
  await seedState(page, makeMinimalState({
    title: '置き換えてはいけないボード',
    columns: [{ id: 'col_keep', title: '残す列', notes: [makeNote({ id: 'note_keep', title: '残す付箋' })] }]
  }));
  const original = await savedText(page);
  const limits = await page.evaluate(() => window.__PETA_BOARD_TEST__.LIMITS);
  const cases = [
    ['column count', (raw) => {
      raw.board.columns = Array.from({ length: limits.columns + 1 }, (_, index) => ({ id: `col_${index}`, title: '列', notes: [] }));
    }],
    ['note count', (raw) => {
      raw.board.columns[0].notes = Array.from({ length: limits.notes + 1 }, (_, index) => makeNote({ id: `note_${index}`, title: '付箋' }));
    }],
    ['board title', (raw) => { raw.board.title = 'b'.repeat(limits.boardTitle + 1); }],
    ['column title', (raw) => { raw.board.columns[0].title = 'c'.repeat(limits.columnTitle + 1); }],
    ['note title', (raw) => { raw.board.columns[0].notes[0].title = 't'.repeat(limits.noteTitle + 1); }],
    ['note body', (raw) => { raw.board.columns[0].notes[0].body = 'b'.repeat(limits.noteBody + 1); }],
    ['tag count', (raw) => { raw.board.columns[0].notes[0].tags = Array.from({ length: limits.tags + 1 }, (_, index) => `tag${index}`); }],
    ['tag length', (raw) => { raw.board.columns[0].notes[0].tags = ['t'.repeat(limits.tag + 1)]; }],
    ['checklist count', (raw) => {
      raw.board.columns[0].notes[0].checklist = Array.from({ length: limits.checklistItems + 1 }, (_, index) => ({ id: `check_${index}`, text: '項目', done: false }));
    }],
    ['checklist text', (raw) => { raw.board.columns[0].notes[0].checklist[0].text = 'c'.repeat(limits.checklistText + 1); }],
    ['checklist completion', (raw) => { raw.board.columns[0].notes[0].checklist[0].done = 'true'; }],
    ['due date', (raw) => { raw.board.columns[0].notes[0].dueDate = '2026-02-31'; }],
    ['unsafe column ID', (raw) => { raw.board.columns[0].id = 'unsafe id'; }],
    ['duplicate note ID', (raw) => { raw.board.columns[0].notes[0].id = raw.board.columns[0].id; }],
    ['duplicate checklist ID', (raw) => { raw.board.columns[0].notes[0].checklist[0].id = raw.board.columns[0].notes[0].id; }],
    ['numeric board title', (raw) => { raw.board.title = 123; }],
    ['numeric column title', (raw) => { raw.board.columns[0].title = 123; }],
    ['numeric note title', (raw) => { raw.board.columns[0].notes[0].title = 123; }],
    ['numeric note body', (raw) => { raw.board.columns[0].notes[0].body = 123; }],
    ['null note body', (raw) => { raw.board.columns[0].notes[0].body = null; }],
    ['object column ID', (raw) => { raw.board.columns[0].id = { original: 'col_import' }; }],
    ['object note ID', (raw) => { raw.board.columns[0].notes[0].id = { original: 'note_import' }; }],
    ['object checklist ID', (raw) => { raw.board.columns[0].notes[0].checklist[0].id = { original: 'check_import' }; }],
    ['empty ID', (raw) => { raw.board.columns[0].notes[0].id = ''; }],
    ['object tags', (raw) => { raw.board.columns[0].notes[0].tags = { first: 'tag' }; }],
    ['null tag item', (raw) => { raw.board.columns[0].notes[0].tags = [null]; }],
    ['non-array checklist', (raw) => { raw.board.columns[0].notes[0].checklist = { text: '失われる項目' }; }],
    ['null checklist', (raw) => { raw.board.columns[0].notes[0].checklist = null; }],
    ['null checklist item', (raw) => { raw.board.columns[0].notes[0].checklist = [null]; }],
    ['null checklist text', (raw) => { raw.board.columns[0].notes[0].checklist[0].text = null; }],
    ['null checklist completion', (raw) => { raw.board.columns[0].notes[0].checklist[0].done = null; }],
    ['null due date', (raw) => { raw.board.columns[0].notes[0].dueDate = null; }],
    ['unknown note color', (raw) => { raw.board.columns[0].notes[0].color = 'red'; }],
    ['inherited color name', (raw) => { raw.board.columns[0].notes[0].color = 'toString'; }],
    ['object note color', (raw) => { raw.board.columns[0].notes[0].color = { name: 'yellow' }; }],
    ['unknown theme', (raw) => { raw.theme = 'sepia'; }],
    ['non-object settings', (raw) => { raw.settings = ['compact']; }],
    ['null settings', (raw) => { raw.settings = null; }],
    ['unknown density', (raw) => { raw.settings.density = 'expanded'; }],
    ['unknown default color', (raw) => { raw.settings.defaultColor = 'red'; }],
    ['string version', (raw) => { raw.version = '1'; }],
    ['unsupported version', (raw) => { raw.version = 2; }],
    ['string board creation time', (raw) => { raw.board.createdAt = '123'; }],
    ['null board update time', (raw) => { raw.board.updatedAt = null; }],
    ['string note creation time', (raw) => { raw.board.columns[0].notes[0].createdAt = '123'; }],
    ['null note update time', (raw) => { raw.board.columns[0].notes[0].updatedAt = null; }]
  ];
  for (const [name, mutate] of cases) {
    await test.step(name, async () => {
      const raw = makeMinimalState({ columns: [{
        id: 'col_import', title: 'Import', notes: [makeNote({
          id: 'note_import', title: '読み込まない付箋',
          checklist: [{ id: 'check_import', text: '確認', done: false }]
        })]
      }] });
      mutate(raw);
      await page.setInputFiles('#import-board-file', {
        name: 'lossy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw))
      });
      await expect(page.locator('#import-board-file')).toHaveValue('');
      await expect(page.locator('#toast')).toHaveText(lossMessage);
      await expect(page.locator('#confirm-modal')).toBeHidden();
      await expect(page.locator('.note-title')).toHaveText('残す付箋');
      expect(await savedText(page)).toBe(original);
      expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.getState())).toEqual(JSON.parse(original));
    });
  }
  await page.reload();
  await expect(page.locator('.note-title')).toHaveText('残す付箋');
  expect(await savedText(page)).toBe(original);
});

test('minimal boards and explicit legacy fields still import and persist', async ({ page }) => {
  await openApp(page);
  const cases = [
    {
      raw: { board: { columns: [{ notes: [{}] }] } },
      expected: {
        version: 1,
        theme: 'light',
        settings: { density: 'comfortable', defaultColor: 'paper' },
        board: {
          title: 'PetaBoard',
          columns: [{ title: '新しい列', notes: [{ title: '', body: '', color: 'paper', tags: [], dueDate: '', checklist: [] }] }]
        }
      }
    },
    {
      raw: {
        theme: 'dark',
        settings: { density: 'compact', defaultColor: 'violet' },
        board: {
          title: 'Legacy',
          columns: [{ id: 101, title: '旧データ', notes: [
            { id: 201, title: 'Rose', color: 'rose', tags: 'alpha,beta', checklist: [{ id: 301, text: '確認' }] },
            { id: 202, title: 'Violet', color: 'violet' },
            { id: 203, title: 'Apricot', color: 'apricot' }
          ] }]
        }
      },
      expected: {
        version: 1,
        theme: 'dark',
        settings: { density: 'compact', defaultColor: 'blue' },
        board: {
          title: 'Legacy',
          columns: [{ id: '101', title: '旧データ', notes: [
            { id: '201', title: 'Rose', color: 'yellow', tags: ['alpha', 'beta'], checklist: [{ id: '301', text: '確認', done: false }] },
            { id: '202', title: 'Violet', color: 'blue' },
            { id: '203', title: 'Apricot', color: 'yellow' }
          ] }]
        }
      }
    }
  ];
  for (const { raw, expected } of cases) {
    await page.setInputFiles('#import-board-file', {
      name: 'compatible.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw))
    });
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.locator('#confirm-ok-btn').click();
    await expect(page.locator('#toast')).toHaveText('ボードを読み込みました');
    const imported = await page.evaluate(() => window.__PETA_BOARD_TEST__.getState());
    expect(imported).toMatchObject(expected);
    await expect.poll(() => savedText(page)).toBe(JSON.stringify(imported));
    await page.reload();
    expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.getState())).toEqual(imported);
    expect(JSON.parse(await savedText(page))).toEqual(imported);
  }
});

test('an over-limit file is refused before reading and leaves the saved board unchanged', async ({ page }) => {
  await seedState(page, makeMinimalState({
    columns: [{ id: 'col_keep', title: '残す列', notes: [makeNote({ id: 'note_keep', title: '残す付箋' })] }]
  }));
  const original = await savedText(page);
  const limit = await page.evaluate(() => {
    const { LIMITS } = window.__PETA_BOARD_TEST__;
    window.__importFileReads = 0;
    const read = File.prototype.text;
    File.prototype.text = function (...args) {
      window.__importFileReads += 1;
      return read.apply(this, args);
    };
    return LIMITS.importBytes;
  });
  await page.setInputFiles('#import-board-file', {
    name: 'oversized.json', mimeType: 'application/json', buffer: Buffer.alloc(limit + 1, ' ')
  });
  await expect(page.locator('#import-board-file')).toHaveValue('');
  await expect(page.locator('#toast')).toHaveText(`読み込めるJSONは${limit / MiB}MBまでです`);
  await expect(page.locator('#confirm-modal')).toBeHidden();
  expect(await page.evaluate(() => window.__importFileReads)).toBe(0);
  expect(await savedText(page)).toBe(original);
  await page.reload();
  await expect(page.locator('.note-title')).toHaveText('残す付箋');
});

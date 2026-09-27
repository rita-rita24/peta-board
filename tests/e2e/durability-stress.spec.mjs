import { expect, test } from '@playwright/test';
import { appUrl, makeMinimalState, makeNote, seedState, storageKey } from '../helpers/peta-page.mjs';

test('a full board keeps edits, search results, and its backup through repeated saves and reload', async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const columns = Array.from({ length: 12 }, (_, index) => ({ id: `col_${index}`, title: `列${index}`, notes: [] }));
  for (let index = 0; index < 500; index += 1) columns[index % 12].notes.push(makeNote({
    id: `note_${index}`, title: `負荷確認${index}`, body: '日本語の本文📝\n'.repeat(80), tags: [`分類${index % 8}`],
    checklist: Array.from({ length: 30 }, (_, check) => ({ id: `check_${index}_${check}`, text: `確認${check}`, done: check % 3 === 0 }))
  }));
  await seedState(page, makeMinimalState({ columns }));
  await expect(page.locator('.note-card')).toHaveCount(500);
  const expected = await page.evaluate(() => window.__PETA_BOARD_TEST__.getState());
  // 再現可能な操作列で、異なる列・付箋位置・入力内容を検証する。
  for (let step = 0; step < 24; step += 1) {
    const id = `note_${(step * 137) % 500}`;
    const title = `編集${step}𠮷📝`;
    const body = `保存と復元の検証${step}\n${'本文'.repeat(step + 1)}`;
    await page.locator(`[data-note-id="${id}"]`).click();
    await page.locator('#note-title-input').fill(title);
    await page.locator('#note-body-input').fill(body);
    await page.locator('#close-drawer-btn').click();
    expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }))).toBe(true);
    const note = expected.board.columns.flatMap((column) => column.notes).find((note) => note.id === id);
    note.title = title;
    note.body = body;
  }
  await page.locator('#search-input').fill('編集');
  await expect(page.locator('.note-card')).toHaveCount(24);
  await page.locator('#clear-search-btn').click();
  await expect(page.locator('.note-card')).toHaveCount(500);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  // 時刻の更新は許容し、ユーザーが入力したフィールドはすべて完全一致を確認する。
  const withoutTimes = (value) => JSON.parse(JSON.stringify(value, (key, entry) => ['createdAt', 'updatedAt'].includes(key) ? undefined : entry));
  expect(withoutTimes(saved)).toEqual(withoutTimes(expected));
  await page.reload();
  await expect(page.locator('.note-card')).toHaveCount(500);
  expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.getState())).toEqual(saved);
  const downloaded = page.waitForEvent('download');
  await page.locator('#quick-export-btn').click();
  const chunks = [];
  for await (const chunk of await (await downloaded).createReadStream()) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks))).toEqual(saved);
  expect(errors).toEqual([]);
});

test('saved data survives closing and restarting the browser with its real profile', async ({ playwright, browserName }, testInfo) => {
  const profile = testInfo.outputPath('browser-profile');
  let context;
  const expected = makeMinimalState({ title: 'ブラウザ再起動', columns: [{ id: 'col_restart', title: '保存', notes: [makeNote({
    id: 'note_restart', title: '再起動しても残す📝', body: '本文\n二行目', tags: ['仕事'],
    dueDate: '2028-02-29', checklist: [{ id: 'check_restart', text: '保存の確認', done: true }]
  })] }] });
  try {
    context = await playwright[browserName].launchPersistentContext(profile, { headless: true });
    const page = context.pages()[0];
    await seedState(page, expected);
    await expect(page.locator('#save-indicator')).toHaveAttribute('data-state', 'saved');
    await context.close();
    context = await playwright[browserName].launchPersistentContext(profile, { headless: true });
    const restored = context.pages()[0];
    await restored.goto(appUrl);
    await expect(restored.locator('.note-title')).toHaveText('再起動しても残す📝');
    expect(await restored.evaluate(() => window.__PETA_BOARD_TEST__.getState())).toEqual(expected);
  } finally {
    await context?.close();
  }
});

test('a renderer crash preserves completed edits and allows subsequent saves', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Renderer crash injection uses Chromium CDP.');
  const expected = makeMinimalState({ title: '強制終了の確認', columns: [{ id: 'col_crash', title: '保存済み', notes: [makeNote({ title: '強制終了前の付箋' })] }] });
  await seedState(page, expected);
  await expect(page.locator('#save-indicator')).toHaveAttribute('data-state', 'saved');
  const session = await context.newCDPSession(page);
  const crashed = page.waitForEvent('crash');
  void session.send('Page.crash').catch(() => {});
  await crashed;
  await page.close();
  const restored = await context.newPage();
  await restored.goto(appUrl);
  await expect(restored.locator('.note-title')).toHaveText('強制終了前の付箋');
  expect(await restored.evaluate(() => window.__PETA_BOARD_TEST__.getState())).toEqual(expected);
  await restored.locator('.column-title').fill('強制終了後も保存');
  expect(await restored.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }))).toBe(true);
  await restored.reload();
  await expect(restored.locator('.column-title')).toHaveValue('強制終了後も保存');
});

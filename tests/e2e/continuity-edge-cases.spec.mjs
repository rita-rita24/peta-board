import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { appUrl, makeMinimalState, makeNote, seedState, storageKey } from '../helpers/peta-page.mjs';

const save = (page) => page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }));
const board = () => makeMinimalState({ columns: [{ id: 'col_work', title: '仕事', notes: Array.from({ length: 35 }, (_, index) => makeNote({
  id: `note_${index}`, title: `ALPHA beta ${index}`, body: Array.from({ length: 80 }, (_, line) => `本文 ${line}`).join('\n'),
  tags: ['仕事'], dueDate: '2026-09-23', checklist: Array.from({ length: 30 }, (_, item) => ({ id: `check_${index}_${item}`, text: `項目 ${item}`, done: false }))
})) }] });

for (const query of ['alpha beta ', 'ALPHA beta', 'beta alpha', 'alpha beta alpha', 'alpha　beta']) {
  test(`equivalent search ${JSON.stringify(query)} preserves cards and reading position`, async ({ page }) => {
    await seedState(page, board());
    await page.locator('#search-input').fill('alpha beta');
    await page.locator('.note-list').evaluate((list) => { list.scrollTop = 700; });
    const before = await page.evaluate(() => {
      window.originalCard = document.querySelector('.note-card');
      return { top: document.querySelector('.note-list').scrollTop, marks: [...document.querySelectorAll('.search-hit')].map((mark) => mark.textContent) };
    });
    expect(before.top).toBeGreaterThan(0);
    await page.locator('#search-input').fill(query);
    expect(await page.evaluate(() => ({
      top: document.querySelector('.note-list').scrollTop,
      marks: [...document.querySelectorAll('.search-hit')].map((mark) => mark.textContent)
    }))).toEqual(before);
    expect(await page.evaluate(() => window.originalCard === document.querySelector('.note-card'))).toBe(true);
    await expect(page.locator('#search-input')).toHaveValue(query);
    await page.locator('#search-input').fill('absent');
    await expect(page.locator('.note-card')).toHaveCount(0);
    await page.locator('#clear-search-btn').click();
    await expect(page.locator('.note-card')).toHaveCount(35);
  });
}

test.describe('calendar continuity', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });
  for (const focus of ['.date-day[data-date="2026-09-23"]', '#date-next-month-btn']) {
    test(`midnight updates the open calendar without moving ${focus} focus`, async ({ page }) => {
      await page.clock.install({ time: new Date('2026-09-23T23:59:40+09:00') });
      await seedState(page, board());
      await page.locator('.note-card').first().click();
      await page.locator('#note-due-input').press('Enter');
      await expect(page.locator('.date-day.is-today')).toHaveAttribute('data-date', '2026-09-23');
      await page.locator(focus).focus();
      const saved = await page.evaluate((key) => localStorage.getItem(key), storageKey);
      await page.clock.runFor(21000);
      await expect(page.locator('.date-day.is-today')).toHaveAttribute('data-date', '2026-09-24');
      await expect(page.locator(focus)).toBeFocused();
      await expect(page.locator('#note-due-input')).toHaveValue('2026-09-23');
      expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(saved);
    });
  }

  for (const dueDate of ['0001-01-01', '9999-12-31']) {
    test(`the calendar at ${dueDate} cannot focus or select an unsupported year`, async ({ page }) => {
      await seedState(page, makeMinimalState({ columns: [{ id: 'col_work', title: '仕事', notes: [makeNote({ title: '日付の境界', dueDate })] }] }));
      await page.locator('.note-card').click();
      await page.locator('#note-due-input').press('Enter');
      const outside = page.locator(dueDate.startsWith('0001') ? '.date-day[data-date^="0000-"]' : '.date-day[data-date^="10000-"]');
      expect(await outside.count()).toBeGreaterThan(0);
      for (const cell of await outside.all()) await expect(cell).toBeDisabled();
      const unavailableMonth = page.locator(dueDate.startsWith('0001') ? '#date-prev-month-btn' : '#date-next-month-btn');
      await expect(unavailableMonth).toBeDisabled();
      await page.locator(`.date-day[data-date="${dueDate}"]`).press('Enter');
      await expect(page.locator('#note-due-input')).toHaveValue(dueDate);
      expect(await save(page)).toBe(true);
    });
  }
});

test.describe('remote editor continuity', () => {
  const origin = 'https://continuity-edge.test';
  const html = readFileSync(fileURLToPath(appUrl), 'utf8');
  test.beforeEach(async ({ context }) => {
    await context.route(`${origin}/**`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
  });

  for (const field of [
    { name: 'title', selector: '#note-title-input', open: '.note-card' },
    { name: 'body', selector: '#note-body-input', open: '.note-card' },
    { name: 'tags', selector: '#note-tags-input', open: '.note-card' },
    { name: 'board name', selector: '#board-name-input', open: '#settings-btn' },
    { name: 'tags', selector: '#note-tags-input', open: '.note-card', text: ',' },
    { name: 'board name', selector: '#board-name-input', open: '#settings-btn', text: ' ' },
    { name: 'column title', selector: '.column-title' },
    { name: 'checklist', selector: '.check-row input[type="text"]', open: '.note-card' }
  ]) {
    test(`an unrelated remote update keeps native undo for ${field.name}${field.text ? ' including an unfinished separator' : ''}`, async ({ page, context }) => {
      await page.goto(origin);
      await page.locator('.column').first().waitFor();
      await page.evaluate((state) => window.__PETA_BOARD_TEST__.setState(state), board());
      expect(await save(page)).toBe(true);
      if (field.open) await page.locator(field.open).first().click();
      const input = page.locator(field.selector).first();
      const original = await input.inputValue();
      await input.focus();
      await input.click();
      await input.evaluate((element) => { element.setSelectionRange(element.value.length, element.value.length); });
      await input.pressSequentially(field.text || 'X');
      const edited = await input.inputValue();
      expect(edited).not.toBe(original);
      expect(await save(page)).toBe(true);
      const writer = await context.newPage();
      await writer.goto(origin);
      await writer.locator('.column').first().waitFor();
      await writer.locator('#theme-btn').click();
      expect(await save(writer)).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(input).toHaveValue(edited);
      await expect(input).toBeFocused();
      await input.press('ControlOrMeta+z');
      await expect(input).toHaveValue(original);
      expect(await save(page)).toBe(true);
      const next = await page.evaluate(() => window.__PETA_BOARD_TEST__.getState());
      expect(next.theme).toBe('dark');
      const text = field.name === 'board name' ? next.board.title : field.name === 'column title' ? next.board.columns[0].title
        : field.name === 'checklist' ? next.board.columns[0].notes[0].checklist[0].text
        : field.name === 'tags' ? next.board.columns[0].notes[0].tags.join(', ') : next.board.columns[0].notes[0][field.name];
      expect(text).toBe(original);
    });
  }

  for (const kind of ['column', 'checklist']) {
    test(`remote reorder preserves the ${kind} input history and updates surrounding controls`, async ({ page, context }) => {
      const initial = board();
      initial.board.columns.push({ id: 'col_other', title: '別の列', notes: [] });
      await page.goto(origin);
      await page.locator('.column').first().waitFor();
      await page.evaluate((state) => window.__PETA_BOARD_TEST__.setState(state), initial);
      expect(await save(page)).toBe(true);
      // 検索欄の編集をブラウザーの取り消し履歴に追加せず、初期条件として設定する。
      // WebKitは連続した編集を複数の欄にまたがってまとめる場合があるため、列名だけを検証する。
      if (kind === 'column') await page.locator('#search-input').evaluate((input) => {
        input.value = '仕事X';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      else await page.locator('.note-card').first().click();
      const input = page.locator(kind === 'column' ? '.column[data-column-id="col_work"] .column-title' : '.check-row[data-check-id="check_0_0"] input[type="text"]');
      const original = await input.inputValue();
      await input.click();
      await input.evaluate((element) => { element.setSelectionRange(element.value.length, element.value.length); });
      await input.pressSequentially('X');
      expect(await save(page)).toBe(true);
      const writer = await context.newPage();
      await writer.goto(origin);
      await writer.locator('.column').first().waitFor();
      await writer.evaluate((kind) => {
        const api = window.__PETA_BOARD_TEST__;
        const state = structuredClone(api.getState());
        if (kind === 'column') {
          state.board.columns.reverse();
          state.board.columns[1].notes[0].title = '別タブの付箋編集';
        } else {
          const items = state.board.columns[0].notes[0].checklist;
          items.reverse();
          items.find((item) => item.id === 'check_0_0').done = true;
        }
        state.theme = 'dark';
        api.setState(state);
      }, kind);
      expect(await save(writer)).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(input).toBeFocused();
      if (kind === 'column') {
        await expect(page.locator('.column').last()).toHaveAttribute('data-column-id', 'col_work');
        await expect(page.locator('.column').last().getByRole('button', { name: '右へ移動' })).toBeDisabled();
        await expect(page.locator('.note-title').first()).toHaveText('別タブの付箋編集');
      } else {
        await expect(page.locator('.check-row').last()).toHaveAttribute('data-check-id', 'check_0_0');
        await expect(page.locator('.check-row').last().locator('input[type="checkbox"]')).toBeChecked();
      }
      await input.press('ControlOrMeta+z');
      await expect(input).toHaveValue(original);
      if (kind === 'column') {
        await expect(page.locator('.note-card')).toHaveCount(0);
        await expect(page.locator('.column-count')).toHaveText(['0 / 0', '0 / 35']);
      }
      expect(await save(page)).toBe(true);
      await page.reload();
      if (kind === 'column') {
        await expect(page.locator('.column-title').last()).toHaveValue(original);
        await expect(page.locator('.note-title').first()).toHaveText('別タブの付箋編集');
      } else {
        await page.locator('.note-card').first().click();
        await expect(input).toHaveValue(original);
        await expect(page.locator('.check-row').last().locator('input[type="checkbox"]')).toBeChecked();
      }
    });
  }

  test('an unrelated remote update preserves editor scroll positions while reading', async ({ page, context }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(origin);
    await page.locator('.column').first().waitFor();
    await page.evaluate((state) => window.__PETA_BOARD_TEST__.setState(state), board());
    expect(await save(page)).toBe(true);
    const writer = await context.newPage();
    await writer.goto(origin);
    await writer.locator('.note-card').first().waitFor();
    await page.locator('.note-card').first().click();
    await expect(page.locator('#note-title-input')).toBeFocused();
    const read = () => page.evaluate(() => ['#note-body-input', '#checklist', '#note-drawer .drawer-body'].map((selector) => document.querySelector(selector).scrollTop));
    await page.evaluate(() => {
      for (const selector of ['#note-body-input', '#checklist', '#note-drawer .drawer-body']) document.querySelector(selector).scrollTop = 150;
    });
    const before = await read();
    expect(before[0]).toBeGreaterThan(0);
    expect(before[1]).toBeGreaterThan(0);
    await writer.locator('.column-title').fill('別タブから変更');
    expect(await save(writer)).toBe(true);
    await expect(page.locator('#drawer-subtitle')).toHaveText('別タブから変更');
    expect(await read()).toEqual(before);
    await expect(page.locator('#note-title-input')).toBeFocused();
  });
});

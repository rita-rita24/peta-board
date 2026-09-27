import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, openApp, seedState, storageKey } from '../helpers/peta-page.mjs';

const upload = (page, name, title) => page.setInputFiles('#import-board-file', {
  name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(makeMinimalState({ title })))
});

async function delayFirstRead(page) {
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      const read = original.call(this);
      if (this.name !== 'slow.json') return read;
      return new Promise((resolve, reject) => {
        window.finishSlowImport = async (fail = false) => {
          if (fail) reject(new Error('Delayed read failure'));
          else resolve(await read);
        };
      });
    };
  });
}

for (const fail of [false, true]) {
  test(`an obsolete ${fail ? 'failed' : 'successful'} import cannot interrupt the newer confirmation`, async ({ page }) => {
    await openApp(page);
    await delayFirstRead(page);
    await upload(page, 'slow.json', '古い読み込み');
    await upload(page, 'new.json', '最後に選んだ読み込み');
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.evaluate((fail) => window.finishSlowImport(fail), fail);
    await expect(page.locator('#toast')).not.toHaveText('読み込めないJSONファイルです');
    await expect(page.locator('#import-board-file')).toHaveValue(/new\.json$/);
    await page.locator('#confirm-ok-btn').click();
    await expect(page.locator('#board-title')).toHaveText('最後に選んだ読み込み');
    await expect(page.locator('#toast')).toHaveText('ボードを読み込みました');
    await page.reload();
    await expect(page.locator('#board-title')).toHaveText('最後に選んだ読み込み');
  });
}

for (const modal of [
  { name: 'note editor', id: 'note-drawer', open: '.note-card', close: '#close-drawer-btn' },
  { name: 'settings', id: 'settings-modal', open: '#settings-btn', close: '#close-settings-btn' },
  { name: 'help', id: 'help-modal', open: '#help-btn', close: '#close-help-btn' },
  { name: 'confirmation', id: 'confirm-modal', open: '#delete-note-btn', close: '#confirm-cancel-btn' }
]) {
  test(`a late close timer cannot hide a reopened ${modal.name}`, async ({ page }) => {
    await page.clock.install();
    await seedState(page, makeMinimalState({ columns: [{ id: 'col_test', title: '列', notes: [makeNote({ title: '操作対象' })] }] }));
    if (modal.id === 'confirm-modal') await page.locator('.note-card').click();
    await page.locator(modal.open).click();
    await expect(page.locator(`#${modal.id}`)).toHaveClass(/is-open/);
    // 描画処理の混雑やバックグラウンド状態により、次の描画が以前のアニメーションの
    // タイマーより遅れる状況を再現する。開き直したモーダルは操作できる状態を保つ。
    await page.evaluate((modal) => {
      window.pendingFrames = [];
      window.requestAnimationFrame = (callback) => window.pendingFrames.push(callback);
      document.querySelector(modal.close).click();
      document.querySelector(modal.open).click();
    }, modal);
    await page.clock.runFor(170);
    expect(await page.locator(`#${modal.id}`).evaluate((element) => element.hidden)).toBe(false);
    await page.evaluate(() => { for (const callback of window.pendingFrames.splice(0)) callback(performance.now()); });
    await expect(page.locator(`#${modal.id}`)).toBeVisible();
    await expect(page.locator(`#${modal.id}`)).toHaveClass(/is-open/);
  });
}

test('changing the system clock does not expire deletion undo before its grace period', async ({ page }) => {
  await page.clock.install();
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_test', title: '列', notes: [makeNote({ title: '復元対象' })] }] }));
  await page.locator('.note-card').click();
  await page.locator('#delete-note-btn').click();
  await page.locator('#confirm-ok-btn').click();
  await expect(page.locator('#note-drawer')).toBeHidden();
  await page.clock.setFixedTime(new Date('2099-01-01T00:00:00Z'));
  await page.locator('#deletion-undo-btn').click();
  await expect(page.locator('.note-title')).toHaveText('復元対象');
});

test('a pending file read cannot reopen an import after a confirmed reset', async ({ page }) => {
  await openApp(page);
  await delayFirstRead(page);
  await upload(page, 'slow.json', '初期化より前の読み込み');
  await page.locator('#settings-btn').click();
  await page.locator('#reset-board-btn').click();
  await page.locator('#confirm-ok-btn').click();
  await expect(page.locator('#toast')).toHaveText('ボードを初期化しました');
  await page.evaluate(() => window.finishSlowImport());
  await expect(page.locator('#confirm-modal')).toBeHidden();
  await expect(page.locator('#board-title')).toHaveText('PetaBoard');
});

test('creating and duplicating notes stays unique with a fixed clock and repeated random values', async ({ page }) => {
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_test', title: '列', notes: [] }] }));
  await page.evaluate(() => { Date.now = () => 1700000000000; Math.random = () => 0.5; });
  for (let index = 0; index < 5; index += 1) {
    await page.locator('.add-note-btn').click();
    await page.locator('#note-title-input').fill(`付箋${index}`);
    await page.locator('#close-drawer-btn').click();
  }
  const ids = await page.evaluate(() => window.__PETA_BOARD_TEST__.getState().board.columns[0].notes.map((note) => note.id));
  expect(new Set(ids).size).toBe(5);
  await page.locator('.note-card').last().click();
  await page.locator('#duplicate-note-btn').click();
  await page.locator('#close-drawer-btn').click();
  expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }))).toBe(true);
  await page.reload();
  await expect(page.locator('.note-card')).toHaveCount(6);
  await expect(page.locator('.note-title')).toHaveText(['付箋0', '付箋1', '付箋2', '付箋3', '付箋4', '付箋4 copy']);
});

test('valid four-digit dates round trip including leap days before year 100', async ({ page }) => {
  await openApp(page);
  const values = ['0001-01-01', '0004-02-29', '0099-12-31', '0100-01-01', '2000-02-29', '9999-12-31'];
  expect(await page.evaluate((values) => values.map((value) => window.__PETA_BOARD_TEST__.normalizeDueDate(value)), values)).toEqual(values);
  expect(await page.evaluate(() => ['0000-01-01', '0001-02-29', '0100-02-29', '10000-01-01'].map((value) => window.__PETA_BOARD_TEST__.normalizeDueDate(value)))).toEqual(['', '', '', '']);
});

for (const dueDate of ['0001-01-01', '0099-12-31', '9999-12-31']) {
  test(`calendar selection preserves the date at ${dueDate}`, async ({ page }) => {
    await seedState(page, makeMinimalState({ columns: [{ id: 'col_test', title: '列', notes: [makeNote({ id: 'note_date', title: '日付', dueDate })] }] }));
    await page.locator('.note-card').click();
    await page.locator('#note-due-field').click();
    const selected = page.locator(`.date-day[data-date="${dueDate}"]`);
    await expect(selected).toHaveClass(/is-selected/);
    if (dueDate === '9999-12-31' || dueDate === '0001-01-01') {
      await selected.focus();
      await selected.press(dueDate.startsWith('9999') ? 'ArrowRight' : 'ArrowLeft');
      await page.keyboard.press('Enter');
    } else {
      await selected.click();
    }
    await expect(page.locator('#note-due-input')).toHaveValue(dueDate);
    await page.locator('#close-drawer-btn').click();
    expect(await page.evaluate(() => window.__PETA_BOARD_TEST__.saveStateNow({ showError: false }))).toBe(true);
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).board.columns[0].notes[0].dueDate, storageKey)).toBe(dueDate);
  });
}

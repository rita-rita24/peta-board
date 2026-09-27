import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, seedState, storageKey } from '../helpers/peta-page.mjs';

test.use({ timezoneId: 'Asia/Tokyo' });

test('overdue cards show calendar days late while current and future deadlines keep their date', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-16T00:05:00+09:00'));
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_work', title: '進行中', notes: [
    makeNote({ id: 'note_yesterday', title: '昨日が期限', dueDate: '2026-09-15' }),
    makeNote({ id: 'note_three', title: '3日前が期限', dueDate: '2026-09-13' }),
    makeNote({ id: 'note_today', title: '今日が期限', dueDate: '2026-09-16' }),
    makeNote({ id: 'note_future', title: '明日が期限', dueDate: '2026-09-17' }),
    makeNote({ id: 'note_none', title: '期限なし' })
  ] }] }));

  await expect(page.locator('.due-pill')).toHaveText([
    '2026-09-15 · 1日遅れ', '2026-09-13 · 3日遅れ', '2026-09-16', '2026-09-17'
  ]);
  await expect(page.locator('.due-pill.is-overdue')).toHaveCount(2);
  await expect(page.locator('[data-note-id="note_none"] .due-pill')).toHaveCount(0);

  await page.reload();
  const yesterday = page.locator('[data-note-id="note_yesterday"]');
  await expect(yesterday.locator('.due-pill')).toHaveText('2026-09-15 · 1日遅れ');
  await yesterday.click();
  await page.locator('#note-due-field').click();
  await page.locator('#date-today-btn').click();
  await page.locator('#close-drawer-btn').click();
  await expect(yesterday.locator('.due-pill')).toHaveText('2026-09-16');
  await expect(yesterday.locator('.due-pill')).not.toHaveClass(/is-overdue/);
});

test('midnight updates overdue counts without changing saved data or keyboard focus', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-16T23:59:50+09:00') });
  await seedState(page, makeMinimalState({ columns: [{ id: 'col_work', title: '進行中', notes: [
    makeNote({ id: 'note_due', title: '今日まで', dueDate: '2026-09-16' })
  ] }] }));
  const card = page.locator('[data-note-id="note_due"]');
  await expect(card.locator('.due-pill')).toHaveText('2026-09-16');
  await card.focus();
  const saved = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  await page.clock.runFor(11000);
  await expect(card.locator('.due-pill')).toHaveText('2026-09-16 · 1日遅れ');
  await expect(card.locator('.due-pill')).toHaveClass(/is-overdue/);
  await expect(card).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(saved);
});

for (const scenario of [
  { name: 'leap day', timezoneId: 'Asia/Tokyo', today: '2024-03-01T00:05:00+09:00', due: '2024-02-28', days: 2 },
  { name: 'year boundary', timezoneId: 'Asia/Tokyo', today: '2027-01-01T00:05:00+09:00', due: '2026-12-31', days: 1 },
  { name: 'spring daylight-saving transition', timezoneId: 'America/New_York', today: '2026-03-09T00:05:00-04:00', due: '2026-03-07', days: 2 },
  { name: 'autumn daylight-saving transition', timezoneId: 'America/New_York', today: '2026-11-02T00:05:00-05:00', due: '2026-10-31', days: 2 }
]) {
  test.describe(scenario.name, () => {
    test.use({ timezoneId: scenario.timezoneId });
    test('counts local calendar days across the boundary', async ({ page }) => {
      await page.clock.setFixedTime(new Date(scenario.today));
      await seedState(page, makeMinimalState({ columns: [{ id: 'col_work', title: '進行中', notes: [
        makeNote({ title: '期限の確認', dueDate: scenario.due })
      ] }] }));
      await expect(page.locator('.due-pill')).toHaveText(`${scenario.due} · ${scenario.days}日遅れ`);
    });
  });
}

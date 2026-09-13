import { expect, test } from '@playwright/test';
import { makeMinimalState, makeNote, openApp, seedState } from '../helpers/peta-page.mjs';

for (const viewport of [
  { name: 'mobile-320', width: 320, height: 568 },
  { name: 'mobile-375', width: 375, height: 667 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-430', width: 430, height: 932 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1024', width: 1024, height: 768 },
  { name: 'desktop-1280', width: 1280, height: 900 }
]) {
  test(`responsive shell fits without document-level horizontal overflow on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openApp(page);

    const metrics = await page.evaluate(() => {
      const topbar = document.querySelector('.topbar');
      const shell = document.querySelector('.board-shell');
      const firstColumn = document.querySelector('.column');
      const topbarRect = topbar.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      const columnRect = firstColumn.getBoundingClientRect();
      return {
        htmlScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
        topbarScrollWidth: topbar.scrollWidth,
        topbarClientWidth: topbar.clientWidth,
        shellTop: shellRect.top,
        topbarBottom: topbarRect.bottom,
        columnWidth: columnRect.width
      };
    });

    expect(metrics.htmlScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.topbarScrollWidth).toBeLessThanOrEqual(metrics.topbarClientWidth + 1);
    expect(metrics.shellTop).toBeGreaterThanOrEqual(metrics.topbarBottom - 1);
    expect(metrics.columnWidth).toBeLessThanOrEqual(metrics.viewportWidth - 24);
  });
}

test('note drawer fits on mobile and metadata fields collapse', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const state = makeMinimalState({
    columns: [
      {
        id: 'col_todo',
        title: 'Todo',
        notes: [makeNote({ id: 'note_mobile', title: 'モバイル確認', body: '本文' })]
      }
    ]
  });
  await seedState(page, state);

  await page.locator('.note-card', { hasText: 'モバイル確認' }).click();
  await expect(page.locator('#note-drawer')).toBeVisible();

  const metrics = await page.evaluate(() => {
    const panel = document.querySelector('.drawer-panel');
    const body = document.querySelector('#note-drawer .drawer-body');
    const metadataFields = document.querySelector('.metadata-fields');
    const footer = document.querySelector('.drawer-footer');
    const panelRect = panel.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
      panelScrollWidth: panel.scrollWidth,
      panelClientWidth: panel.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
      metadataColumns: getComputedStyle(metadataFields).gridTemplateColumns.split(' ').length,
      footerRight: footerRect.right
    };
  });

  expect(metrics.panelLeft).toBeGreaterThanOrEqual(0);
  expect(metrics.panelRight).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.panelScrollWidth).toBeLessThanOrEqual(metrics.panelClientWidth + 1);
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.bodyClientWidth + 1);
  expect(metrics.metadataColumns).toBe(1);
  expect(metrics.footerRight).toBeLessThanOrEqual(metrics.panelRight + 1);
});

test('date popover remains inside a short mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 320 });
  const state = makeMinimalState({
    columns: [
      {
        id: 'col_todo',
        title: 'Todo',
        notes: [makeNote({ id: 'note_due', title: '低い画面の期限入力', body: '本文' })]
      }
    ]
  });
  await seedState(page, state);

  await page.locator('.note-card', { hasText: '低い画面の期限入力' }).click();
  await expect(page.locator('#note-drawer')).toBeVisible();
  await page.locator('#note-due-field').click();
  await expect(page.locator('#date-popover')).toBeVisible();

  const metrics = await page.evaluate(() => {
    const popover = document.querySelector('#date-popover');
    const rect = popover.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      scrollWidth: popover.scrollWidth,
      clientWidth: popover.clientWidth,
      scrollHeight: popover.scrollHeight,
      clientHeight: popover.clientHeight,
      overflowY: getComputedStyle(popover).overflowY
    };
  });

  expect(metrics.left).toBeGreaterThanOrEqual(0);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.top).toBeGreaterThanOrEqual(0);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(['auto', 'scroll']).toContain(metrics.overflowY);
  expect(metrics.scrollHeight).toBeGreaterThanOrEqual(metrics.clientHeight);
});

test('settings and confirm modals stay inside a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);

  await page.getByRole('button', { name: '設定' }).click();
  await expect(page.locator('#settings-modal')).toBeVisible();

  const settingsMetrics = await page.evaluate(() => {
    const panel = document.querySelector('.settings-panel');
    const rect = panel.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      scrollWidth: panel.scrollWidth,
      clientWidth: panel.clientWidth
    };
  });

  expect(settingsMetrics.left).toBeGreaterThanOrEqual(0);
  expect(settingsMetrics.right).toBeLessThanOrEqual(settingsMetrics.viewportWidth + 1);
  expect(settingsMetrics.top).toBeGreaterThanOrEqual(0);
  expect(settingsMetrics.bottom).toBeLessThanOrEqual(settingsMetrics.viewportHeight + 1);
  expect(settingsMetrics.scrollWidth).toBeLessThanOrEqual(settingsMetrics.clientWidth + 1);

  await page.locator('#reset-board-btn').click();
  await expect(page.locator('#confirm-modal')).toBeVisible();

  const confirmMetrics = await page.evaluate(() => {
    const panel = document.querySelector('.confirm-panel');
    const actions = document.querySelector('.confirm-actions');
    const rect = panel.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      panelScrollWidth: panel.scrollWidth,
      panelClientWidth: panel.clientWidth,
      actionsScrollWidth: actions.scrollWidth,
      actionsClientWidth: actions.clientWidth
    };
  });

  expect(confirmMetrics.left).toBeGreaterThanOrEqual(0);
  expect(confirmMetrics.right).toBeLessThanOrEqual(confirmMetrics.viewportWidth + 1);
  expect(confirmMetrics.top).toBeGreaterThanOrEqual(0);
  expect(confirmMetrics.bottom).toBeLessThanOrEqual(confirmMetrics.viewportHeight + 1);
  expect(confirmMetrics.panelScrollWidth).toBeLessThanOrEqual(confirmMetrics.panelClientWidth + 1);
  expect(confirmMetrics.actionsScrollWidth).toBeLessThanOrEqual(confirmMetrics.actionsClientWidth + 1);
});

test('primary mobile controls have comfortable touch targets and help stays readable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openApp(page);

  const controlMetrics = await page.evaluate(() => [
    '#help-btn',
    '#settings-btn',
    '#quick-export-btn',
    '.column-handle',
    '.column-actions button',
    '.add-note-btn'
  ].map((selector) => {
    const element = document.querySelector(selector);
    const rect = element.getBoundingClientRect();
    return { selector, width: rect.width, height: rect.height };
  }));

  for (const metric of controlMetrics) {
    expect(metric.width, `${metric.selector} width`).toBeGreaterThanOrEqual(43.5);
    expect(metric.height, `${metric.selector} height`).toBeGreaterThanOrEqual(43.5);
  }

  await page.locator('#help-btn').click();
  await expect(page.locator('#help-modal')).toBeVisible();
  const helpMetrics = await page.evaluate(() => {
    const panel = document.querySelector('#help-modal .help-panel');
    const body = document.querySelector('#help-modal .help-body');
    const rect = panel.getBoundingClientRect();
    const closeButton = document.querySelector('#close-help-btn');
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      panelScrollWidth: panel.scrollWidth,
      panelClientWidth: panel.clientWidth,
      bodyOverflowY: getComputedStyle(body).overflowY,
      closeWidth: closeButton.offsetWidth,
      closeHeight: closeButton.offsetHeight
    };
  });

  expect(helpMetrics.left).toBeGreaterThanOrEqual(0);
  expect(helpMetrics.right).toBeLessThanOrEqual(helpMetrics.viewportWidth + 1);
  expect(helpMetrics.top).toBeGreaterThanOrEqual(0);
  expect(helpMetrics.bottom).toBeLessThanOrEqual(helpMetrics.viewportHeight + 1);
  expect(helpMetrics.panelScrollWidth).toBeLessThanOrEqual(helpMetrics.panelClientWidth + 1);
  expect(['auto', 'scroll']).toContain(helpMetrics.bodyOverflowY);
  expect(helpMetrics.closeWidth).toBeGreaterThanOrEqual(43.5);
  expect(helpMetrics.closeHeight).toBeGreaterThanOrEqual(43.5);
});

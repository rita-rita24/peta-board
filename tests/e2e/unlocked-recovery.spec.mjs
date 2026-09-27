import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { appUrl, storageKey, corruptBackupKey } from '../helpers/peta-page.mjs';

const origin = 'https://unlocked-recovery.test';
const html = readFileSync(fileURLToPath(appUrl), 'utf8');

for (const failure of ['denied', 'unavailable']) {
  test(`recovery does not write without a lock when startup locking is ${failure}`, async ({ page, context }) => {
    await context.route(`${origin}/**`, (route) => route.fulfill({
      contentType: 'text/html', body: route.request().url().endsWith('/setup') ? '<title>Setup</title>' : html
    }));
    await page.goto(`${origin}/setup`);
    const original = '{"board":';
    await page.evaluate(({ key, backup, original }) => {
      localStorage.setItem(key, original);
      localStorage.setItem(backup, 'older recovery copy');
    }, { key: storageKey, backup: corruptBackupKey, original });
    await page.addInitScript(({ failure }) => {
      const locks = navigator.locks;
      const request = locks.request.bind(locks);
      let locked = false;
      window.recoveryWrites = [];
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        window.recoveryWrites.push({ key, locked });
        return write.call(this, key, value);
      };
      if (failure === 'denied') locks.request = () => Promise.reject(new DOMException('Denied', 'SecurityError'));
      else Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
      window.restoreRecoveryLocks = () => {
        Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
        locks.request = (name, callback) => request(name, async (lock) => {
          locked = true;
          try { return await callback(lock); }
          finally { locked = false; }
        });
      };
    }, { failure });
    await page.goto(origin);
    await expect(page.locator('#storage-status')).toBeVisible();
    expect(await page.evaluate(() => window.recoveryWrites)).toEqual([]);
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(original);
    expect(await page.evaluate((key) => localStorage.getItem(key), corruptBackupKey)).toBe('older recovery copy');
    await expect(page.locator('#storage-original-btn')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.locator('#storage-original-btn').click();
    const chunks = [];
    for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe(original);

    await page.evaluate(() => window.restoreRecoveryLocks());
    await page.locator('#storage-retry-btn').click();
    await expect(page.locator('#save-indicator')).toHaveAttribute('data-state', 'saved');
    const writes = await page.evaluate(() => window.recoveryWrites);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((entry) => entry.locked)).toBe(true);
    expect(await page.evaluate((key) => localStorage.getItem(key), corruptBackupKey)).toBe('older recovery copy');
    expect(await page.evaluate(({ prefix, original }) => Object.keys(localStorage).some((key) => key.startsWith(`${prefix}.`) && localStorage.getItem(key) === original),
      { prefix: corruptBackupKey, original })).toBe(true);
  });
}

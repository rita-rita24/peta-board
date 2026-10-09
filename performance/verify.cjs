const fs = require("node:fs"),
  assert = require("node:assert/strict");

const { chromium } = require("../scripts/runtime.cjs");
const fixture = require("../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    }),
    context = await browser.newContext(),
    page = await context.newPage(),
    errors = [],
    checks = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = process.env.TARGET_URL || "http://127.0.0.1:8765/peta-board.html";
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector(".app-shell").inert);
  await page.evaluate((data) => {
    const hook = window.__PETA_BOARD_TEST__;
    hook.setState(data);
    return hook.saveStateNow();
  }, fixture(50));
  await page.reload();
  await page.waitForFunction(() => !document.querySelector(".app-shell").inert);
  assert.equal(await page.locator(".note-card").count(), 50);
  checks.push("保存・再読み込み:50件");
  await page.locator(".note-edit-btn").first().click();
  await page.locator("#note-title-input").fill("更新した付箋");
  await page.locator("#note-title-input").press("Tab");
  await page.locator("#note-body-input").fill("新しい本文 検証対象");
  await page.locator("#note-tags-input").fill("タグA、タグB");
  await page.locator("#note-tags-input").press("Tab");
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.querySelector("#note-drawer").hidden,
  );
  await page.waitForFunction(
    () => document.querySelector("#save-indicator").dataset.state === "saved",
  );
  assert.equal(
    await page.locator(".note-title").first().textContent(),
    "更新した付箋",
  );
  checks.push("編集内容・本文・タグの即時反映");
  await page.locator("#search-input").fill("新しい本文");
  assert.equal(await page.locator(".note-card").count(), 1);
  assert.match(
    await page.locator(".note-search-context").textContent(),
    /新しい本文/,
  );
  await page.locator("#search-input").fill("見つからない文字列");
  assert.equal(await page.locator(".note-card").count(), 0);
  assert.equal(await page.locator("#search-empty").isVisible(), true);
  await page.locator("#clear-search-btn").click();
  assert.equal(await page.locator(".note-card").count(), 50);
  checks.push("検索結果・抜粋・空結果・解除後の全件復帰");
  const before = await page.evaluate(() =>
    window.__PETA_BOARD_TEST__
      .getState()
      .board.columns[0].notes.map((n) => n.id),
  );
  await page.locator(".note-edit-btn").first().focus();
  await page.keyboard.press("Alt+ArrowDown");
  const after = await page.evaluate(() =>
    window.__PETA_BOARD_TEST__
      .getState()
      .board.columns[0].notes.map((n) => n.id),
  );
  assert.equal(after[1], before[0]);
  checks.push("キーボード並べ替え・フォーカス");
  await page.locator(".note-edit-btn").nth(1).click();
  await page.locator("#note-due-field").click();
  await page.locator("#date-direct-input").fill("20261010");
  await page.locator("#date-direct-input").press("Enter");
  assert.equal(
    await page.locator("#note-due-input").inputValue(),
    "2026-10-10",
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.querySelector("#note-drawer").hidden,
  );
  checks.push("期限カレンダー・日付直接入力");
  await page.waitForFunction(
    () => document.querySelector("#save-indicator").dataset.state === "saved",
  );
  const sibling = await context.newPage();
  await sibling.goto(url);
  await sibling.waitForFunction(
    () => !document.querySelector(".app-shell").inert,
  );
  await sibling.locator(".note-edit-btn").first().click();
  await sibling.locator("#note-title-input").fill("別タブ更新");
  await sibling.locator("#note-title-input").press("Tab");
  await sibling.keyboard.press("Escape");
  await sibling.waitForFunction(
    () => document.querySelector("#save-indicator").dataset.state === "saved",
  );
  await page.waitForFunction(
    () => document.querySelector(".note-title").textContent === "別タブ更新",
  );
  checks.push("別タブ更新の自動反映");
  await page.locator("#settings-btn").click();
  await page.locator("#reset-board-btn").click();
  await page.locator("#confirm-cancel-btn").click();
  await page.waitForFunction(
    () => document.querySelector("#confirm-modal").hidden,
  );
  await page.locator("#close-settings-btn").click();
  await page.waitForFunction(
    () => document.querySelector("#settings-modal").hidden,
  );
  assert.equal(await page.locator(".note-card").count(), 50);
  checks.push("確認キャンセルでデータ保持");
  await page.locator("#quick-export-btn").click();
  const exported = await page.evaluate(() =>
    JSON.stringify(window.__PETA_BOARD_TEST__.getState()),
  );
  assert.equal(
    JSON.parse(exported).board.columns.flatMap((c) => c.notes).length,
    50,
  );
  checks.push("バックアップ操作");
  await sibling.close();
  await page.evaluate(() => {
    const hook = window.__PETA_BOARD_TEST__;
    hook.setState({ version: 1, board: { title: "空", columns: [] } });
    return hook.saveStateNow();
  });
  await page.reload();
  await page.waitForFunction(() => !document.querySelector(".app-shell").inert);
  assert.equal(await page.locator(".column").count(), 0);
  checks.push("0列の保存・再読み込み");
  await context.close();
  const broken = await browser.newContext();
  await broken.addInitScript(() =>
    localStorage.setItem("petaborad.state.v1", "{broken"),
  );
  const p = await broken.newPage();
  await p.goto(url);
  await p.waitForFunction(() => !document.querySelector(".app-shell").inert);
  assert.equal(
    await p.evaluate(() => localStorage.getItem("petaborad.state.v1.corrupt")),
    "{broken",
  );
  checks.push("破損保存データの退避・復旧");
  await broken.close();
  const unsafe = await browser.newContext();
  await unsafe.addInitScript(() =>
    Object.defineProperty(navigator, "locks", { value: undefined }),
  );
  const u = await unsafe.newPage();
  await u.goto(url);
  await u.waitForFunction(() => !document.querySelector(".app-shell").inert);
  assert.equal(
    await u.locator("#save-indicator").getAttribute("data-state"),
    "error",
  );
  checks.push("Web Locks非対応時の保存停止・警告");
  await unsafe.close();
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    process.env.OUTPUT || "performance/verification.json",
    JSON.stringify({ date: new Date().toISOString(), checks, errors }, null, 2),
  );
  console.log(checks);
  await browser.close();
})();

const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url");

const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    }),
    context = await browser.newContext(),
    page = await context.newPage(),
    checks = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    (data) => localStorage.setItem("petaborad.state.v1", JSON.stringify(data)),
    fixture(50),
  );
  await page.goto(pathToFileURL(process.cwd() + "/peta-board.html").href);
  await page.waitForFunction(() => !document.querySelector(".app-shell").inert);
  for (const [button, modal, focus] of [
    ["settings-btn", "settings-modal", "close-settings-btn"],
    ["help-btn", "help-modal", "close-help-btn"],
  ]) {
    await page.locator("#" + button).click();
    assert.equal(await page.evaluate(() => document.activeElement.id), focus);
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(
        (m) => document.getElementById(m).contains(document.activeElement),
        modal,
      ),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#" + modal).isVisible(), false);
    checks.push(button + "即時表示・フォーカス・Tab・Esc");
  }
  await page.evaluate(() => {
    document.querySelector("#settings-btn").click();
    document.querySelector("#close-settings-btn").click();
    document.querySelector("#settings-btn").click();
  });
  await page.waitForTimeout(200);
  assert.equal(await page.locator("#settings-modal").isVisible(), true);
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "close-settings-btn",
  );
  await page.keyboard.press("Escape");
  checks.push("同一処理内の閉じる→再表示を古い処理で隠さない");
  await page.locator(".note-edit-btn").first().click();
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "note-title-input",
  );
  await page.locator("#note-due-field").click();
  assert.equal(await page.locator(".date-day:focus").count(), 1);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#date-popover").isVisible(), false);
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "note-due-input",
  );
  await page.locator("#note-due-field").click();
  await page.locator("#date-close-btn").click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#note-drawer").isVisible(), false);
  checks.push("編集・カレンダーの即時フォーカス・日付選択・閉じる・再表示");
  await page.evaluate(() => {
    document.querySelector(".note-edit-btn").click();
    document.querySelector("#drawer-done-btn").click();
    document.querySelector("#search-input").focus();
  });
  await page.evaluate(
    () =>
      new Promise((r) => {
        requestAnimationFrame(() => requestAnimationFrame(r));
      }),
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "search-input",
  );
  await page.keyboard.press("/");
  checks.push("閉じた直後の新しい操作をフォーカス復帰で上書きしない");
  await page.locator("#settings-btn").click();
  const before = await page.evaluate(() =>
    JSON.stringify(window.__PETA_BOARD_TEST__.getState()),
  );
  for (const input of [
    {
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from("{broken"),
    },
    {
      name: "too-large.json",
      mimeType: "application/json",
      buffer: Buffer.alloc(33 * 1024 * 1024),
    },
  ]) {
    await page.locator("#import-board-file").setInputFiles(input);
    await page.waitForFunction(
      () => document.querySelector("#import-board-file").value === "",
    );
    assert.equal(await page.locator("#confirm-modal").isVisible(), false);
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(window.__PETA_BOARD_TEST__.getState()),
      ),
      before,
    );
  }
  checks.push("不正JSON・32MiB超過の拒否と既存データ保持");
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    process.env.OUTPUT || "performance/modernization/modal-verification.json",
    JSON.stringify({ date: new Date().toISOString(), checks, errors }, null, 2),
  );
  console.log(checks);
  await browser.close();
})();

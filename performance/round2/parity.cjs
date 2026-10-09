const fs = require("node:fs");

const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH,
  });
  const versions = [];
  for (const file of ["performance/round2/before.html", "peta-board.html"]) {
    const context = await browser.newContext(),
      page = await context.newPage();
    await page.addInitScript(
      (data) =>
        localStorage.setItem("petaborad.state.v1", JSON.stringify(data)),
      fixture(500),
    );
    await page.goto(
      require("node:url").pathToFileURL(require("node:path").resolve(file))
        .href,
    );
    await page.waitForFunction(
      () => !document.querySelector(".app-shell").inert,
    );
    const snapshots = [];
    async function snapshot(label) {
      await page.evaluate(
        () =>
          new Promise((r) => {
            requestAnimationFrame(() => requestAnimationFrame(r));
          }),
      );
      snapshots.push({
        label,
        ...(await page.evaluate(() => ({
          summary: document.querySelector("#board-summary").textContent,
          cards: [...document.querySelectorAll(".note-card")].map((c) => ({
            id: c.dataset.noteId,
            col: c.dataset.columnId,
            text: c.textContent,
            marks: [...c.querySelectorAll("mark")].map((m) => m.textContent),
            rect: {
              width: Math.round(c.getBoundingClientRect().width * 100) / 100,
              height: Math.round(c.getBoundingClientRect().height * 100) / 100,
            },
          })),
        }))),
      });
    }
    await snapshot("initial");
    for (const q of [
      "検証対象 abc",
      "abc 検証対象",
      "付箋1",
      "İ",
      "検証対象",
      "",
    ]) {
      await page.locator("#search-input").fill(q);
      await snapshot("search " + q);
    }
    await page.locator(".note-edit-btn").first().click();
    await page.locator("#note-title-input").fill("更新後の検索対象");
    await page.locator("#note-title-input").press("Tab");
    await page.locator("#note-body-input").fill("body 更新 検証対象");
    await page.locator("#note-body-input").press("Tab");
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.querySelector("#note-drawer").hidden,
    );
    await snapshot("edited");
    for (const q of ["更新", "検証対象", ""]) {
      await page.locator("#search-input").fill(q);
      await snapshot("edited search " + q);
    }
    await page.locator(".note-edit-btn").first().focus();
    await page.keyboard.press("Alt+ArrowDown");
    await snapshot("reordered");
    await page.locator("#search-input").fill("検証対象");
    await page.locator(".column-title").first().fill("変更した列");
    await page.locator(".column-title").first().press("Tab");
    await snapshot("column-renamed");
    versions.push(snapshots);
    await context.close();
  }
  if (JSON.stringify(versions[0]) !== JSON.stringify(versions[1]))
    throw Error("content/order/highlight/geometry mismatch");
  fs.writeFileSync(
    "performance/round2/parity.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        cases: versions[0].map((s) => ({
          label: s.label,
          count: s.cards.length,
        })),
        equal: true,
      },
      null,
      2,
    ),
  );
  console.log("all " + versions[0].length + " snapshots identical");
  await browser.close();
})();

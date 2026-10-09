import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  { chromium } = require("./runtime.cjs"),
  fixture = require("./fixture.cjs");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});
const rows = [],
  errors = [];
try {
  for (const count of [50, 500])
    for (let run = 0; run < 5; run++) {
      const context = await browser.newContext({
        viewport: { width: 375, height: 900 },
        timezoneId: "Asia/Tokyo",
      });
      try {
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push(error.message));
        await page.clock.install({
          time: new Date("2026-10-09T23:59:00+09:00"),
        });
        await page.addInitScript(
          (data) =>
            localStorage.setItem("petaborad.state.v1", JSON.stringify(data)),
          fixture(count),
        );
        await page.goto(pathToFileURL(resolve("peta-board.html")).href);
        await page.waitForFunction(
          () =>
            document.querySelector("#save-indicator").dataset.state === "saved",
        );
        await page.locator(".note-edit-btn").first().click();
        await page.locator("#note-due-field").click();
        await page.clock.pauseAt(new Date("2026-10-09T23:59:59+09:00"));
        const snapshot = () =>
          page.evaluate(() => ({
            state: window.__PETA_BOARD_TEST__.getState(),
            due: document.querySelector(".due-pill").textContent,
            month: document.querySelector("#date-popover-title").textContent,
            today: [...document.querySelectorAll(".date-day.is-today")].map(
              (el) => el.dataset.date,
            ),
            selected: [
              ...document.querySelectorAll(".date-day.is-selected"),
            ].map((el) => el.dataset.date),
            focus:
              document.activeElement.dataset.date || document.activeElement.id,
          }));
        const before = await snapshot();
        assert(before.due.includes("8日遅れ"));
        await page.clock.fastForward(2000);
        const after = await snapshot();
        assert(after.due.includes("9日遅れ"));
        assert.deepEqual(after.state, before.state);
        assert.equal(after.month, before.month);
        assert.deepEqual(after.selected, before.selected);
        assert.equal(after.focus, before.focus);
        assert.deepEqual(before.today, ["2026-10-09"]);
        assert.deepEqual(after.today, ["2026-10-10"]);
        rows.push({
          count,
          run,
          correct: true,
          selectionPreserved: true,
          focusPreserved: true,
          statePreserved: true,
        });
      } finally {
        await context.close();
      }
    }
  assert.deepEqual(errors, []);
  await writeFile(
    process.env.OUTPUT || "performance/followup/midnight.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        version: createHash("sha256")
          .update(await readFile("peta-board.html"))
          .digest("hex"),
        definition:
          "Actual distribution file in isolated contexts; Playwright virtual clock crosses JST midnight. Verify real scheduled callback changes due-day label and calendar today while state/month/selection/focus stay unchanged. Five trials each50/500notes,375x900. Virtual-clock correctness only, no real elapsed-time performance claim.",
        rows,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Midnight callback:", rows.length, "passed");
} finally {
  await browser.close();
}

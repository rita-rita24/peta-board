import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require("./runtime.cjs");
const fixture = require("./fixture.cjs");
const directory = await mkdtemp(join(tmpdir(), "peta-history-"));
const html = await readFile(process.env.SOURCE || "peta-board.html");
const target = join(directory, "board.html");
await writeFile(target, html);
const url = process.env.PRODUCTION_URL || pathToFileURL(target).href;
const output = process.env.OUTPUT || "performance/round4/history.json";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});
const rows = [],
  errors = [];
try {
  for (const width of [375, 1440])
    for (const count of [50, 500])
      for (let run = 0; run < 5; run++) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          timezoneId: "Asia/Tokyo",
        });
        context.setDefaultTimeout(15000);
        try {
          const page = await context.newPage();
          page.on("pageerror", (error) => errors.push(error.message));
          await page.addInitScript((data) => {
            if (location.protocol === "about:") return;
            if (!localStorage.getItem("petaborad.state.v1"))
              localStorage.setItem("petaborad.state.v1", JSON.stringify(data));
          }, fixture(count));
          await page.goto(url);
          async function saved() {
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator")?.dataset.state ===
                "saved",
            );
          }
          await saved();
          for (let cycle = 0; cycle < 5; cycle++) {
            await page
              .locator(".column-title")
              .first()
              .fill(`履歴検証${run}-${cycle}`);
            await saved();
            const expected = await page.evaluate(() =>
              window.__PETA_BOARD_TEST__.getState(),
            );
            await page.goto("about:blank");
            const start = Date.now();
            await page.goBack();
            try {
              await saved();
            } catch (error) {
              rows.push({
                width,
                count,
                run,
                cycle,
                failed: true,
                diagnostic: await page.evaluate(() => ({
                  url: location.href,
                  indicator:
                    document.querySelector("#save-indicator")?.outerHTML,
                  issue: document.querySelector("#storage-status-message")
                    ?.textContent,
                  state: window.__PETA_BOARD_TEST__?.getState(),
                  stored: localStorage.getItem("petaborad.state.v1"),
                })),
                expected,
              });
              throw error;
            }
            const backControllerMs = Date.now() - start;
            assert.deepEqual(
              await page.evaluate(() => window.__PETA_BOARD_TEST__.getState()),
              expected,
            );
            await page.goForward();
            assert.equal(page.url(), "about:blank");
            const forwardControllerMs = Date.now() - start - backControllerMs;
            await page.goBack();
            await saved();
            assert.deepEqual(
              await page.evaluate(() => window.__PETA_BOARD_TEST__.getState()),
              expected,
            );
            rows.push({
              width,
              count,
              run,
              cycle,
              backControllerMs,
              forwardControllerMs,
              statePreserved: true,
            });
          }
          console.log("History", width, count, run, "5 cycles passed");
        } finally {
          await context.close();
        }
      }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    output,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        version: createHash("sha256").update(html).digest("hex"),
        url,
        definition:
          "Five independent contexts per 375/1440px,50/500notes; five edit/save/back/forward/back cycles per context. Exact saved state after both back navigations. Controller timing includes automation and polling, not physical input/paint. Capture failed saved-indicator wait with state and storage; never suppress failure.",
        rows,
        errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}

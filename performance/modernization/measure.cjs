const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
const source = process.argv[2];
const output = process.argv[3];
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "peta-modern-"));
const target = path.join(temporary, "board.html");
fs.copyFileSync(source, target);
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH,
  });
  const rows = [];
  const errors = [];
  try {
    for (const width of [375, 1440])
      for (const n of [50, 500])
        for (const filtered of [false, true])
          for (let run = 0; run < 5; run++) {
            const context = await browser.newContext({
              viewport: { width, height: 900 },
            });
            const page = await context.newPage();
            page.on("pageerror", (error) => errors.push(error.message));
            const data = fixture(n);
            data.board.columns = [
              {
                id: "c0",
                title: "列0",
                notes: data.board.columns.flatMap((column) => column.notes),
              },
            ];
            for (const note of data.board.columns[0].notes)
              note.title = "共通 " + note.id;
            await page.addInitScript(
              (data) =>
                localStorage.setItem(
                  "petaborad.state.v1",
                  JSON.stringify(data),
                ),
              data,
            );
            await page.goto(pathToFileURL(target).href);
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            if (filtered) await page.locator("#search-input").fill("共通");
            await page.locator(".note-edit-btn").first().click();
            for (const field of ["title", "body", "checklist"]) {
              const metrics = await page.evaluate(
                async ({ field, filtered }) => {
                  const selector =
                    field === "title"
                      ? "#note-title-input"
                      : field === "body"
                        ? "#note-body-input"
                        : '#checklist input[type="text"]';
                  const input = document.querySelector(selector);
                  input.focus();
                  const samples = [];
                  for (let step = 0; step < 8; step++) {
                    await new Promise((resolve) => {
                      requestAnimationFrame(() =>
                        requestAnimationFrame(resolve),
                      );
                    });
                    const start = performance.now();
                    input.value =
                      (field === "title" ? "変更後" : "編集内容") + step;
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                    const handler = performance.now() - start;
                    await new Promise((resolve) => {
                      requestAnimationFrame(() =>
                        requestAnimationFrame(resolve),
                      );
                    });
                    samples.push({
                      handler,
                      frameReady: performance.now() - start,
                    });
                  }
                  return {
                    samples,
                    cards: document.querySelectorAll(".note-card").length,
                    summary:
                      document.querySelector("#board-summary").textContent,
                  };
                },
                { field, filtered },
              );
              assert.equal(metrics.cards, filtered ? n - 1 : n);
              rows.push({ width, n, filtered, run, field, ...metrics });
            }
            await page.keyboard.press("Escape");
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );

            await page.evaluate(
              () => window.__PETA_BOARD_TEST__.getState().board,
            );
            // Disable fixture reset for reload.
            await page.evaluate(() =>
              localStorage.setItem("modern-fixture-ready", "1"),
            );
            await context.close();
            console.log(width, n, filtered, run, "done");
            fs.writeFileSync(
              output,
              JSON.stringify(
                {
                  date: new Date().toISOString(),
                  source,
                  version: crypto
                    .createHash("sha256")
                    .update(fs.readFileSync(source))
                    .digest("hex"),
                  browser: browser.version(),
                  viewportHeight: 900,
                  repeats: 5,
                  definition:
                    "One dense column, 50/500 notes. Search 共通 matches all titles; edited first title removes its result. Each field has 8 synchronous input events with two rAF settling. Handler measures synchronous processing; frameReady is a frame proxy, not actual paint or INP. Independent contexts. No artificial throttling.",
                  rows,
                  errors,
                },
                null,
                2,
              ),
            );
          }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})();

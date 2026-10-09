import assert from "node:assert/strict";
import { readFile, writeFile, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("./runtime.cjs");
const fixture = require("./fixture.cjs");
const sources = process.env.PRODUCTION_ONLY
  ? ["peta-board.html"]
  : process.env.BASELINE_ONLY
    ? ["performance/followup/before.html"]
    : ["performance/followup/before.html", "peta-board.html"];
const temporary = await mkdtemp(join(tmpdir(), "peta-column-"));
const target = join(temporary, "board.html");
const rows = [];
const errors = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});
try {
  for (const width of [375, 1440])
    for (const count of [50, 500])
      for (let run = 0; run < 5; run++) {
        for (const source of run % 2 ? sources.toReversed() : sources) {
          await copyFile(source, target);
          const context = await browser.newContext({
            viewport: { width, height: 900 },
          });
          context.setDefaultTimeout(15000);
          try {
            const page = await context.newPage();
            page.on("pageerror", (error) => errors.push(error.message));
            const data = fixture(count);
            data.board.columns = [
              {
                id: "c0",
                title: "列0",
                notes: data.board.columns.flatMap((column) => column.notes),
              },
            ];
            await page.addInitScript((data) => {
              if (!localStorage.getItem("petaborad.state.v1"))
                localStorage.setItem(
                  "petaborad.state.v1",
                  JSON.stringify(data),
                );
            }, data);
            await page.goto(
              process.env.PRODUCTION_URL || pathToFileURL(target).href,
            );
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            await page.locator("#search-input").fill("検証");
            await page.locator(".column-title").focus();
            for (let step = 0; step < 8; step++) {
              const sample = await page.evaluate(
                async ({ step }) => {
                  const input = document.querySelector(".column-title");
                  const list = document.querySelector(".note-list");
                  list.scrollTop = 120;
                  const scroll = list.scrollTop;
                  await new Promise((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(resolve));
                  });
                  const cards = [...list.querySelectorAll(".note-card")];
                  input.value = "更新" + step;
                  input.setSelectionRange(1, 1);
                  const start = performance.now();
                  input.dispatchEvent(
                    new InputEvent("input", { bubbles: true }),
                  );
                  const handler = performance.now() - start;
                  await new Promise((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(resolve));
                  });
                  return {
                    handler,
                    frameReady: performance.now() - start,
                    cards: list.querySelectorAll(".note-card").length,
                    retained: cards.filter((card) => card.isConnected).length,
                    title:
                      window.__PETA_BOARD_TEST__.getState().board.columns[0]
                        .title,
                    selection: [input.selectionStart, input.selectionEnd],
                    focus: document.activeElement === input,
                    scrollPreserved: list.scrollTop === scroll,
                  };
                },
                { step },
              );
              assert.equal(sample.cards, count);
              assert.equal(sample.title, "更新" + step);
              assert.deepEqual(sample.selection, [1, 1]);
              assert.equal(sample.focus, true);
              assert.equal(sample.scrollPreserved, true);
              rows.push({ source, width, count, run, step, ...sample });
            }
            // Membership changes must remove and reinsert the same notes in canonical order.
            const order = data.board.columns[0].notes.map((note) => note.id);
            await page.locator("#search-input").fill("更新7");
            assert.equal(await page.locator(".note-card").count(), count);
            await page.locator(".column-title").fill("不一致");
            assert.equal(await page.locator(".note-card").count(), 0);
            assert.equal(
              await page.locator(".column-empty").textContent(),
              "一致なし",
            );
            await page.locator(".column-title").fill("更新7");
            assert.deepEqual(
              await page
                .locator(".note-card")
                .evaluateAll((cards) =>
                  cards.map((card) => card.dataset.noteId),
                ),
              order,
            );
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            await page.reload();
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            assert.equal(
              await page.locator(".column-title").inputValue(),
              "更新7",
            );
          } finally {
            await context.close();
          }
          console.log(width, count, run, source);
        }
      }
  assert.deepEqual(errors, []);
  const versions = Object.fromEntries(
    await Promise.all(
      sources.map(async (source) => [
        source,
        createHash("sha256")
          .update(await readFile(source))
          .digest("hex"),
      ]),
    ),
  );
  await writeFile(
    process.env.PRODUCTION_ONLY
      ? "performance/followup/production-column.json"
      : process.env.BASELINE_ONLY
        ? "performance/followup/column-baseline.json"
        : "performance/followup/column-search.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        productionUrl: process.env.PRODUCTION_URL || null,
        versions,
        definition:
          "50/500 notes, dense single column, 375/1440x900, five independent contexts per source, AB/BA source order, eight synthetic input events/trial. handler synchronous; frameReady two rAF proxy. Search 検証 matches all tags. Membership removal/reinsertion, focus, selection, scroll, reload verified. No physical paint/INP claim.",
        rows,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}

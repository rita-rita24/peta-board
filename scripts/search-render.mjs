import assert from "node:assert/strict";
import { readFile, writeFile, copyFile, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const engines = require("./runtime.cjs");
const engine = process.env.BROWSER || "chromium";
const fixture = require("./fixture.cjs");
const directory = process.env.EVIDENCE_DIR || "performance/round7";
const productionOnly = Boolean(process.env.PRODUCTION_ONLY);
const sources = productionOnly
  ? ["peta-board.html"]
  : [
      process.env.BASELINE_SOURCE || `${directory}/before.html`,
      process.env.AFTER_SOURCE || "peta-board.html",
    ];
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
const temporary = productionOnly
  ? null
  : await mkdtemp(join(tmpdir(), "peta-search-render-"));
const target = productionOnly
  ? resolve("peta-board.html")
  : join(temporary, "board.html");
const rows = [],
  errors = [],
  comparisons = new Map();
let browser;
try {
  browser = await engines[engine].launch({
    headless: true,
    ...(engine === "chromium" && process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
  for (const width of [375, 1440])
    for (const count of [50, 500])
      for (let run = 0; run < 5; run++) {
        for (const source of run % 2 ? sources.toReversed() : sources) {
          if (!productionOnly) await copyFile(source, target);
          const context = await browser.newContext({
            viewport: { width, height: 900 },
          });
          context.setDefaultTimeout(15000);
          try {
            const page = await context.newPage();
            page.on("pageerror", (error) => errors.push(error.message));
            await page.addInitScript(
              (data) =>
                localStorage.setItem(
                  "petaborad.state.v1",
                  JSON.stringify(data),
                ),
              fixture(count),
            );
            await page.goto(pathToFileURL(target).href);
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            await page.locator("#search-input").focus();
            const samples = await page.evaluate(
              async ({ allowClippedClass }) => {
                const frame = () =>
                  new Promise((resolve) => {
                    requestAnimationFrame(resolve);
                  });
                const input = document.querySelector("#search-input");
                const result = [];
                for (const query of [
                  "付箋1",
                  "通常",
                  "一致しない語",
                  "",
                  "検証",
                ]) {
                  const shell =
                    document.querySelector("#kanban-board").parentElement;
                  shell.scrollLeft = 250;
                  for (const list of document.querySelectorAll(".note-list"))
                    list.scrollTop = 100;
                  await frame();
                  await frame();
                  input.value = query;
                  const start = performance.now();
                  input.dispatchEvent(
                    new InputEvent("input", { bubbles: true }),
                  );
                  const handler = performance.now() - start;
                  await frame();
                  await frame();
                  result.push({
                    query,
                    handler,
                    resultProxy: performance.now() - start,
                    markup: allowClippedClass
                      ? document
                          .querySelector("#kanban-board")
                          .innerHTML.replaceAll(
                            /class="note-list(?: has-(?:clipped|contained)-rows)+"/g,
                            'class="note-list"',
                          )
                      : document.querySelector("#kanban-board").innerHTML,
                    geometry: [
                      ...document.querySelectorAll(
                        ".column,.note-list,.note-card,.note-card>*",
                      ),
                    ]
                      .map((element) => {
                        const rect = element.getBoundingClientRect();
                        return [
                          element.className,
                          rect.x,
                          rect.y,
                          rect.width,
                          rect.height,
                        ];
                      })
                      .map((row) => {
                        if (allowClippedClass)
                          row[0] = row[0].replaceAll(
                            / has-(?:clipped|contained)-rows/g,
                            "",
                          );
                        return row;
                      }),
                    summary:
                      document.querySelector("#board-summary").textContent,
                    focus: document.activeElement.id,
                    selection: [input.selectionStart, input.selectionEnd],
                    scroll: [
                      shell.scrollLeft,
                      shell.scrollTop,
                      ...[...document.querySelectorAll(".note-list")].map(
                        (list) => list.scrollTop,
                      ),
                    ],
                    ids: [...document.querySelectorAll(".note-card")].map(
                      (card) => card.dataset.noteId,
                    ),
                    board: window.__PETA_BOARD_TEST__.getState().board,
                  });
                }
                return result;
              },
              { allowClippedClass: Boolean(process.env.ALLOW_CLIPPED_CLASS) },
            );
            for (const sample of samples) {
              const { handler, resultProxy, ...behavior } = sample;
              const key = JSON.stringify([width, count, run, sample.query]);
              if (comparisons.has(key))
                assert.deepEqual(behavior, comparisons.get(key), key);
              else comparisons.set(key, behavior);
              rows.push({
                source,
                width,
                count,
                run,
                query: sample.query,
                handler,
                resultProxy,
                cards: sample.ids.length,
                behaviorSha256: createHash("sha256")
                  .update(JSON.stringify(behavior))
                  .digest("hex"),
              });
            }
            await page.reload();
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            assert.equal(await page.locator(".note-card").count(), count);
          } finally {
            await context.close();
          }
        }
      }
  assert.deepEqual(errors, []);
  await writeFile(
    process.env.OUTPUT || `${directory}/search-render.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        versions,
        allowedDifference: process.env.ALLOW_CLIPPED_CLASS
          ? "Only has-clipped-rows/has-contained-rows markers; all visible rectangles, text/markup, focus/scroll/state still compare exactly"
          : null,
        runnerSha256: createHash("sha256")
          .update(await readFile(new URL(import.meta.url)))
          .digest("hex"),
        url: pathToFileURL(target).href,
        productionOnly,
        definition: productionOnly
          ? "Actual local distribution file URL, five isolated contexts/condition; synthetic input CPU and correct-result-plus-two-rAF proxies. Sequential queries and warmup order fixed. No paired production rate without separate before and after datasets."
          : "Same temporary file URL, AB/BA five independent contexts/condition. Five distinct sequential queries: matching title, body, no match, clear, all matching tags. Synchronous synthetic input CPU and correct result plus two rAF differ; no physical input/display. Full board markup, summary, focus, input selection, all list/shell scroll, visible IDs and full board state match before/after; reload restores all cards.",
        rows,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await browser?.close();
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

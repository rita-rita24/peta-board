import assert from "node:assert/strict";
import { copyFile, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
const require = createRequire(import.meta.url);
const { chromium } = require("./runtime.cjs");
const fixture = require("./fixture.cjs");
const sources = process.env.PRODUCTION_ONLY
  ? ["peta-board.html"]
  : [
      process.env.BASELINE_SOURCE || "performance/followup/before.html",
      "peta-board.html",
    ];
const evidenceDirectory = process.env.EVIDENCE_DIR || "performance/followup";
const output =
  process.env.OUTPUT ||
  `${evidenceDirectory}/${process.env.PRODUCTION_ONLY ? "production-operations" : "remaining-operations"}.json`;
const temporary = await mkdtemp(join(tmpdir(), "peta-remaining-"));
const target = join(temporary, "board.html");
const rows = [],
  errors = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});
try {
  for (const width of (process.env.WIDTHS || "375,1440").split(",").map(Number))
    for (const count of (process.env.COUNTS || "50,500").split(",").map(Number))
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
            await page.addInitScript((data) => {
              if (!localStorage.getItem("petaborad.state.v1"))
                localStorage.setItem(
                  "petaborad.state.v1",
                  JSON.stringify(data),
                );
            }, fixture(count));
            await page.goto(
              process.env.PRODUCTION_URL || pathToFileURL(target).href,
            );
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            const traceEvents = [];
            const session = process.env.TRACE_OPERATIONS
              ? await context.newCDPSession(page)
              : null;
            if (session) {
              session.on("Tracing.dataCollected", ({ value }) =>
                traceEvents.push(...value),
              );
              await session.send("Tracing.start", {
                categories: "devtools.timeline,blink.user_timing",
                transferMode: "ReportEvents",
              });
            }
            const firstRow = rows.length;
            let actionIndex = 0;
            async function action(
              operation,
              selector,
              type = "click",
              value = null,
              save = false,
            ) {
              const sample = await page.evaluate(
                async ({ selector, type, value, save, mark }) => {
                  await new Promise((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(resolve));
                  });
                  const element = document.querySelector(selector);
                  const start = performance.now();
                  if (mark) performance.mark(mark);
                  const disabled = Boolean(element.disabled);
                  if (type === "input") {
                    element.value = value;
                    element.dispatchEvent(
                      new InputEvent("input", { bubbles: true }),
                    );
                  } else if (type === "tooltip")
                    element.dispatchEvent(
                      new PointerEvent("pointerover", { bubbles: true }),
                    );
                  else if (type === "key")
                    element.dispatchEvent(
                      new KeyboardEvent("keydown", {
                        key: value,
                        bubbles: true,
                      }),
                    );
                  else element.click();
                  const handler = performance.now() - start;
                  await new Promise((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(resolve));
                  });
                  const frameReady = performance.now() - start;
                  let savedMs = null;
                  if (save) {
                    await new Promise((resolve, reject) => {
                      function check() {
                        const state =
                          document.querySelector("#save-indicator").dataset
                            .state;
                        if (state === "saved") resolve();
                        else if (
                          state === "error" ||
                          performance.now() - start > 10000
                        )
                          reject(new Error("Save failed"));
                        else requestAnimationFrame(check);
                      }
                      check();
                    });
                    savedMs = performance.now() - start;
                  }
                  const state = window.__PETA_BOARD_TEST__.getState();
                  return {
                    mark,
                    disabled,
                    handler,
                    frameReady,
                    savedMs,
                    boardTitle: state.board.title,
                    theme: state.theme,
                    defaultColor: state.settings.defaultColor,
                    dueDate: state.board.columns[0].notes[0].dueDate,
                    detailsOpen: document.querySelector(".help-details").open,
                    month: document.querySelector("#date-popover-title")
                      .textContent,
                    tooltipVisible: document
                      .querySelector("#tooltip")
                      .classList.contains("is-visible"),
                    cards: document.querySelectorAll(".note-card").length,
                    focus: document.activeElement.id,
                  };
                },
                {
                  selector,
                  type,
                  value,
                  save,
                  mark: session ? `operation-${actionIndex++}` : null,
                },
              );
              rows.push({ source, width, count, run, operation, ...sample });
              return sample;
            }
            assert.equal(
              (await action("テーマ切替", "#theme-btn", "click", null, true))
                .theme,
              "dark",
            );
            await page.locator("#settings-btn").click();
            assert.equal(
              (
                await action(
                  "ボード名編集",
                  "#board-name-input",
                  "input",
                  "更新したボード",
                  true,
                )
              ).boardTitle,
              "更新したボード",
            );
            assert.equal(
              (
                await action(
                  "初期色変更",
                  '#default-color-grid [data-color-id="mint"]',
                  "click",
                  null,
                  true,
                )
              ).defaultColor,
              "mint",
            );
            await page.locator("#close-settings-btn").click();
            await page.locator("#help-btn").click();
            assert.equal(
              (await action("ヘルプ補足展開", ".help-details summary"))
                .detailsOpen,
              true,
            );
            await action("ヘルプ補足収納", ".help-details summary");
            await page.locator("#close-help-btn").click();
            await action("検索ショートカット", "body", "key", "/");
            assert.equal(
              await page
                .locator("#search-input")
                .evaluate((el) => el === document.activeElement),
              true,
            );
            await page.locator(".note-edit-btn").first().click();
            await page.locator("#note-due-field").click();
            const month = await page
              .locator("#date-popover-title")
              .textContent();
            assert.notEqual(
              (await action("カレンダー次月", "#date-next-month-btn")).month,
              month,
            );
            assert.equal(
              (await action("カレンダー前月", "#date-prev-month-btn")).month,
              month,
            );
            const today = await page.evaluate(() => {
              const d = new Date();
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            });
            assert.equal(
              (
                await action(
                  "期限を今日に設定",
                  "#date-today-btn",
                  "click",
                  null,
                  true,
                )
              ).dueDate,
              today,
            );
            await page.locator("#note-due-field").click();
            assert.equal(
              (await action("期限解除", "#date-clear-btn", "click", null, true))
                .dueDate,
              "",
            );
            await page.keyboard.press("Escape");
            assert.equal(
              (await action("ツールチップ表示", "#theme-btn", "tooltip"))
                .tooltipVisible,
              true,
            );
            let expectedCards = count;
            if (process.env.MORE_OPERATIONS) {
              const hiddenMs = await page.evaluate(async () => {
                const start = performance.now();
                window.dispatchEvent(new Event("resize"));
                await new Promise((resolve) => {
                  const check = () =>
                    document.querySelector("#tooltip").hidden
                      ? resolve()
                      : requestAnimationFrame(check);
                  check();
                });
                return performance.now() - start;
              });
              rows.push({
                source,
                width,
                count,
                run,
                operation: "ツールチップ非表示",
                hiddenMs,
              });
              await page
                .locator('.note-card[data-note-id="n0"] .note-edit-btn')
                .click();
              const getColumns = () =>
                page.evaluate(
                  () => window.__PETA_BOARD_TEST__.getState().board.columns,
                );
              const findFirst = (columns) =>
                columns
                  .flatMap((column) => column.notes)
                  .find((note) => note.id === "n0");
              await action(
                "付箋色変更",
                '#note-color-grid [data-color-id="mint"]',
                "click",
                null,
                true,
              );
              assert.equal(findFirst(await getColumns()).color, "mint");
              const beforeChecks = findFirst(await getColumns()).checklist;
              await action(
                "チェック項目削除",
                "#checklist .check-row button:last-child",
                "click",
                null,
                true,
              );
              assert.equal(
                findFirst(await getColumns()).checklist.length,
                beforeChecks.length - 1,
              );
              await action(
                "チェック項目復元",
                "#checklist-undo-btn",
                "click",
                null,
                true,
              );
              assert.deepEqual(
                findFirst(await getColumns()).checklist,
                beforeChecks,
              );
              await action(
                "付箋を下へ移動",
                "#note-down-btn",
                "click",
                null,
                true,
              );
              assert.equal((await getColumns())[0].notes[1].id, "n0");
              await action(
                "付箋を上へ移動",
                "#note-up-btn",
                "click",
                null,
                true,
              );
              assert.equal((await getColumns())[0].notes[0].id, "n0");
              await action(
                count === 500 ? "付箋複製の上限入口無効" : "付箋複製",
                "#duplicate-note-btn",
                "click",
                null,
                count !== 500,
              );
              expectedCards += count === 500 ? 0 : 1;
              assert.equal(
                await page.locator("#duplicate-note-btn").isDisabled(),
                count === 500,
              );
              assert.equal(
                (await getColumns()).flatMap((column) => column.notes).length,
                expectedCards,
              );
              const beforeDelete = await getColumns();
              await action("付箋削除の確認", "#delete-note-btn");
              await action("付箋削除の取消", "#confirm-cancel-btn");
              assert.deepEqual(await getColumns(), beforeDelete);
              await page.locator("#delete-note-btn").click();
              await action(
                "付箋削除の確定",
                "#confirm-ok-btn",
                "click",
                null,
                true,
              );
              assert.equal(
                (await getColumns()).flatMap((column) => column.notes).length,
                expectedCards - 1,
              );
              assert.equal(
                await page.locator(".add-note-btn:disabled").count(),
                0,
              );
              await action(
                "付箋削除の復元",
                "#deletion-undo-btn",
                "click",
                null,
                true,
              );
              assert.deepEqual(await getColumns(), beforeDelete);
              assert.equal(
                await page.locator(".add-note-btn:disabled").count(),
                count === 500 ? beforeDelete.length : 0,
              );
              await action(
                "列を右へ移動",
                '.column[data-column-id="c0"] [aria-label="右へ移動"]',
                "click",
                null,
                true,
              );
              assert.equal((await getColumns())[1].id, "c0");
              const beforeColumnDelete = await getColumns();
              await action(
                "列削除の確認",
                '.column[data-column-id="c0"] [aria-label="列を削除"]',
              );
              await action("列削除の取消", "#confirm-cancel-btn");
              assert.deepEqual(await getColumns(), beforeColumnDelete);
              await page
                .locator('.column[data-column-id="c0"] [aria-label="列を削除"]')
                .click();
              await action(
                "列削除の確定",
                "#confirm-ok-btn",
                "click",
                null,
                true,
              );
              assert.equal(
                (await getColumns()).length,
                beforeColumnDelete.length - 1,
              );
              await action(
                "列削除の復元",
                "#deletion-undo-btn",
                "click",
                null,
                true,
              );
              assert.deepEqual(await getColumns(), beforeColumnDelete);
              if (count !== 500) {
                await action(
                  "列追加",
                  ".add-column-panel button",
                  "click",
                  null,
                  true,
                );
                const columns = await getColumns();
                assert.equal(columns.length, beforeColumnDelete.length + 1);
                assert.equal(columns.at(-1).notes.length, 0);
              } else {
                assert.equal(
                  await page.locator(".add-column-panel button").isDisabled(),
                  true,
                );
                rows.push({
                  source,
                  width,
                  count,
                  run,
                  operation: "列追加",
                  applicable: false,
                  reason:
                    "12列上限で入口が無効。0列からの再開は既存機能検証のみ。",
                });
              }
            }
            const state = await page.evaluate(() =>
              window.__PETA_BOARD_TEST__.getState(),
            );
            await page.reload();
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            assert.deepEqual(
              await page.evaluate(() => window.__PETA_BOARD_TEST__.getState()),
              state,
            );
            assert.equal(
              await page.locator(".note-card").count(),
              expectedCards,
            );
            if (session) {
              const complete = new Promise((resolve) => {
                session.once("Tracing.tracingComplete", resolve);
              });
              await session.send("Tracing.end");
              await complete;
              const label = source === "peta-board.html" ? "current" : "before";
              const trace = `${basename(output, ".json")}-trace-${label}-${width}-${count}-${run}.json.gz`;
              await writeFile(
                `${evidenceDirectory}/${trace}`,
                gzipSync(JSON.stringify({ traceEvents })),
              );
              const marks = traceEvents.filter((event) =>
                event.name.startsWith("operation-"),
              );
              for (const row of rows.slice(firstRow)) {
                if (!row.mark) continue;
                const mark = marks.find((event) => event.name === row.mark);
                assert(mark, "Missing operation trace mark");
                const nextMark = marks.find((event) => event.ts > mark.ts);
                const paint = traceEvents.find(
                  (event) =>
                    event.name === "Paint" &&
                    event.pid === mark.pid &&
                    event.ts >= mark.ts &&
                    (!nextMark || event.ts < nextMark.ts),
                );
                row.firstRendererPaintMs =
                  !row.disabled && paint ? (paint.ts - mark.ts) / 1000 : null;
                row.trace = trace;
              }
            }
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
    output,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        productionUrl: process.env.PRODUCTION_URL || null,
        versions,
        rendererTrace: Boolean(process.env.TRACE_OPERATIONS),
        definition:
          "Five independent contexts/source/condition, 50/500 notes in normal 4/12 columns, 375/1440x900, AB/BA order. Synchronous synthetic input/click/key/pointer dispatch; two rAF proxy, save indicator followed by exact state reload. Save timing preserves 160ms debounce. When enabled, CDP firstRendererPaintMs is mark to first same-renderer Paint before the next operation; it does not prove complete result presentation. Disabled/no Paint = null. Not physical input/display/INP, real IME or touch.",
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

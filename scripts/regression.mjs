import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const engines = require("./runtime.cjs");
const fixture = require("./fixture.cjs");
const source = await readFile("peta-board.html", "utf8");
const baselineSource =
  process.env.BASELINE_SOURCE || "performance/modernization/before.html";
const baseline = await readFile(baselineSource, "utf8");
const temporary = await mkdtemp(join(tmpdir(), "peta-regression-"));
const target = join(temporary, "board.html");
const records = [];
const evidenceDirectory =
  process.env.EVIDENCE_DIR || "performance/verification";
await mkdir(evidenceDirectory, { recursive: true });
try {
  for (const engine of (process.env.BROWSERS || "chromium").split(",")) {
    const browser = await engines[engine].launch({
      headless: true,
      ...(engine === "chromium" && process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : {}),
    });
    try {
      const snapshots = [];
      const errors = [];
      for (const file of [baselineSource, "peta-board.html"]) {
        await writeFile(target, file === "peta-board.html" ? source : baseline);
        const results = [];
        for (const width of [320, 375, 1440]) {
          const context = await browser.newContext({
            viewport: { width, height: 900 },
          });
          context.setDefaultTimeout(15000);
          try {
            const page = await context.newPage();
            page.on("pageerror", (error) => errors.push(error.message));
            const data = fixture(50);
            data.board.columns = [
              {
                id: "c0",
                title: "列0",
                notes: data.board.columns.flatMap((column) => column.notes),
              },
            ];
            data.board.columns[0].notes.forEach((note) => {
              note.title = "共通 " + note.id;
            });
            await page.addInitScript((data) => {
              Date.now = () => 1791500000000;
              let sequence = 0;
              Object.defineProperty(crypto, "randomUUID", {
                value: () =>
                  `00000000-0000-4000-8000-${(sequence++).toString(16).padStart(12, "0")}`,
              });
              if (!localStorage.getItem("petaborad.state.v1"))
                localStorage.setItem(
                  "petaborad.state.v1",
                  JSON.stringify(data),
                );
            }, data);
            console.log("Checking", engine, file, width);
            await page.goto(
              file === "peta-board.html" && process.env.PRODUCTION_URL
                ? process.env.PRODUCTION_URL
                : pathToFileURL(target).href,
            );
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            async function snapshot(label) {
              await page.evaluate(
                () =>
                  new Promise((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(resolve));
                  }),
              );
              const snapshot = await page.evaluate(() => ({
                state: window.__PETA_BOARD_TEST__.getState(),
                summary: document.querySelector("#board-summary").textContent,
                columns: [...document.querySelectorAll(".column")].map(
                  (column) => ({
                    count: column.querySelector(".column-count").textContent,
                    cards: [...column.querySelectorAll(".note-card")].map(
                      (card) => ({
                        id: card.dataset.noteId,
                        text: card.textContent,
                        marks: [...card.querySelectorAll("mark")].map(
                          (mark) => mark.textContent,
                        ),
                        width: card.getBoundingClientRect().width,
                        height: card.getBoundingClientRect().height,
                      }),
                    ),
                  }),
                ),
                input: {
                  value: document.querySelector("#note-title-input").value,
                  selection:
                    document.querySelector("#note-title-input").selectionStart,
                },
                focused:
                  document.activeElement.id || document.activeElement.className,
                themeMeta: document.querySelector('meta[name="theme-color"]')
                  .content,
                background: getComputedStyle(
                  document.querySelector(".app-shell"),
                ).backgroundColor,
              }));
              // Runtime versions introduce raster/float noise; rounding keeps layout comparisons meaningful.
              for (const column of snapshot.columns)
                for (const card of column.cards) {
                  card.width = Math.round(card.width * 100) / 100;
                  card.height = Math.round(card.height * 100) / 100;
                }
              if (label === "initial" || label === "final-settings-reload") {
                await page.screenshot({
                  path: `${evidenceDirectory}/${engine}-${file.endsWith("before.html") ? "before" : "after"}-${width}-${label}.png`,
                });
              }
              results.push({ width, label, ...snapshot });
            }
            await snapshot("initial");
            await page.locator("#search-input").fill("共通");
            await page.locator(".column-title").fill("列更新");
            await snapshot("column-stable-search");
            await page.locator("#search-input").fill("列更新");
            await page.locator(".column-title").fill("不一致");
            assert.equal(await page.locator(".note-card").count(), 0);
            await snapshot("column-removed-search");
            await page.locator(".column-title").fill("列更新");
            assert.equal(await page.locator(".note-card").count(), 50);
            await snapshot("column-restored-search");
            await page.locator(".column-title").fill("列0");
            await page.locator("#search-input").fill("共通");
            await page.locator(".note-edit-btn").first().click();
            await page.locator("#note-title-input").fill("検索から外れる");
            await snapshot("removed-result");
            await page.locator("#note-body-input").fill("編集が続く本文");
            await page
              .locator('#checklist input[type="text"]')
              .first()
              .fill("更新した項目");
            await snapshot("hidden-note-edit");
            await page.locator("#note-title-input").fill("共通 戻る");
            await snapshot("reinsert-result");
            await page.locator("#note-title-input").evaluate((input) => {
              input.setSelectionRange(2, 4);
              input.dispatchEvent(
                new CompositionEvent("compositionstart", { bubbles: true }),
              );
              input.value = "共通 日本語";
              input.dispatchEvent(
                new InputEvent("input", { bubbles: true, isComposing: true }),
              );
              input.dispatchEvent(
                new CompositionEvent("compositionend", { bubbles: true }),
              );
            });
            await snapshot("synthetic-ime");
            await page
              .locator('#checklist input[type="checkbox"]')
              .first()
              .check();
            await snapshot("check-complete");
            await page
              .locator('#checklist input[type="text"]')
              .first()
              .fill("");
            await page.locator("#note-body-input").focus();
            await snapshot("remove-empty-check");
            await page.locator("#note-due-field").click();
            await page.locator("#date-direct-input").fill("20261010");
            await page.locator("#date-direct-input").press("Enter");
            await page.keyboard.press("Escape");
            await snapshot("due-and-close");
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            const saved = await page.evaluate(() =>
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
              saved,
            );
            await snapshot("reload");
            for (const query of [
              "更新した",
              "編集が続く",
              "列0",
              "共通 日本語",
              "",
              "İ",
              "",
            ]) {
              await page.locator("#search-input").fill(query);
              await snapshot("query " + query);
            }
            await page.locator(".note-edit-btn").first().click();
            await page.locator("#note-body-input").fill("");
            await page.locator("#note-title-input").fill("");
            await page.locator("#note-title-input").fill("最終編集");
            await page.keyboard.press("Escape");
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            await snapshot("rapid-last-edit");
            await page.locator(".note-edit-btn").first().click();
            await page
              .locator('#checklist input[type="text"]')
              .first()
              .fill("復元専用語");
            await page.keyboard.press("Escape");
            await page.locator("#search-input").fill("復元専用語");
            assert.equal(await page.locator(".note-card").count(), 1);
            await page.locator(".note-edit-btn").first().click();
            await page.locator("#checklist .icon-btn").first().click();
            assert.equal(await page.locator(".note-card").count(), 0);
            await page.locator("#checklist-undo-btn").click();
            assert.equal(await page.locator(".note-card").count(), 1);
            await snapshot("check-undo-search-cache");
            await page.locator("#note-title-input").evaluate((input) => {
              input.value = "x".repeat(121);
              input.dispatchEvent(new InputEvent("input", { bubbles: true }));
            });
            assert.equal(
              await page.locator("#note-title-input").inputValue(),
              "x".repeat(120),
            );
            await page
              .locator('#note-color-grid [data-color-id="blue"]')
              .click();
            await snapshot("note-color-and-limit");
            await page.keyboard.press("Escape");
            await page.locator("#search-input").fill("");
            // 検索中の付箋復元と列集合の更新を、状態・件数・フォーカスまで比較する。
            await page.locator("#search-input").fill("共通");
            const matchedCount = await page.locator(".note-card").count();
            await page.locator(".note-edit-btn").first().click();
            await page.locator("#duplicate-note-btn").click();
            assert.equal(
              await page.locator(".note-card").count(),
              matchedCount + 1,
            );
            await snapshot("duplicate-search");
            await page.locator("#delete-note-btn").click();
            await page.locator("#confirm-ok-btn").click();
            assert.equal(
              await page.locator(".note-card").count(),
              matchedCount,
            );
            await snapshot("delete-search");
            await page.locator("#deletion-undo-btn").click();
            assert.equal(
              await page.locator(".note-card").count(),
              matchedCount + 1,
            );
            await snapshot("restore-search");
            await page.locator("#search-input").fill("");
            const notesBeforeDraft = await page.locator(".note-card").count();
            await page.locator(".add-note-btn").first().click();
            assert.equal(
              await page.locator(".note-card").count(),
              notesBeforeDraft + 1,
            );
            await snapshot("blank-draft");
            await page.keyboard.press("Escape");
            assert.equal(
              await page.locator(".note-card").count(),
              notesBeforeDraft,
            );
            await snapshot("discard-blank-draft");
            await page.locator(".add-column-panel button").click();
            assert.equal(await page.locator(".column").count(), 2);
            await snapshot("add-column");
            await page
              .locator('.column [aria-label="列を削除"]')
              .first()
              .click();
            await page.locator("#confirm-ok-btn").click();
            assert.equal(await page.locator(".note-card").count(), 0);
            await snapshot("delete-populated-column");
            await page.locator("#deletion-undo-btn").click();
            assert.equal(
              await page.locator(".note-card").count(),
              notesBeforeDraft,
            );
            await snapshot("restore-populated-column");
            await page.locator("#theme-btn").click();
            await page.locator("#settings-btn").click();
            await page.locator("#board-name-input").fill("更新したボード");
            await page
              .locator('#default-color-grid [data-color-id="mint"]')
              .click();
            await page.locator("#close-settings-btn").click();
            await snapshot("settings-theme-name-color");
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            const finalState = await page.evaluate(() =>
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
              finalState,
            );
            await snapshot("final-settings-reload");
            await page.emulateMedia({ media: "print" });
            assert.equal(await page.locator("#theme-btn").isVisible(), false);
            for (const theme of ["light", "dark"]) {
              // 印刷時は操作ボタンが隠れる。プログラムによる更新でも印刷色を維持する。
              await page
                .locator("#theme-btn")
                .evaluate((button) => button.click());
              assert.equal(
                await page.evaluate(
                  () => document.documentElement.dataset.theme,
                ),
                theme,
              );
              await snapshot("print-theme-" + theme);
              assert.equal(results.at(-1).themeMeta, "#f5f6f8");
              assert.equal(results.at(-1).background, "rgb(245, 246, 248)");
            }
            await page.emulateMedia({ media: null });
          } finally {
            await context.close();
          }
        }
        snapshots.push(results);
      }
      assert.deepEqual(
        snapshots[1],
        snapshots[0],
        `${engine}: state/content/order/marks/geometry/focus mismatch`,
      );
      assert.deepEqual(errors, []);
      records.push({
        engine,
        version: browser.version(),
        snapshots: snapshots[0].length,
        equal: true,
        errors,
      });
    } finally {
      await browser.close();
    }
  }
  // Existing storage, import, undo, modal, and drag checks are maintained as executable regression runners.
  if (!process.env.PARITY_ONLY) {
    const url = pathToFileURL(resolve("peta-board.html")).href;
    for (const [file, extra] of [
      [
        "performance/verify.cjs",
        {
          TARGET_URL: url,
          OUTPUT: `${evidenceDirectory}/storage-regression.json`,
        },
      ],
      [
        "performance/drag/gestures.cjs",
        { OUTPUT: `${evidenceDirectory}/gestures.json` },
      ],
      [
        "performance/drag/regression.cjs",
        { OUTPUT: `${evidenceDirectory}/drag-regression.json` },
      ],
      [
        "scripts/unload-regression.mjs",
        {
          EVIDENCE_DIR: evidenceDirectory,
          UNLOAD_REPEATS: "1",
          UNLOAD_OUTPUT: `${evidenceDirectory}/unload-ci.json`,
        },
      ],
    ]) {
      const result = spawnSync(process.execPath, [file], {
        stdio: "inherit",
        env: { ...process.env, ...extra },
      });
      assert.equal(result.status, 0, file);
    }
  }
  assert.equal(
    await readFile("peta-board.html", "utf8"),
    source,
    "Application changed during regression",
  );
  await writeFile(
    `${evidenceDirectory}/regression.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        productionUrl: process.env.PRODUCTION_URL || null,
        version: createHash("sha256").update(source).digest("hex"),
        baselineSource,
        baselineVersion: createHash("sha256").update(baseline).digest("hex"),
        records,
        limitations:
          "Synthetic IME events are not real OS IME. Playwright engines are not physical phones or actual Safari.",
      },
      null,
      2,
    ),
  );
  console.log(records);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

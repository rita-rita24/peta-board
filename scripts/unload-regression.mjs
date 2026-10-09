import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const engines = require("./runtime.cjs"),
  fixture = require("./fixture.cjs");
const directory = process.env.EVIDENCE_DIR || "performance/round6";
const temporary = await mkdtemp(join(tmpdir(), "peta-unload-"));
const target = join(temporary, "board.html"),
  url = pathToFileURL(target).href;
const rows = [],
  errors = [];
const sources = [
  process.env.UNLOAD_BASELINE || "performance/round6/before.html",
  "peta-board.html",
];
const hashes = Object.fromEntries(
  await Promise.all(
    sources.map(async (source) => [
      source,
      createHash("sha256")
        .update(await readFile(source))
        .digest("hex"),
    ]),
  ),
);
try {
  for (const engine of ["chromium", "firefox", "webkit"]) {
    const browser = await engines[engine].launch({
      headless: true,
      ...(engine === "chromium" && process.env.ENABLE_CACHE
        ? { ignoreDefaultArgs: ["--disable-back-forward-cache"] }
        : {}),
    });
    try {
      for (const source of sources) {
        await writeFile(target, await readFile(source));
        const candidate = source === "peta-board.html";
        for (
          let run = 0;
          run < Number(process.env.UNLOAD_REPEATS || 5);
          run++
        ) {
          const context = await browser.newContext({
            viewport: { width: 375, height: 900 },
          });
          context.setDefaultTimeout(15000);
          try {
            const page = await context.newPage();
            page.on("pageerror", (error) => errors.push(error.message));
            await page.addInitScript((data) => {
              if (location.protocol !== "file:") return;
              const listeners = new Set();
              const add = window.addEventListener,
                remove = window.removeEventListener;
              window.addEventListener = function (type, listener, ...rest) {
                if (type === "beforeunload") listeners.add(listener);
                return add.call(this, type, listener, ...rest);
              };
              window.removeEventListener = function (type, listener, ...rest) {
                if (type === "beforeunload") listeners.delete(listener);
                return remove.call(this, type, listener, ...rest);
              };
              window.__unloadCount = () => listeners.size;
              window.__pageShows = [];
              window.addEventListener("pageshow", (event) =>
                window.__pageShows.push(event.persisted),
              );
              if (!localStorage.getItem("petaborad.state.v1"))
                localStorage.setItem(
                  "petaborad.state.v1",
                  JSON.stringify(data),
                );
            }, fixture(50));
            await page.goto(url);
            const saved = () =>
              page.waitForFunction(
                () =>
                  document.querySelector("#save-indicator").dataset.state ===
                  "saved",
              );
            await saved();
            const count = () => page.evaluate(() => window.__unloadCount());
            const record = async (phase, fields = {}) =>
              rows.push({
                engine,
                browser: browser.version(),
                source,
                run,
                phase,
                listeners: await count(),
                ...fields,
              });
            assert.equal(await count(), candidate ? 0 : 1);
            await page.goto("about:blank");
            const other = await context.newPage();
            await other.goto(url);
            await other.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            await other.locator("#settings-btn").click();
            await other.locator("#board-name-input").fill(`別タブ更新 ${run}`);
            await other.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            const state = await other.evaluate(() =>
              window.__PETA_BOARD_TEST__.getState(),
            );
            await other.close();
            const start = Date.now();
            await page.goBack();
            await saved();
            await page.waitForFunction(
              (title) =>
                window.__PETA_BOARD_TEST__.getState().board.title === title,
              state.board.title,
            );
            assert.deepEqual(
              await page.evaluate(() => window.__PETA_BOARD_TEST__.getState()),
              state,
            );
            await record("saved-back", {
              controllerMs: Date.now() - start,
              persisted: await page.evaluate(() => window.__pageShows.at(-1)),
            });
            await page.locator(".note-edit-btn").first().click();
            for (const selector of [
              "#note-title-input",
              "#note-body-input",
              "#note-tags-input",
            ]) {
              await page
                .locator(selector)
                .evaluate((input) =>
                  input.dispatchEvent(
                    new CompositionEvent("compositionstart", { bubbles: true }),
                  ),
                );
              assert.equal(await count(), 1);
              await record("composition-active", { selector });
              await page
                .locator(selector)
                .evaluate((input) =>
                  input.dispatchEvent(
                    new CompositionEvent("compositionend", { bubbles: true }),
                  ),
                );
              await saved();
              assert.equal(await count(), candidate ? 0 : 1);
              await record("composition-cancelled", { selector });
            }
            // Some IME sequences expose isComposing input without a preceding compositionstart.
            await page
              .locator("#note-tags-input")
              .evaluate((input) =>
                input.dispatchEvent(
                  new InputEvent("input", { bubbles: true, isComposing: true }),
                ),
              );
            assert.equal(await count(), 1);
            await page
              .locator("#note-tags-input")
              .evaluate((input) =>
                input.dispatchEvent(
                  new CompositionEvent("compositionend", { bubbles: true }),
                ),
              );
            await saved();
            assert.equal(await count(), candidate ? 0 : 1);
            await page.evaluate(() => {
              window.__storageOriginal = Storage.prototype.setItem;
              Storage.prototype.setItem = function (key, value) {
                if (key === "petaborad.state.v1")
                  throw new DOMException("Test quota", "QuotaExceededError");
                return window.__storageOriginal.call(this, key, value);
              };
            });
            await page.locator("#note-title-input").fill("未保存の検証");
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "error",
            );
            assert.equal(await count(), 1);
            let warned = false;
            page.once("dialog", async (dialog) => {
              assert.equal(dialog.type(), "beforeunload");
              warned = true;
              await dialog.dismiss();
            });
            await page
              .goto("about:blank", { timeout: 3000, waitUntil: "commit" })
              .catch(() => {});
            assert(warned, `${engine}: missing native unsaved warning`);
            assert.equal(page.url(), url);
            assert.equal(
              await page.locator("#note-title-input").inputValue(),
              "未保存の検証",
            );
            await record("failed-save-warning", {
              nativeWarning: true,
              editPreserved: true,
            });
            await page.evaluate(() => {
              Storage.prototype.setItem = window.__storageOriginal;
              return window.__PETA_BOARD_TEST__.saveStateNow();
            });
            await saved();
            assert.equal(await count(), candidate ? 0 : 1);
            await record("retry-saved");
            console.log("Unload", engine, source, run, "passed");
          } finally {
            await context.close();
          }
        }
      }
    } finally {
      await browser.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    process.env.UNLOAD_OUTPUT ||
      `${directory}/${Number(process.env.UNLOAD_REPEATS || 5) === 1 ? "unload-ci" : "unload-regression"}.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        hashes,
        chromiumDefaultCacheDisabled: !process.env.ENABLE_CACHE,
        url,
        rows,
        errors,
        definition:
          "3 engines,configurable independent contexts/source (default5),50notes,375x900. Listener lifetime, synthetic composition/cancel and isComposing-only tags, real beforeunload dialog after quota failure, dismissal retains edit, retry removes guard. Native pageshow.persisted and latest externally saved state on back recorded; controllerMs includes automation. Synthetic composition is not real OS IME; cache eligibility is observed, not guaranteed.",
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

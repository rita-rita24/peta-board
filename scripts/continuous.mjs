import assert from "node:assert/strict";
import { copyFile, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  { chromium } = require("./runtime.cjs"),
  fixture = require("./fixture.cjs");
const sources = process.env.PRODUCTION_ONLY
  ? ["peta-board.html"]
  : [
      process.env.BASELINE_SOURCE || "performance/followup/before.html",
      "peta-board.html",
    ];
const temporary = await mkdtemp(join(tmpdir(), "peta-continuous-")),
  target = join(temporary, "board.html");
const rows = [],
  errors = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});
try {
  for (const width of [375, 1440])
    for (const count of [50, 500])
      for (let run = 0; run < 5; run++)
        for (const source of run % 2 ? sources.toReversed() : sources) {
          await copyFile(source, target);
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
                localStorage.setItem(
                  "petaborad.state.v1",
                  JSON.stringify(data),
                );
            }, fixture(count));
            const url =
              process.env.PRODUCTION_URL || pathToFileURL(target).href;
            await page.goto(url);
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            async function record(operation, sample) {
              rows.push({ source, width, count, run, operation, ...sample });
            }
            for (const [axis, selector] of [
              ["y", ".note-list"],
              ["x", ".board-shell"],
            ]) {
              const element = page.locator(selector).first();
              const range = await element.evaluate(
                (el, axis) =>
                  axis === "y"
                    ? el.scrollHeight - el.clientHeight
                    : el.scrollWidth - el.clientWidth,
                axis,
              );
              if (range < 40) {
                await record("wheel-" + axis, { applicable: false, range });
                continue;
              }
              await element.evaluate((el, axis) => {
                if (axis === "y") el.scrollTop = 0;
                else el.scrollLeft = 0;
              }, axis);
              const box = await element.boundingBox();
              await page.mouse.move(
                box.x + Math.min(box.width / 2, 100),
                box.y + Math.min(box.height / 2, 180),
              );
              await page.evaluate(() => {
                window.__wheelStarted = performance.now();
              });
              await page.mouse.wheel(
                axis === "x" ? 40 : 0,
                axis === "y" ? 40 : 0,
              );
              await page.waitForFunction(
                ({ selector, axis }) => {
                  const el = document.querySelector(selector);
                  return (axis === "y" ? el.scrollTop : el.scrollLeft) >= 20;
                },
                { selector, axis },
              );
              const sample = await page.evaluate(
                async ({ selector, axis }) => {
                  await new Promise((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(resolve));
                  });
                  const elapsed = performance.now() - window.__wheelStarted,
                    el = document.querySelector(selector);
                  return {
                    applicable: true,
                    resultProxy: elapsed,
                    offset: axis === "y" ? el.scrollTop : el.scrollLeft,
                  };
                },
                { selector, axis },
              );
              await record("wheel-" + axis, sample);
            }
            await page.evaluate(() => {
              window.__resizeStarted = performance.now();
            });
            await page.setViewportSize({ width: width - 40, height: 760 });
            await page.waitForFunction((w) => innerWidth === w, width - 40);
            await record(
              "resize",
              await page.evaluate(async () => {
                await new Promise((resolve) => {
                  requestAnimationFrame(() => requestAnimationFrame(resolve));
                });
                return {
                  resultProxy: performance.now() - window.__resizeStarted,
                  cards: document.querySelectorAll(".note-card").length,
                };
              }),
            );
            assert.equal(await page.locator(".note-card").count(), count);
            await page.setViewportSize({ width, height: 900 });
            await record(
              "pageshow-refresh",
              await page.evaluate(async () => {
                const state = JSON.stringify(
                  window.__PETA_BOARD_TEST__.getState(),
                );
                const start = performance.now();
                window.dispatchEvent(new PageTransitionEvent("pageshow"));
                const handler = performance.now() - start;
                await new Promise((resolve) => {
                  requestAnimationFrame(() => requestAnimationFrame(resolve));
                });
                return {
                  handler,
                  resultProxy: performance.now() - start,
                  stateUnchanged:
                    JSON.stringify(window.__PETA_BOARD_TEST__.getState()) ===
                    state,
                  pills: document.querySelectorAll(".due-pill").length,
                };
              }),
            );
            assert.equal(rows.at(-1).stateUnchanged, true);
            await page.locator(".note-edit-btn").first().click();
            await page.locator("#note-due-field").click();
            for (const key of [
              "ArrowRight",
              "Home",
              "End",
              "PageDown",
              "PageUp",
              "Enter",
            ]) {
              const sample = await page.evaluate(async (key) => {
                const el = document.activeElement,
                  start = performance.now();
                el.dispatchEvent(
                  new KeyboardEvent("keydown", { key, bubbles: true }),
                );
                const handler = performance.now() - start;
                await new Promise((resolve) => {
                  requestAnimationFrame(() => requestAnimationFrame(resolve));
                });
                return {
                  handler,
                  resultProxy: performance.now() - start,
                  focus:
                    document.activeElement.dataset.date ||
                    document.activeElement.id,
                  closed: document.querySelector("#date-popover").hidden,
                };
              }, key);
              await record("calendar-key-" + key, sample);
            }
            assert.equal(rows.at(-1).closed, true);
            await page.keyboard.press("Escape");
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            const state = await page.evaluate(() =>
              window.__PETA_BOARD_TEST__.getState(),
            );
            await page.goto("about:blank");
            const navigationStart = Date.now();
            await page.goBack();
            try {
              await page.waitForFunction(
                () =>
                  document.querySelector("#save-indicator").dataset.state ===
                  "saved",
              );
            } catch (error) {
              const diagnostic = await page.evaluate(() => ({
                url: location.href,
                indicator: document.querySelector("#save-indicator")?.outerHTML,
                issue: document.querySelector("#storage-status-message")
                  ?.textContent,
                state: window.__PETA_BOARD_TEST__?.getState(),
                stored: localStorage.getItem("petaborad.state.v1"),
              }));
              await writeFile(
                "performance/followup/history-failure.json",
                JSON.stringify(
                  { source, width, count, run, diagnostic, stateBefore: state },
                  null,
                  2,
                ),
              );
              throw error;
            }
            await record("history-back", {
              controllerElapsed: Date.now() - navigationStart,
            });
            assert.deepEqual(
              await page.evaluate(() => window.__PETA_BOARD_TEST__.getState()),
              state,
            );
            await page.goForward();
            assert.equal(page.url(), "about:blank");
            await record("history-forward", { valid: true });
          } finally {
            await context.close();
          }
          console.log(width, count, run, source);
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
    process.env.OUTPUT ||
      (process.env.PRODUCTION_ONLY
        ? "performance/followup/production-continuous.json"
        : "performance/followup/continuous.json"),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        versions,
        productionUrl: process.env.PRODUCTION_URL || null,
        definition:
          "Five independent contexts/source/condition, 50/500 notes,375/1440x900,AB/BA. Native wheel and viewport resize: browser clock before automation command to verified offset/dimensions plus two rAF. Includes command transport/observation overhead, not physical input/display or continuous gesture smoothness. pageshow/keyboard synthetic events. History-back controller wall time includes Playwright wait polling; history-forward correctness only, no speed claim. No state loss permitted.",
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

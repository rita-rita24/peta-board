import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
const require = createRequire(import.meta.url),
  { chromium } = require("./runtime.cjs"),
  fixture = require("./fixture.cjs");
const sources =
  process.env.BASELINE_ONLY || process.env.PRODUCTION_ONLY
    ? ["peta-board.html"]
    : ["performance/round4/before.html", "peta-board.html"];
const directory = await mkdtemp(join(tmpdir(), "peta-theme-")),
  target = join(directory, "board.html");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});
const rows = [],
  errors = [],
  hashes = {};
const output = process.env.OUTPUT || "performance/round4/theme-comparison.json";
const tracePrefix = basename(output, ".json");
try {
  for (const width of [375, 1440])
    for (const count of [50, 500])
      for (let run = 0; run < 5; run++)
        for (const source of run % 2 ? sources.toReversed() : sources) {
          const html = await readFile(source);
          hashes[source] = createHash("sha256").update(html).digest("hex");
          await writeFile(target, html);
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
            await page.evaluate(() => {
              let step = 0;
              window.__themeEvents = [];
              if (PerformanceObserver.supportedEntryTypes.includes("event")) {
                window.__themeObserver = new PerformanceObserver((list) => {
                  window.__themeEvents.push(
                    ...list
                      .getEntries()
                      .filter((entry) => entry.name === "click")
                      .map((entry) => ({
                        startTime: entry.startTime,
                        duration: entry.duration,
                        inputDelayMs: entry.processingStart - entry.startTime,
                        processingMs:
                          entry.processingEnd - entry.processingStart,
                        interactionId: entry.interactionId,
                      })),
                  );
                });
                window.__themeObserver.observe({
                  type: "event",
                  durationThreshold: 16,
                });
              }
              document.querySelector("#theme-btn").addEventListener(
                "click",
                (event) => {
                  window.__themeSample = {
                    step: step++,
                    start: performance.now(),
                    eventTimeStamp: event.timeStamp,
                  };
                  performance.mark("theme-start-" + window.__themeSample.step);
                },
                true,
              );
              document
                .querySelector("#theme-btn")
                .addEventListener("click", () => {
                  window.__themeSample.handler =
                    performance.now() - window.__themeSample.start;
                });
            });
            const session = await context.newCDPSession(page),
              events = [];
            session.on("Tracing.dataCollected", ({ value }) =>
              events.push(...value),
            );
            await session.send("Tracing.start", {
              categories: "devtools.timeline,blink.user_timing",
              transferMode: "ReportEvents",
            });
            const samples = [];
            for (let step = 0; step < 5; step++) {
              await page.evaluate(
                () =>
                  new Promise((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(resolve));
                  }),
              );
              await page.locator("#theme-btn").click();
              const sample = await page.evaluate(async () => {
                await new Promise((resolve) => {
                  requestAnimationFrame(() => requestAnimationFrame(resolve));
                });
                const resultProxy =
                  performance.now() - window.__themeSample.start;
                await new Promise((resolve, reject) => {
                  function check() {
                    const status =
                      document.querySelector("#save-indicator").dataset.state;
                    if (status === "saved") resolve();
                    else if (
                      status === "error" ||
                      performance.now() - window.__themeSample.start > 10000
                    )
                      reject(new Error("Theme save failed"));
                    else requestAnimationFrame(check);
                  }
                  check();
                });
                return {
                  ...window.__themeSample,
                  resultProxy,
                  savedMs: performance.now() - window.__themeSample.start,
                  theme: document.documentElement.dataset.theme,
                  mode: document.body.dataset.mode,
                  meta: document.querySelector('meta[name="theme-color"]')
                    .content,
                  background: getComputedStyle(
                    document.querySelector(".app-shell"),
                  ).backgroundColor,
                  cards: document.querySelectorAll(".note-card").length,
                };
              });
              assert.equal(sample.theme, step % 2 ? "light" : "dark");
              assert.equal(sample.mode, sample.theme);
              assert.equal(sample.meta, step % 2 ? "#f5f6f8" : "#131922");
              assert.equal(
                sample.background,
                step % 2 ? "rgb(245, 246, 248)" : "rgb(19, 25, 34)",
              );
              assert.equal(sample.cards, count);
              assert(
                Number.isFinite(sample.handler),
                "Missing handler end sample",
              );
              samples.push(sample);
            }
            const inputTimings = await page.evaluate(() => {
              window.__themeObserver?.disconnect();
              return window.__themeEvents;
            });
            for (const sample of samples) {
              sample.eventTiming =
                inputTimings.find(
                  (entry) =>
                    Math.abs(entry.startTime - sample.eventTimeStamp) < 1,
                ) ?? null;
            }
            const complete = new Promise((resolve) => {
              session.once("Tracing.tracingComplete", resolve);
            });
            await session.send("Tracing.end");
            await complete;
            const label = source === "peta-board.html" ? "current" : "before",
              trace = `${tracePrefix}-trace-${label}-${width}-${count}-${run}.json.gz`;
            await writeFile(
              `${dirname(output)}/${trace}`,
              gzipSync(JSON.stringify({ traceEvents: events })),
            );
            for (const sample of samples) {
              const start = events.find(
                (event) => event.name === "theme-start-" + sample.step,
              );
              assert(start, "Missing input trace mark");
              const paint = events.find(
                (event) =>
                  event.name === "Paint" &&
                  event.pid === start.pid &&
                  event.ts >= start.ts,
              );
              assert(paint, "Missing renderer Paint after theme change");
              rows.push({
                source,
                width,
                count,
                run,
                ...sample,
                firstRendererPaintMs: (paint.ts - start.ts) / 1000,
                trace,
              });
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
              await page
                .locator('meta[name="theme-color"]')
                .getAttribute("content"),
              "#131922",
            );
            console.log("Theme", width, count, run, source);
          } finally {
            await context.close();
          }
        }
  assert.deepEqual(errors, []);
  await writeFile(
    output,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        productionUrl: process.env.PRODUCTION_URL || null,
        versions: hashes,
        definition:
          "Five independent contexts per source/375/1440px/50/500notes, AB/BA order. Five native theme-button clicks each; first and repeat samples separate. Capture-phase mark to first renderer Paint in same PID; not physical presentation or INP. Tracing perturbs timings. Handler and 2rAF proxy and saved indicator measured separately. Exact state reloaded. Each sample verifies theme, body mode, meta color, actual background and card count. Performance runs are serialized, no other browser measurement runs concurrently. Event Timing click matched by event timestamp: inputDelayMs before dispatch, processingMs, quantized8ms duration. Minimum16ms reporting threshold; missing entry = null, not zero. This controlled sample is not field INP.",
        rows,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}

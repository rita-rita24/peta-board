import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("./runtime.cjs");
const fixture = require("./fixture.cjs");
const directory = process.env.EVIDENCE_DIR || "performance/round7";
const sources = process.env.PRODUCTION_ONLY
  ? ["peta-board.html"]
  : ["performance/round6/before.html", `${directory}/before.html`];
const productionUrl = process.env.PRODUCTION_ONLY
  ? pathToFileURL(resolve("peta-board.html")).href
  : null;
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
const temporary = await mkdtemp(join(tmpdir(), "peta-modal-phase-"));
const target = join(temporary, "board.html");
const rows = [],
  errors = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});
try {
  for (const width of [375, 1440])
    for (let run = 0; run < 5; run++)
      for (const source of run % 2 ? sources.toReversed() : sources) {
        await copyFile(source, target);
        const context = await browser.newContext({
          viewport: { width, height: 900 },
        });
        context.setDefaultTimeout(15000);
        try {
          const page = await context.newPage();
          page.on("pageerror", (error) => errors.push(error.message));
          await page.addInitScript(
            (data) =>
              localStorage.setItem("petaborad.state.v1", JSON.stringify(data)),
            fixture(50),
          );
          await page.goto(productionUrl || pathToFileURL(target).href);
          await page.waitForFunction(
            () =>
              document.querySelector("#save-indicator").dataset.state ===
              "saved",
          );
          const samples = await page.evaluate(async () => {
            const frame = () =>
              new Promise((resolve) => {
                requestAnimationFrame(() => resolve(performance.now()));
              });
            const samples = [];
            for (const operation of ["settings", "calendar"]) {
              if (operation === "calendar")
                document.querySelector(".note-edit-btn").click();
              for (const delay of [0, 4, 8, 12]) {
                await frame();
                const previousFrame = await frame();
                if (delay)
                  await new Promise((resolve) => {
                    setTimeout(resolve, delay);
                  });
                const start = performance.now();
                document
                  .querySelector(
                    operation === "settings"
                      ? "#settings-btn"
                      : "#note-due-field",
                  )
                  .click();
                const handlerMs = performance.now() - start;
                const panel = document.querySelector(
                  operation === "settings"
                    ? "#settings-modal"
                    : "#date-popover",
                );
                const ready =
                  !panel.hidden &&
                  !panel.inert &&
                  (operation === "calendar" ||
                    panel.classList.contains("is-open"));
                const synchronousReadyMs = performance.now() - start;
                const nextFrame = await frame();
                samples.push({
                  operation,
                  requestedDelayMs: delay,
                  phaseSincePreviousFrameMs: start - previousFrame,
                  handlerMs,
                  ready,
                  synchronousReadyMs,
                  nextFrameProxyMs: nextFrame - start,
                  cards: document.querySelectorAll(".note-card").length,
                });
                document
                  .querySelector(
                    operation === "settings"
                      ? "#close-settings-btn"
                      : "#date-close-btn",
                  )
                  .click();
              }
              if (operation === "calendar")
                document.querySelector("#close-drawer-btn").click();
            }
            return samples;
          });
          for (const row of samples) {
            assert(row.ready);
            assert.equal(row.cards, 50);
            rows.push({ source, width, run, ...row });
          }
        } finally {
          await context.close();
        }
      }
  assert.deepEqual(errors, []);
  await writeFile(
    process.env.OUTPUT || `${directory}/modal-phase.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        versions,
        runnerSha256: createHash("sha256")
          .update(await readFile(new URL(import.meta.url)))
          .digest("hex"),
        url: productionUrl || pathToFileURL(target).href,
        production: Boolean(productionUrl),
        definition:
          "Small-count diagnosis: paired mode59bdc4 vs301436 AB/BA; production mode current local distribution after-only, no production reduction rate. Five independent contexts/width/version. Delay0 is first opening, delays4/8/12 are repeated openings in fixed order, so cache warming/order also vary. CPU and synchronous DOM-ready separate from next-rAF proxy. Synthetic clicks, no physical-input/display or complete renderer Paint. Frame phase sensitivity is not application speed improvement. Ready uses inert/hidden/class, no forced computed-style read added.",
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

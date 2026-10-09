import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require("./runtime.cjs");
const fixture = require("./fixture.cjs");
const temporary = await mkdtemp(join(tmpdir(), "peta-startup-"));
const target = join(temporary, "board.html");
const rows = [];
const sources = ["performance/modernization/before.html", "peta-board.html"];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});
try {
  for (let run = 0; run < 5; run++) {
    for (const source of run % 2 ? sources.toReversed() : sources) {
      await copyFile(source, target);
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await page.addInitScript((data) => {
        if (!localStorage.getItem("petaborad.state.v1"))
          localStorage.setItem("petaborad.state.v1", JSON.stringify(data));
        window.__timings = {};
        const frame = () => {
          document.querySelectorAll(".note-card").length;
          if (
            document.querySelector("#board-title")?.textContent ===
              "計測ボード" &&
            !window.__timings.content
          )
            window.__timings.content = performance.now();
          if (
            window.__timings.content &&
            !document.querySelector(".app-shell").inert &&
            !window.__timings.interactive
          )
            window.__timings.interactive = performance.now();
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }, fixture(50));
      for (const cache of ["cold", "warm"]) {
        if (cache === "cold") await page.goto(pathToFileURL(target).href);
        else await page.reload();
        await page.waitForFunction(() => window.__timings.interactive);
        assert.equal(await page.locator(".note-card").count(), 50);
        rows.push({
          source,
          run,
          cache,
          ...(await page.evaluate(() => window.__timings)),
        });
      }
      await context.close();
    }
  }
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
    "performance/modernization/startup-paired.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        versions,
        definition:
          "1440x900,50 notes,5 independent contexts per source, alternating AB/BA source order, same timeOrigin/rAF criteria as screens.cjs. Cold includes fixture serialization and IndexedDB creation, warm reload same context.",
        rows,
      },
      null,
      2,
    ),
  );
  console.log(rows);
} finally {
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}

const fs = require("node:fs"),
  crypto = require("node:crypto");

const { chromium } = require("../scripts/runtime.cjs");
const fixture = require("../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH,
  });
  const rows = [];
  const sources = ["performance/before.html", "peta-board.html"];
  const versions = Object.fromEntries(
    sources.map((s) => [
      s,
      crypto.createHash("sha256").update(fs.readFileSync(s)).digest("hex"),
    ]),
  );
  for (const width of [1440, 375])
    for (let pair = 0; pair < 10; pair++)
      for (const source of pair % 2 ? [...sources].reverse() : sources) {
        fs.copyFileSync(
          source,
          require("node:path").join(
            require("node:os").tmpdir(),
            "peta-board-paired.html",
          ),
        );
        const context = await browser.newContext({
            viewport: { width, height: width === 1440 ? 900 : 812 },
          }),
          page = await context.newPage();
        await page.addInitScript((data) => {
          localStorage.setItem("petaborad.state.v1", JSON.stringify(data));
          window.__paired = {};
          function frame() {
            if (
              !document.querySelector(".app-shell")?.inert &&
              document.querySelector("#board-title")?.textContent ===
                "計測ボード"
            ) {
              window.__paired.content = performance.now();
              window.__paired.interactive = performance.now();
            } else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        }, fixture(500));
        await page.goto(
          require("node:url").pathToFileURL(
            require("node:path").join(
              require("node:os").tmpdir(),
              "peta-board-paired.html",
            ),
          ).href,
        );
        await page.waitForFunction(() => window.__paired.content);
        rows.push({
          source,
          width,
          pair,
          screen: "board",
          ...(await page.evaluate(() => window.__paired)),
        });
        for (const query of ["検証対象", ""]) {
          const t = await page.evaluate(async (query) => {
            const start = performance.now(),
              input = document.querySelector("#search-input");
            input.value = query;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            await new Promise((r) => {
              requestAnimationFrame(() => requestAnimationFrame(r));
            });
            const elapsed = performance.now() - start;
            return {
              content: elapsed,
              interactive: elapsed,
              result: elapsed,
              cards: document.querySelectorAll(".note-card").length,
            };
          }, query);
          if (t.cards !== (query ? 250 : 500)) throw Error("incorrect count");
          rows.push({
            source,
            width,
            pair,
            screen: query ? "search" : "search-clear",
            ...t,
          });
        }
        await context.close();
        fs.writeFileSync(
          "performance/paired.json",
          JSON.stringify(
            {
              date: new Date().toISOString(),
              browser: browser.version(),
              versions,
              rows,
            },
            null,
            2,
          ),
        );
        console.log(width, pair, source);
      }
  await browser.close();
})();

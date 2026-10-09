const fs = require("node:fs"),
  crypto = require("node:crypto");

const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    }),
    rows = [];
  const sources = ["performance/round2/before.html", "peta-board.html"];
  const versions = Object.fromEntries(
    sources.map((s) => [
      s,
      crypto.createHash("sha256").update(fs.readFileSync(s)).digest("hex"),
    ]),
  );
  for (const source of sources) {
    fs.copyFileSync(
      source,
      require("node:path").join(
        require("node:os").tmpdir(),
        "peta-board-r2-empty-search.html",
      ),
    );
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 375, height: 812 },
    ])
      for (const count of [0])
        for (let run = 0; run < 5; run++) {
          const context = await browser.newContext({ viewport }),
            page = await context.newPage();
          await page.addInitScript((data) => {
            if (!localStorage.getItem("petaborad.state.v1"))
              localStorage.setItem("petaborad.state.v1", JSON.stringify(data));
          }, fixture(count));
          for (const cache of ["cold", "warm"]) {
            if (cache === "cold")
              await page.goto(
                require("node:url").pathToFileURL(
                  require("node:path").join(
                    require("node:os").tmpdir(),
                    "peta-board-r2-empty-search.html",
                  ),
                ).href,
              );
            else await page.reload();
            await page.waitForFunction(
              () => !document.querySelector(".app-shell").inert,
            );
            // Real typing requires focus. Prepare the field and settle focus styles before the input event.
            await page.locator("#search-input").focus();
            await page.evaluate(
              () =>
                new Promise((r) => {
                  requestAnimationFrame(() => requestAnimationFrame(r));
                }),
            );
            for (const query of ["検証対象", ""]) {
              const timing = await page.evaluate(async (query) => {
                const input = document.querySelector("#search-input");
                if (document.activeElement !== input)
                  throw Error("search focus mismatch");
                const start = performance.now();
                input.value = query;
                input.dispatchEvent(new Event("input", { bubbles: true }));
                await new Promise((r) => {
                  requestAnimationFrame(() => requestAnimationFrame(r));
                });
                const t = performance.now() - start;
                return {
                  content: t,
                  interactive: t,
                  result: t,
                  cards: document.querySelectorAll(".note-card").length,
                };
              }, query);
              if (timing.cards !== (query ? Math.ceil(count / 2) : count))
                throw Error("search result mismatch");
              const summary = await page
                .locator("#board-summary")
                .textContent();
              if (
                query
                  ? !summary.startsWith("検索結果 0件")
                  : !summary.startsWith("付箋 0件")
              )
                throw Error("empty summary mismatch");
              rows.push({
                source,
                viewport,
                count,
                run,
                cache,
                screen: query ? "search" : "search-clear",
                ...timing,
              });
            }
          }
          await context.close();
          fs.writeFileSync(
            "performance/round2/empty-search.json",
            JSON.stringify(
              {
                date: new Date().toISOString(),
                browser: browser.version(),
                versions,
                definition:
                  "focused search input, two settled focus frames, input event to rendered correct result",
                rows,
              },
              null,
              2,
            ),
          );
          console.log(source, viewport.width, count, run);
        }
  }
  await browser.close();
})();

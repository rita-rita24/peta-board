const fs = require("node:fs"),
  crypto = require("node:crypto");

const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    }),
    rows = [],
    errors = [],
    sources = [
      "performance/round2/before.html",
      process.env.CANDIDATE ||
        "performance/round2/candidate-body-auto-dense.html",
    ];
  const versions = Object.fromEntries(
    sources.map((s) => [
      s,
      crypto.createHash("sha256").update(fs.readFileSync(s)).digest("hex"),
    ]),
  );
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 375, height: 812 },
  ])
    for (const count of [50, 500])
      for (
        let run = 0;
        run < (count === 500 ? Number(process.env.DENSE_REPEATS || 10) : 5);
        run++
      )
        for (const source of run % 2 ? [...sources].reverse() : sources) {
          fs.copyFileSync(
            source,
            require("node:path").join(
              require("node:os").tmpdir(),
              "peta-board-r2-paired.html",
            ),
          );
          const context = await browser.newContext({ viewport }),
            page = await context.newPage();
          page.on("pageerror", (e) => errors.push(e.message));
          await page.addInitScript((data) => {
            if (!localStorage.getItem("petaborad.state.v1"))
              localStorage.setItem("petaborad.state.v1", JSON.stringify(data));
            requestAnimationFrame(function tick() {
              if (
                document.querySelector("#board-title")?.textContent ===
                  "計測ボード" &&
                !document.querySelector(".app-shell").inert
              )
                window.__done = performance.now();
              else requestAnimationFrame(tick);
            });
          }, fixture(count));
          for (const cache of ["cold", "warm"]) {
            if (cache === "cold")
              await page.goto(
                require("node:url").pathToFileURL(
                  require("node:path").join(
                    require("node:os").tmpdir(),
                    "peta-board-r2-paired.html",
                  ),
                ).href,
              );
            else await page.reload();
            await page.waitForFunction(() => window.__done);
            if ((await page.locator(".note-card").count()) !== count)
              throw Error("board count");
            rows.push({
              source,
              viewport,
              count,
              run,
              cache,
              screen: "board",
              content: await page.evaluate(() => window.__done),
              interactive: await page.evaluate(() => window.__done),
            });
            await page.locator("#search-input").focus();
            await page.evaluate(
              () =>
                new Promise((r) => {
                  requestAnimationFrame(() => requestAnimationFrame(r));
                }),
            );
            for (const query of ["検証対象", ""]) {
              const t = await page.evaluate(async (q) => {
                const s = performance.now(),
                  e = document.querySelector("#search-input");
                e.value = q;
                e.dispatchEvent(new Event("input", { bubbles: true }));
                await new Promise((r) => {
                  requestAnimationFrame(() => requestAnimationFrame(r));
                });
                return {
                  ms: performance.now() - s,
                  count: document.querySelectorAll(".note-card").length,
                };
              }, query);
              if (t.count !== (query ? Math.ceil(count / 2) : count))
                throw Error("search count");
              rows.push({
                source,
                viewport,
                count,
                run,
                cache,
                screen: query ? "search" : "search-clear",
                content: t.ms,
                interactive: t.ms,
                result: t.ms,
              });
            }
            for (const axis of ["horizontal", "vertical"]) {
              const t = await page.evaluate(async (axis) => {
                const s = performance.now();
                if (axis === "horizontal")
                  (() => {
                    const shell = document.querySelector(".board-shell"),
                      last = [...document.querySelectorAll(".column")].at(-1);
                    shell.scrollLeft +=
                      last.getBoundingClientRect().left -
                      shell.getBoundingClientRect().left -
                      12;
                  })();
                else
                  for (const e of document.querySelectorAll(".note-list"))
                    e.scrollTop = 1e9;
                await new Promise((r) => {
                  requestAnimationFrame(() => requestAnimationFrame(r));
                });
                return performance.now() - s;
              }, axis);
              rows.push({
                source,
                viewport,
                count,
                run,
                cache,
                screen: axis + "-scroll",
                content: t,
                interactive: t,
              });
            }
            await page.waitForFunction(
              () =>
                document.querySelector("#save-indicator").dataset.state ===
                "saved",
            );
            await page.evaluate(
              () =>
                new Promise((r) => {
                  requestAnimationFrame(() => requestAnimationFrame(r));
                }),
            );
          }
          await context.close();
          fs.writeFileSync(
            process.env.OUTPUT || "performance/round2/paired.json",
            JSON.stringify(
              {
                date: new Date().toISOString(),
                browser: browser.version(),
                versions,
                rows,
                errors,
              },
              null,
              2,
            ),
          );
          console.log(source, viewport.width, count, run);
        }
  await browser.close();
})();

const fs = require("node:fs"),
  crypto = require("node:crypto");

const { chromium } = require("../scripts/runtime.cjs");
const fixture = require("../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    }),
    rows = [],
    sources = ["performance/before.html", "peta-board.html"];
  const versions = Object.fromEntries(
    sources.map((s) => [
      s,
      crypto.createHash("sha256").update(fs.readFileSync(s)).digest("hex"),
    ]),
  );
  for (const width of [1440, 375])
    for (const count of [0, 50, 500])
      for (let pair = 0; pair < 5; pair++)
        for (const source of pair % 2 ? [...sources].reverse() : sources) {
          fs.copyFileSync(
            source,
            require("node:path").join(
              require("node:os").tmpdir(),
              "peta-board-stable.html",
            ),
          );
          const context = await browser.newContext({
              viewport: { width, height: width === 1440 ? 900 : 812 },
            }),
            page = await context.newPage();
          await page.addInitScript((data) => {
            if (!localStorage.getItem("petaborad.state.v1"))
              localStorage.setItem("petaborad.state.v1", JSON.stringify(data));
            window.__stable = {};
            function frame() {
              if (
                !document.querySelector(".app-shell")?.inert &&
                document.querySelector("#board-title")?.textContent ===
                  "計測ボード"
              ) {
                window.__stable.content = performance.now();
                window.__stable.interactive = performance.now();
              } else requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
          }, fixture(count));
          await page.goto(
            require("node:url").pathToFileURL(
              require("node:path").join(
                require("node:os").tmpdir(),
                "peta-board-stable.html",
              ),
            ).href,
          );
          await page.waitForFunction(() => window.__stable.content);
          if (count === 500) {
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
            await page.reload();
            await page.waitForFunction(() => window.__stable.content);
            rows.push({
              source,
              width,
              count,
              pair,
              screen: "board-steady-warm",
              ...(await page.evaluate(() => window.__stable)),
            });
          }
          await page.waitForFunction(
            () =>
              document.querySelector("#save-indicator").dataset.state ===
              "saved",
          );
          await page.locator("#help-btn").focus();
          const t = await page.evaluate(
            async (offset) => {
              await new Promise((r) => {
                setTimeout(r, offset);
              });
              const start = performance.now();
              document.querySelector("#help-btn").click();
              const modal = document.querySelector("#help-modal"),
                panel = modal.querySelector(".settings-panel");
              let interactive = null,
                content = null;
              function ready() {
                return (
                  !modal.hidden &&
                  !modal.inert &&
                  modal.classList.contains("is-open") &&
                  modal.contains(document.activeElement) &&
                  getComputedStyle(modal).pointerEvents !== "none"
                );
              }
              if (ready()) interactive = performance.now() - start;
              await new Promise((resolve) => {
                function frame() {
                  if (interactive === null && ready())
                    interactive = performance.now() - start;
                  if (
                    content === null &&
                    modal.classList.contains("is-open") &&
                    getComputedStyle(panel).opacity === "1"
                  )
                    content = performance.now() - start;
                  if (content !== null && interactive !== null) resolve();
                  else requestAnimationFrame(frame);
                }
                requestAnimationFrame(frame);
              });
              return { content, interactive };
            },
            (pair * 7) % 16,
          );
          rows.push({
            source,
            width,
            count,
            pair,
            screen: "help-steady",
            ...t,
          });
          await context.close();
          console.log(width, count, pair, source);
          fs.writeFileSync(
            "performance/stable.json",
            JSON.stringify(
              {
                date: new Date().toISOString(),
                browser: browser.version(),
                versions,
                definition:
                  "settled autosave, alternated source order; help ready at event point/focus, content at frame",
                rows,
              },
              null,
              2,
            ),
          );
        }
  await browser.close();
})();

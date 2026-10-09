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
    sources = ["performance/round3/before.html", "peta-board.html"];
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
        "peta-board-empty.html",
      ),
    );
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 375, height: 812 },
    ])
      for (let run = 0; run < 5; run++) {
        const context = await browser.newContext({ viewport }),
          page = await context.newPage();
        await page.addInitScript((data) => {
          if (!localStorage.getItem("petaborad.state.v1"))
            localStorage.setItem("petaborad.state.v1", JSON.stringify(data));
        }, fixture(0));
        for (const cache of ["cold", "warm"]) {
          if (cache === "cold")
            await page.goto(
              require("node:url").pathToFileURL(
                require("node:path").join(
                  require("node:os").tmpdir(),
                  "peta-board-empty.html",
                ),
              ).href,
            );
          else await page.reload();
          await page.waitForFunction(
            () => !document.querySelector(".app-shell").inert,
          );
          if ((await page.locator(".note-card").count()) !== 0)
            throw Error("empty board mismatch");
          async function action(screen, selector, expected) {
            const t = await page.evaluate(
              async ({ selector, expected }) => {
                const start = performance.now();
                document.querySelector(selector).click();
                const el = document.querySelector(expected),
                  panel = el.querySelector(".drawer-panel") || el;
                let interactive = null,
                  content = null;
                await new Promise((resolve) => {
                  function frame() {
                    if (
                      !el.hidden &&
                      !el.inert &&
                      el.classList.contains("is-open") &&
                      getComputedStyle(el).pointerEvents !== "none" &&
                      interactive === null
                    )
                      interactive = performance.now() - start;
                    if (
                      !el.hidden &&
                      el.classList.contains("is-open") &&
                      getComputedStyle(panel).opacity === "1" &&
                      content === null
                    )
                      content = performance.now() - start;
                    if (interactive !== null && content !== null) resolve();
                    else requestAnimationFrame(frame);
                  }
                  requestAnimationFrame(frame);
                });
                return { content, interactive };
              },
              { selector, expected },
            );
            rows.push({ source, viewport, count: 0, run, cache, screen, ...t });
          }
          await action("editor", ".add-note-btn", "#note-drawer");
          if ((await page.locator(".note-card").count()) !== 1)
            throw Error("draft was not created");
          await action("calendar", "#note-due-field", "#date-popover");
          await page.keyboard.press("Escape");
          await page.keyboard.press("Escape");
          await page.waitForFunction(
            () => document.querySelector("#note-drawer").hidden,
          );
          await page.waitForFunction(
            () =>
              document.querySelector("#save-indicator").dataset.state ===
              "saved",
          );
          if ((await page.locator(".note-card").count()) !== 0)
            throw Error("empty draft was not discarded");
        }
        await context.close();
      }
    console.log(source);
  }
  fs.writeFileSync(
    "performance/round3/empty-editor.json",
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
  await browser.close();
})();

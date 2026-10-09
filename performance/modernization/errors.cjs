const fs = require("node:fs");

const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    }),
    rows = [];
  for (const source of [
    "performance/modernization/before.html",
    "peta-board.html",
  ]) {
    fs.copyFileSync(
      source,
      require("node:path").join(
        require("node:os").tmpdir(),
        "peta-board-errors.html",
      ),
    );
    for (const kind of ["zero-columns", "corrupt", "no-locks", "read-failure"])
      for (let run = 0; run < 5; run++) {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 900 },
          }),
          page = await context.newPage();
        await page.addInitScript(
          ({ kind, data }) => {
            if (kind === "corrupt")
              localStorage.setItem("petaborad.state.v1", "{broken");
            else if (kind === "zero-columns")
              localStorage.setItem(
                "petaborad.state.v1",
                JSON.stringify({
                  version: 1,
                  board: { title: "空", columns: [] },
                }),
              );
            else if (kind === "no-locks") {
              localStorage.setItem("petaborad.state.v1", JSON.stringify(data));
              Object.defineProperty(navigator, "locks", { value: undefined });
            } else
              Object.defineProperty(window, "localStorage", {
                get() {
                  throw new DOMException("Denied", "SecurityError");
                },
              });
            window.__errors = {};
            function frame() {
              const app = document.querySelector(".app-shell"),
                title = document.querySelector("#board-title");
              if (app && !app.inert && title?.textContent) {
                if (window.__errors.interactive === undefined)
                  window.__errors.interactive = performance.now();
                let complete = false;
                if (kind === "zero-columns")
                  complete = document.querySelectorAll(".column").length === 0;
                else if (kind === "corrupt") {
                  const toast = document.querySelector("#toast");
                  complete =
                    localStorage.getItem("petaborad.state.v1.corrupt") ===
                      "{broken" &&
                    toast.classList.contains("is-visible") &&
                    getComputedStyle(toast).opacity === "1";
                } else
                  complete =
                    !document.querySelector("#storage-status").hidden &&
                    document.querySelector("#save-indicator").dataset.state ===
                      "error";
                if (complete && window.__errors.content === undefined) {
                  window.__errors.content = performance.now();
                  window.__errors.result = performance.now();
                }
              }
              if (window.__errors.content === undefined)
                requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
          },
          { kind, data: fixture(50) },
        );
        await page.goto(
          require("node:url").pathToFileURL(
            require("node:path").join(
              require("node:os").tmpdir(),
              "peta-board-errors.html",
            ),
          ).href,
        );
        await page.waitForFunction(() => window.__errors.content !== undefined);
        rows.push({
          source,
          kind,
          run,
          ...(await page.evaluate(() => window.__errors)),
        });
        await context.close();
      }
  }
  fs.writeFileSync(
    "performance/modernization/errors.json",
    JSON.stringify(
      { date: new Date().toISOString(), browser: browser.version(), rows },
      null,
      2,
    ),
  );
  console.log("error/empty conditions", rows.length);
  await browser.close();
})();

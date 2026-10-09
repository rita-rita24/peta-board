const fs = require("node:fs");

const { chromium } = require("../scripts/runtime.cjs");
const fixture = require("../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH,
  });
  const rows = [];
  for (const source of [
    "performance/before.html",
    process.argv[2] || "performance/candidate-incremental.html",
  ]) {
    fs.copyFileSync(
      source,
      require("node:path").join(require("node:os").tmpdir(), "candidate.html"),
    );
    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      }),
      page = await context.newPage();
    await page.addInitScript(
      (data) =>
        localStorage.setItem("petaborad.state.v1", JSON.stringify(data)),
      fixture(500),
    );
    await page.goto(
      require("node:url").pathToFileURL(
        require("node:path").join(
          require("node:os").tmpdir(),
          "candidate.html",
        ),
      ).href,
    );
    await page.waitForFunction(
      () => !document.querySelector(".app-shell").inert,
    );
    for (let run = 0; run < 5; run++) {
      for (const query of ["検証対象", ""]) {
        const ms = await page.evaluate(async (query) => {
          const start = performance.now();
          const input = document.querySelector("#search-input");
          input.value = query;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          await new Promise((r) => {
            requestAnimationFrame(() => requestAnimationFrame(r));
          });
          return performance.now() - start;
        }, query);
        rows.push({ source, run, query, ms });
      }
    }
    await context.close();
  }
  await browser.close();
  fs.writeFileSync(
    process.argv[3] || "performance/candidate-check.json",
    JSON.stringify(rows, null, 2),
  );
  console.log(rows);
})();

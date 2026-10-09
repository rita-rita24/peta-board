const fs = require("node:fs");

const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH,
  });
  const results = [];
  for (const width of [320, 375, 1440])
    for (const count of [0, 1, 2, 5, 50, 500]) {
      const shots = [];
      for (const file of [
        "performance/round3/before.html",
        process.env.CANDIDATE || "performance/round3/candidate-body-auto.html",
      ]) {
        const context = await browser.newContext({
            viewport: { width, height: 900 },
          }),
          page = await context.newPage();
        await page.addInitScript(
          (data) =>
            localStorage.setItem("petaborad.state.v1", JSON.stringify(data)),
          fixture(count),
        );
        await page.goto(
          require("node:url").pathToFileURL(require("node:path").resolve(file))
            .href,
        );
        await page.waitForFunction(
          () => !document.querySelector(".app-shell").inert,
        );
        shots.push(
          await page.evaluate(() =>
            [
              ...document.querySelectorAll(
                ".note-card,.note-body,.note-list,.column",
              ),
            ].map((e) => {
              const r = e.getBoundingClientRect();
              return {
                class: [...e.classList]
                  .filter(
                    (c) =>
                      c !== "has-fixed-rows" &&
                      c !== "has-clipped-rows" &&
                      c !== "has-note-footer",
                  )
                  .join(" "),
                width: r.width,
                height: r.height,
                left: r.left,
                top: r.top,
                scrollHeight: e.classList.contains("note-body")
                  ? null
                  : e.scrollHeight,
                scrollWidth: e.classList.contains("note-body")
                  ? null
                  : e.scrollWidth,
                text: e.textContent,
              };
            }),
          ),
        );
        if (count === 500)
          await page.screenshot({
            path: `performance/round3/${width}-${file.includes("before") ? "before" : "after"}.png`,
          });
        await context.close();
      }
      const diff = shots[0]
        .map((s, i) =>
          JSON.stringify(s) === JSON.stringify(shots[1][i])
            ? null
            : { i, before: s, after: shots[1][i] },
        )
        .filter(Boolean);
      results.push({
        width,
        count,
        diffs: diff.slice(0, 5),
        differences: diff.length,
      });
    }
  fs.writeFileSync(
    process.env.OUTPUT || "performance/round3/geometry-body-auto.json",
    JSON.stringify(results, null, 2),
  );
  console.log(
    results.map((x) => ({
      width: x.width,
      count: x.count,
      diffs: x.diffs.length,
    })),
  );
  await browser.close();
})();

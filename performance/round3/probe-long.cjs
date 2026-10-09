const fs = require("node:fs");

const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    }),
    rows = [];
  try {
    for (const file of [
      "before",
      "candidate-pre",
      "candidate-preblock",
      "candidate-prestrict",
      "candidate-strict",
    ]) {
      const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
        }),
        page = await context.newPage();
      await page.addInitScript((d) => {
        localStorage.setItem("petaborad.state.v1", JSON.stringify(d));
        requestAnimationFrame(function t() {
          if (
            !document.querySelector(".app-shell")?.inert &&
            document.querySelector("#board-title")?.textContent === "計測ボード"
          )
            window.__ready = performance.now();
          else requestAnimationFrame(t);
        });
      }, fixture(500));
      await page.goto(
        require("node:url").pathToFileURL(
          require("node:path").resolve(`performance/round3/${file}.html`),
        ).href,
      );
      await page.waitForFunction(() => window.__ready);
      const states = [];
      for (const step of ["initial", "scroll", "tall", "short"]) {
        if (step === "scroll")
          await page.evaluate(() => {
            document.querySelector(".board-shell").scrollLeft = 1e9;
            for (const e of document.querySelectorAll(".note-list"))
              e.scrollTop = 1e9;
          });
        if (step === "tall")
          await page.setViewportSize({ width: 320, height: 1700 });
        if (step === "short")
          await page.setViewportSize({ width: 320, height: 400 });
        await page.evaluate(
          () =>
            new Promise((r) => {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => requestAnimationFrame(r)),
              );
            }),
        );
        states.push({
          step,
          geometry: await page.evaluate(() =>
            [
              ...document.querySelectorAll(
                ".column,.note-list,.note-card,.note-card>*",
              ),
            ].map((e) => {
              const r = e.getBoundingClientRect();
              return {
                cls: e.className,
                rect: [r.x, r.y, r.width, r.height],
                scroll: e.classList.contains("note-body")
                  ? null
                  : [e.scrollHeight, e.scrollWidth],
                text: e.textContent,
              };
            }),
          ),
          scroll: await page.evaluate(() =>
            [...document.querySelectorAll(".note-list")].map(
              (e) => e.scrollTop,
            ),
          ),
        });
      }
      const a = await context.newCDPSession(page);
      const tree = await a.send("Accessibility.getFullAXTree");
      rows.push({
        file,
        ms: await page.evaluate(() => window.__ready),
        states,
        AX: tree.nodes
          .filter((n) => !n.ignored)
          .map((n) => [n.role?.value, n.name?.value, n.value?.value]),
      });
      console.log(
        file,
        rows.at(-1).ms,
        states.map((x) => x.scroll),
      );
      await context.close();
    }
    fs.writeFileSync(
      "performance/round3/probe-long.json",
      JSON.stringify({ date: new Date().toISOString(), rows }),
    );
    console.log(
      rows.map((r) => ({
        file: r.file,
        states: r.states.map(
          (s, i) => JSON.stringify(s) === JSON.stringify(rows[0].states[i]),
        ),
        AX: JSON.stringify(r.AX) === JSON.stringify(rows[0].AX),
      })),
    );
  } finally {
    await browser.close();
  }
})();

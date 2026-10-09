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
  for (const source of ["performance/round2/before.html", "peta-board.html"]) {
    const original = fs.readFileSync(source, "utf8");
    const names = [
      "renderBoard",
      "renderNote",
      "noteMatches",
      "normalizeState",
    ];
    const instrumentation =
      "window.__profile={};" +
      names
        .map(
          (name) =>
            `{const original=${name};${name}=function(...args){const start=performance.now();try{return original(...args)}finally{const r=window.__profile['${name}'] ||= {ms:0,calls:0};r.ms+=performance.now()-start;r.calls++}}}`,
        )
        .join("");
    fs.writeFileSync(
      require("node:path").join(
        require("node:os").tmpdir(),
        "peta-board-r2-profile.html",
      ),
      original.replace(
        "  mountIcons();\n  configureInputLimits();",
        instrumentation + "\n  mountIcons();\n  configureInputLimits();",
      ),
    );
    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      }),
      page = await context.newPage();
    await page.addInitScript(
      (d) => localStorage.setItem("petaborad.state.v1", JSON.stringify(d)),
      fixture(500),
    );
    const session = await context.newCDPSession(page);
    await session.send("Performance.enable");
    await page.goto(
      require("node:url").pathToFileURL(
        require("node:path").join(
          require("node:os").tmpdir(),
          "peta-board-r2-profile.html",
        ),
      ).href,
    );
    await page.waitForFunction(
      () => !document.querySelector(".app-shell").inert,
    );
    const initial = await page.evaluate(() => window.__profile),
      metrics = (await session.send("Performance.getMetrics")).metrics.filter(
        (m) =>
          [
            "LayoutDuration",
            "LayoutCount",
            "RecalcStyleDuration",
            "TaskDuration",
          ].includes(m.name),
      );
    await page.locator("#search-input").focus();
    const search = await page.evaluate(() => {
      window.__profile = {};
      const e = document.querySelector("#search-input");
      e.value = "検証対象";
      e.dispatchEvent(new Event("input", { bubbles: true }));
      return {
        profile: window.__profile,
        cards: document.querySelectorAll(".note-card").length,
      };
    });
    if (search.cards !== 250) throw Error("profile search count");
    rows.push({
      source,
      version: crypto.createHash("sha256").update(original).digest("hex"),
      initial,
      metrics,
      search,
    });
    await context.close();
  }
  fs.writeFileSync(
    "performance/round2/profile.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        note: "Instrumented attribution experiment; do not use timing as final shortening rate",
        rows,
      },
      null,
      2,
    ),
  );
  console.log(
    rows.map((r) => ({
      source: r.source,
      searchMatches: r.search.profile.noteMatches,
      metrics: r.metrics,
    })),
  );
  await browser.close();
})();

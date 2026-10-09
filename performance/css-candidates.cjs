const fs = require("node:fs");

const { chromium } = require("../scripts/runtime.cjs");
const fixture = require("../scripts/fixture.cjs");
(async () => {
  const candidates = {
    baseline: "",
    inline: ".note-card{contain:inline-size}",
    bodyinline: ".note-body{contain:inline-size}",
    layout: ".note-card,.note-list,.column{contain:layout}",
    listinline: ".note-list{contain:inline-size}",
    fixedcolumns: ".note-list,.note-card{grid-template-columns:minmax(0,1fr)}",
    nowrapmeasure: ".note-list{grid-auto-rows:minmax(84px,1fr)}",
  };
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH,
  });
  const rows = [];
  for (const [name, css] of Object.entries(candidates)) {
    const context = await browser.newContext(),
      page = await context.newPage();
    await page.addInitScript(
      (data) =>
        localStorage.setItem("petaborad.state.v1", JSON.stringify(data)),
      fixture(500),
    );
    await page.route("**/candidate.html", (r) =>
      r.fulfill({
        body: fs
          .readFileSync("performance/before.html", "utf8")
          .replace("</head>", `<style>${css}</style></head>`),
        contentType: "text/html",
      }),
    );
    const session = await context.newCDPSession(page);
    await session.send("Performance.enable");
    await page.goto("http://127.0.0.1:8765/candidate.html");
    await page.waitForFunction(
      () => !document.querySelector(".app-shell").inert,
    );
    const metrics = (
      await session.send("Performance.getMetrics")
    ).metrics.filter((m) =>
      ["LayoutDuration", "RecalcStyleDuration"].includes(m.name),
    );
    rows.push({ name, css, metrics });
    console.log(rows.at(-1));
    await context.close();
  }
  fs.writeFileSync(
    "performance/css-candidates.json",
    JSON.stringify(rows, null, 2),
  );
  await browser.close();
})();

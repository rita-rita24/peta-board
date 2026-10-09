const fs = require("node:fs");

const { chromium } = require("../scripts/runtime.cjs");
const fixture = require("../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.addInitScript(
    (data) => localStorage.setItem("petaborad.state.v1", JSON.stringify(data)),
    fixture(500),
  );
  await page.route("**/profile.html", (route) => {
    let html = fs.readFileSync(
      process.argv[2] || "performance/before.html",
      "utf8",
    );
    const names = [
      "renderAll",
      "renderBoard",
      "renderNote",
      "mountIcons",
      "noteMatches",
      "normalizeState",
      "hasStoredStateReduction",
      "appendHighlightedText",
      "renderSettingsControls",
    ];
    const instrumentation =
      `window.__profile={};` +
      names
        .map(
          (name) =>
            `{const original=${name};${name}=function(...args){const t=performance.now();try{return original(...args)}finally{const r=window.__profile['${name}'] ||= {ms:0,calls:0};r.ms+=performance.now()-t;r.calls++}}}`,
        )
        .join("");
    html = html.replace(
      "  mountIcons();\n  configureInputLimits();",
      instrumentation + "\n  mountIcons();\n  configureInputLimits();",
    );
    return route.fulfill({ body: html, contentType: "text/html" });
  });
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  await page.goto("http://127.0.0.1:8765/profile.html");
  await page.waitForFunction(() => !document.querySelector(".app-shell").inert);
  const initial = await page.evaluate(() => window.__profile),
    metrics = await session.send("Performance.getMetrics");
  await page.evaluate(() => {
    window.__profile = {};
    const input = document.querySelector("#search-input");
    input.value = "検証対象";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const search = await page.evaluate(() => window.__profile);
  await page.evaluate(() => {
    window.__profile = {};
    document.querySelector("#clear-search-btn").click();
  });
  const clear = await page.evaluate(() => window.__profile);
  fs.writeFileSync(
    process.argv[3] || "performance/profile.json",
    JSON.stringify({ initial, metrics, search, clear }, null, 2),
  );
  console.log({ initial, search, clear });
  await browser.close();
})();

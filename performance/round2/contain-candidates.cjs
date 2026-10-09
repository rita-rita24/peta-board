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
  const base = fs
    .readFileSync("performance/round2/candidate-card-size.html", "utf8")
    .replace(".note-list.has-clipped-rows > .note-card{contain:size}", "");
  const candidates = {
    baseline: "",
    cardsize: ".note-list.has-clipped-rows>.note-card{contain:size}",
    cardsizelayout:
      ".note-list.has-clipped-rows>.note-card{contain:size layout}",
    bodylayout: ".note-body{contain:layout}",
    listlayout: ".note-list{contain:layout}",
  };
  for (const [name, css] of Object.entries(candidates)) {
    fs.writeFileSync(
      require("node:path").join(
        require("node:os").tmpdir(),
        "peta-board-r2-candidate.html",
      ),
      base.replace("</head>", `<style>${css}</style></head>`),
    );
    for (let run = 0; run < 2; run++) {
      const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
        }),
        page = await context.newPage();
      await page.addInitScript((data) => {
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
      }, fixture(500));
      await page.goto(
        require("node:url").pathToFileURL(
          require("node:path").join(
            require("node:os").tmpdir(),
            "peta-board-r2-candidate.html",
          ),
        ).href,
      );
      await page.waitForFunction(() => window.__done);
      const r = await page.evaluate(() => ({
        ms: window.__done,
        geometry: [
          ...document.querySelectorAll(
            ".note-card,.note-body,.note-list,.column,.kanban-board",
          ),
        ].map((e) => {
          const r = e.getBoundingClientRect();
          return {
            class: e.className,
            w: r.width,
            h: r.height,
            x: r.x,
            y: r.y,
            sh: e.scrollHeight,
            sw: e.scrollWidth,
            text: e.textContent,
          };
        }),
      }));
      rows.push({ name, css, run, ...r });
      console.log(name, run, r.ms);
      await context.close();
    }
    fs.writeFileSync(
      "performance/round2/contain-candidates.json",
      JSON.stringify(
        {
          date: new Date().toISOString(),
          version: crypto.createHash("sha256").update(base).digest("hex"),
          rows,
        },
        null,
        2,
      ),
    );
  }
  await browser.close();
})();

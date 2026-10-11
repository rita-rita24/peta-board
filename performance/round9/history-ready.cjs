const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  path = require("node:path"),
  os = require("node:os"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("../../scripts/runtime.cjs"),
  fixture = require("../../scripts/fixture.cjs");
const sha = (body) => crypto.createHash("sha256").update(body).digest("hex");
const sources = ["performance/round9/before.html", "peta-board.html"];
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "peta-history-ready-"));
const target = path.join(temporary, "board.html");
(async () => {
  let browser;
  const rows = [],
    errors = [];
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    });
    for (let run = 0; run < 5; run++) {
      for (const source of run % 2 ? sources.toReversed() : sources) {
        fs.copyFileSync(source, target);
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
        });
        try {
          await context.addInitScript((data) => {
            if (location.protocol === "about:") return;
            if (!localStorage.getItem("petaborad.state.v1"))
              localStorage.setItem("petaborad.state.v1", JSON.stringify(data));
            window.addEventListener("pageshow", (event) => {
              const check = () => {
                if (
                  !document.querySelector(".app-shell")?.inert &&
                  document.querySelector("#save-indicator")?.dataset.state ===
                    "saved" &&
                  document.querySelectorAll(".note-card").length === 500
                ) {
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                      window.__historyReady = {
                        timestamp: performance.timeOrigin + performance.now(),
                        persisted: event.persisted,
                        state: window.__PETA_BOARD_TEST__.getState(),
                        cards: document.querySelectorAll(".note-card").length,
                      };
                    }),
                  );
                } else requestAnimationFrame(check);
              };
              requestAnimationFrame(check);
            });
          }, fixture(500));
          const page = await context.newPage();
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(pathToFileURL(target).href);
          await page.waitForFunction(() => window.__historyReady);
          const before = await page.evaluate(() => window.__historyReady.state);
          await page.evaluate(() => {
            window.__historyReady = null;
          });
          await page.goto("about:blank");
          const start = await page.evaluate(
            () => performance.timeOrigin + performance.now(),
          );
          const wallStart = Date.now();
          await page.goBack({ waitUntil: "commit" });
          await page.waitForFunction(() => window.__historyReady);
          const ready = await page.evaluate(() => window.__historyReady);
          assert.deepEqual(ready.state, before);
          assert.equal(ready.cards, 500);
          rows.push({
            source,
            run,
            displayProxy: ready.timestamp - start,
            controllerElapsed: Date.now() - wallStart,
            persisted: ready.persisted,
            stateSha256: sha(JSON.stringify(ready.state)),
          });
          console.log(
            run,
            source,
            rows.at(-1).displayProxy,
            rows.at(-1).controllerElapsed,
          );
        } finally {
          await context.close();
        }
      }
    }
    assert.deepEqual(errors, []);
    assert.equal(new Set(rows.map((row) => row.stateSha256)).size, 1);
    fs.writeFileSync(
      path.join(__dirname, "history-ready.json"),
      JSON.stringify(
        {
          date: new Date().toISOString(),
          browser: browser.version(),
          runnerSha256: sha(fs.readFileSync(__filename)),
          versions: Object.fromEntries(
            sources.map((source) => [source, sha(fs.readFileSync(source))]),
          ),
          definition:
            "500 notes,1440x900,n5/source AB/BA. Browser epoch start in about:blank before goBack; endpoint is restored app ready/saved/500 cards and two rAF, captured inside pageshow, independent of controller wait polling. Includes automation command transport and initial one-rAF readiness check, not physical display. Controller elapsed separately includes goBack/wait/evaluate. Initial fixture unchanged during history navigation; narrower than continuous suite's preceding edits/calendar/wheel sequence.",
          rows,
          errors,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await browser?.close();
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
})();

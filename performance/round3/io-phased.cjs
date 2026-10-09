const fs = require("node:fs");

const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    }),
    rows = [],
    errors = [];
  for (const source of ["performance/round3/before.html", "peta-board.html"]) {
    fs.copyFileSync(
      source,
      require("node:path").join(
        require("node:os").tmpdir(),
        "peta-board-r2-io-phased.html",
      ),
    );
    for (const count of [50])
      for (let run = 0; run < 10; run++) {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 900 },
          }),
          page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        await context.addInitScript((data) => {
          if (!localStorage.getItem("petaborad.state.v1"))
            localStorage.setItem("petaborad.state.v1", JSON.stringify(data));
          window.__io = {};
          const count = data.board.columns.reduce(
            (n, c) => n + c.notes.length,
            0,
          );
          function frame() {
            const io = window.__io,
              confirm = document.querySelector("#confirm-modal");
            if (
              io.select &&
              confirm &&
              !confirm.hidden &&
              confirm.classList.contains("is-open")
            ) {
              if (io.prepInteractive === undefined && !confirm.inert)
                io.prepInteractive = performance.now() - io.select;
              if (
                io.prepContent === undefined &&
                getComputedStyle(confirm.querySelector(".confirm-panel"))
                  .opacity === "1"
              )
                io.prepContent = performance.now() - io.select;
            }
            if (
              io.confirm &&
              document.querySelector("#board-title")?.textContent ===
                "復元ボード" &&
              document.querySelectorAll(".note-card").length === count
            ) {
              if (
                io.interactive === undefined &&
                !document.querySelector(".app-shell").inert
              )
                io.interactive = performance.now() - io.confirm;
              if (
                io.content === undefined &&
                (confirm.hidden ||
                  (confirm.dataset.closing === "true" &&
                    getComputedStyle(confirm.querySelector(".confirm-panel"))
                      .opacity === "0")) &&
                (document.querySelector("#settings-modal").hidden ||
                  (document.querySelector("#settings-modal").dataset.closing ===
                    "true" &&
                    getComputedStyle(document.querySelector(".settings-panel"))
                      .opacity === "0"))
              )
                io.content = performance.now() - io.confirm;
              if (
                io.content !== undefined &&
                io.result === undefined &&
                document.querySelector("#save-indicator").dataset.state ===
                  "saved"
              )
                io.result = performance.now() - io.confirm;
            }
            requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
          document.addEventListener(
            "change",
            (e) => {
              if (e.target.id === "import-board-file")
                window.__io.select = performance.now();
            },
            true,
          );
          document.addEventListener(
            "click",
            (e) => {
              if (e.target.closest("#confirm-ok-btn"))
                window.__io.confirm = performance.now();
              if (e.target.closest("#quick-export-btn"))
                window.__io.export = performance.now();
            },
            true,
          );
        }, fixture(count));
        await page.goto(
          require("node:url").pathToFileURL(
            require("node:path").join(
              require("node:os").tmpdir(),
              "peta-board-r2-io-phased.html",
            ),
          ).href,
        );
        await page.waitForFunction(
          () => !document.querySelector(".app-shell").inert,
        );
        const data = fixture(count);
        data.board.title = "復元ボード";
        await page.locator("#settings-btn").click();
        await page.locator("#import-board-file").setInputFiles({
          name: "restore.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(data)),
        });
        await page.waitForFunction(
          () =>
            window.__io.prepContent !== undefined &&
            window.__io.prepInteractive !== undefined,
        );
        const prep = await page.evaluate(() => ({
          content: window.__io.prepContent,
          interactive: window.__io.prepInteractive,
        }));
        rows.push({ source, count, run, screen: "import-confirm", ...prep });
        await page.evaluate(
          async (phase) => {
            await new Promise((resolve) => {
              requestAnimationFrame((t) =>
                setTimeout(() => {
                  window.__acceptStartPhase = performance.now() - t;
                  document.querySelector("#confirm-ok-btn").click();
                  resolve();
                }, phase),
              );
            });
          },
          (run * 7) % 17,
        );
        await page.waitForFunction(() => window.__io.result !== undefined);
        const restored = await page.evaluate(() => ({
          content: window.__io.content,
          interactive: window.__io.interactive,
          result: window.__io.result,
          cards: document.querySelectorAll(".note-card").length,
        }));
        if (restored.cards !== count) throw Error("restored count");
        rows.push({
          source,
          count,
          run,
          screen: "import-result",
          ...restored,
          startPhase: await page.evaluate(() => window.__acceptStartPhase),
        });
        await page.waitForFunction(
          () =>
            document.querySelector("#settings-modal").hidden &&
            document.querySelector("#confirm-modal").hidden,
        );
        await context.close();
        console.log(source, count, run);
      }
  }
  fs.writeFileSync(
    "performance/round3/io-phased.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        rows,
        errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
  if (errors.length) throw Error(errors.join("\n"));
})();

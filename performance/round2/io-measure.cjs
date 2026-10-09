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
  for (const source of ["performance/round2/before.html", "peta-board.html"]) {
    fs.copyFileSync(
      source,
      require("node:path").join(
        require("node:os").tmpdir(),
        "peta-board-io.html",
      ),
    );
    for (const count of [50, 500])
      for (let run = 0; run < 5; run++) {
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
              "peta-board-io.html",
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
        await page.locator("#confirm-ok-btn").click();
        await page.waitForFunction(() => window.__io.result !== undefined);
        const restored = await page.evaluate(() => ({
          content: window.__io.content,
          interactive: window.__io.interactive,
          result: window.__io.result,
          cards: document.querySelectorAll(".note-card").length,
        }));
        if (restored.cards !== count) throw Error("restored count");
        rows.push({ source, count, run, screen: "import-result", ...restored });
        await page.waitForFunction(
          () =>
            document.querySelector("#settings-modal").hidden &&
            document.querySelector("#confirm-modal").hidden,
        );
        const downloaded = page.waitForEvent("download");
        await page.locator("#quick-export-btn").click();
        const download = await downloaded;
        const savedPath = await download.path();
        const exportTime = await page.evaluate(
          () => performance.now() - window.__io.export,
        );
        const exported = JSON.parse(fs.readFileSync(savedPath, "utf8"));
        if (
          JSON.stringify(exported) !==
          (await page.evaluate(() =>
            JSON.stringify(window.__PETA_BOARD_TEST__.getState()),
          ))
        )
          throw Error("export mismatch");
        rows.push({ source, count, run, screen: "backup", result: exportTime });
        // Observe the receiving tab's frame after normal 160ms autosave and storage synchronization.
        const sibling = await context.newPage();
        await sibling.goto(
          require("node:url").pathToFileURL(
            require("node:path").join(
              require("node:os").tmpdir(),
              "peta-board-io.html",
            ),
          ).href,
        );
        await sibling.waitForFunction(
          () => !document.querySelector(".app-shell").inert,
        );
        await sibling.locator(".note-edit-btn").first().click();
        await page.evaluate(() => {
          window.__syncEnd = new Promise((resolve) => {
            function check() {
              if (
                document.querySelector(".note-title")?.textContent ===
                "同期タイトル"
              ) {
                resolve(performance.timeOrigin + performance.now());
                return;
              }
              requestAnimationFrame(check);
            }
            requestAnimationFrame(check);
          });
        });
        const start = await sibling.evaluate(() => {
          const t = performance.timeOrigin + performance.now();
          const input = document.querySelector("#note-title-input");
          input.value = "同期タイトル";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return t;
        });
        const end = await page.evaluate(() =>
          Promise.race([
            window.__syncEnd,
            new Promise((_, reject) => {
              setTimeout(() => reject(Error("tab sync timeout")), 20000);
            }),
          ]),
        );
        rows.push({
          source,
          count,
          run,
          screen: "tab-sync",
          content: end - start,
          interactive: end - start,
          result: end - start,
        });
        await context.close();
        console.log(source, count, run);
      }
  }
  fs.writeFileSync(
    "performance/round2/io.json",
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

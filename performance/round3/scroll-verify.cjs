const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");

const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    }),
    checks = [],
    errors = [],
    sources = ["performance/round3/before.html", "peta-board.html"];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 375, height: 812 },
  ])
    for (const theme of ["light", "dark"]) {
      const snapshots = [];
      for (const source of sources) {
        const context = await browser.newContext({ viewport }),
          page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        const data = fixture(500);
        data.theme = theme;
        await page.addInitScript(
          (d) => localStorage.setItem("petaborad.state.v1", JSON.stringify(d)),
          data,
        );
        await page.goto(
          require("node:url").pathToFileURL(
            require("node:path").resolve(source),
          ).href,
        );
        await page.waitForFunction(
          () => !document.querySelector(".app-shell").inert,
        );
        assert.equal(
          await page.locator("html").getAttribute("data-theme"),
          theme,
        );
        await page.evaluate(() => {
          const shell = document.querySelector(".board-shell"),
            last = [...document.querySelectorAll(".column")].at(-1);
          shell.scrollLeft +=
            last.getBoundingClientRect().left -
            shell.getBoundingClientRect().left -
            12;
          last.querySelector(".note-list").scrollTop = 1e9;
        });
        await page.evaluate(
          () =>
            new Promise((r) => {
              requestAnimationFrame(() => requestAnimationFrame(r));
            }),
        );
        snapshots.push(
          await page.evaluate(() => {
            const col = [...document.querySelectorAll(".column")].at(-1);
            return [
              ...col.querySelectorAll(".note-list,.note-card,.note-card>*"),
            ].map((e) => {
              const r = e.getBoundingClientRect();
              return {
                class: [...e.classList]
                  .filter(
                    (x) => x !== "has-clipped-rows" && x !== "has-note-footer",
                  )
                  .join(" "),
                rect: [r.x, r.y, r.width, r.height],
                scroll: e.classList.contains("note-body")
                  ? null
                  : [e.scrollHeight, e.scrollWidth],
                text: e.textContent,
              };
            });
          }),
        );
        const last = page
          .locator(".column")
          .last()
          .locator(".note-edit-btn")
          .last();
        await last.click();
        const note = data.board.columns.at(-1).notes.at(-1);
        assert.equal(
          await page.locator("#note-body-input").inputValue(),
          note.body,
        );
        assert.equal(
          await page.locator("#note-title-input").inputValue(),
          note.title,
        );
        await page.keyboard.press("Escape");
        await page.waitForFunction(
          () => document.querySelector("#note-drawer").hidden,
        );
        await page.waitForFunction(
          () =>
            document.querySelector("#save-indicator").dataset.state === "saved",
        );
        assert.equal(
          (await page.evaluate(() => window.__PETA_BOARD_TEST__.getState()))
            .theme,
          theme,
        );
        await context.close();
      }
      assert.deepEqual(snapshots[0], snapshots[1]);
      checks.push({
        viewport,
        theme,
        checks: [
          "末尾列・末尾付箋の全表示寸法と全文一致",
          "スクロール後の編集操作と本文全文",
          "テーマ表示と保存",
        ],
        equal: true,
      });
    }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    "performance/round3/scroll-verification.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        versions: Object.fromEntries(
          sources.map((s) => [
            s,
            crypto
              .createHash("sha256")
              .update(fs.readFileSync(s))
              .digest("hex"),
          ]),
        ),
        checks,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("final scroll and both themes verified");
  await browser.close();
})();

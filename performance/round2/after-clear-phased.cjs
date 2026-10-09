const fs = require("node:fs"),
  crypto = require("node:crypto");

const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    }),
    rows = [],
    errors = [],
    sources = [
      "performance/round2/before.html",
      process.env.CANDIDATE || "peta-board.html",
    ];
  const versions = Object.fromEntries(
    sources.map((s) => [
      s,
      crypto.createHash("sha256").update(fs.readFileSync(s)).digest("hex"),
    ]),
  );
  for (const viewport of [{ width: 1440, height: 900 }])
    for (let run = 0; run < 10; run++)
      for (const source of run % 2 ? [...sources].reverse() : sources) {
        fs.copyFileSync(
          source,
          require("node:path").join(
            require("node:os").tmpdir(),
            "peta-board-r2-phased.html",
          ),
        );
        const context = await browser.newContext({ viewport }),
          page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        await page.addInitScript((d) => {
          if (!localStorage.getItem("petaborad.state.v1"))
            localStorage.setItem("petaborad.state.v1", JSON.stringify(d));
        }, fixture(500));
        for (const cache of ["cold", "warm"]) {
          if (cache === "cold")
            await page.goto(
              require("node:url").pathToFileURL(
                require("node:path").join(
                  require("node:os").tmpdir(),
                  "peta-board-r2-phased.html",
                ),
              ).href,
            );
          else await page.reload();
          await page.waitForFunction(
            () =>
              !document.querySelector(".app-shell").inert &&
              document.querySelector("#save-indicator").dataset.state ===
                "saved",
          );
          const timings = await page.evaluate(
            async ({ phase }) => {
              const rows = [];
              const frames = () =>
                new Promise((r) => {
                  requestAnimationFrame(() => requestAnimationFrame(r));
                });
              async function start() {
                let frame;
                await new Promise((resolve) => {
                  requestAnimationFrame((t) => {
                    frame = t;
                    setTimeout(resolve, phase);
                  });
                });
                return {
                  time: performance.now(),
                  phase: performance.now() - frame,
                };
              }
              for (const [screen, button, root, focus, close] of [
                [
                  "settings",
                  "#settings-btn",
                  "#settings-modal",
                  "#settings-btn",
                  "#close-settings-btn",
                ],
                [
                  "help",
                  "#help-btn",
                  "#help-modal",
                  "#help-btn",
                  "#close-help-btn",
                ],
                [
                  "editor",
                  ".note-edit-btn",
                  "#note-drawer",
                  ".note-edit-btn",
                  null,
                ],
                [
                  "calendar",
                  "#note-due-field",
                  "#date-popover",
                  "#note-due-input",
                  "#date-close-btn",
                ],
              ]) {
                document.querySelector(focus).focus();
                await frames();
                const t = await start();
                document.querySelector(button).click();
                const modal = document.querySelector(root),
                  panel =
                    modal.querySelector(
                      ".drawer-panel,.settings-panel,.confirm-panel",
                    ) || modal;
                if (
                  modal.hidden ||
                  modal.inert ||
                  !modal.classList.contains("is-open") ||
                  getComputedStyle(modal).pointerEvents === "none"
                )
                  throw Error("native operation not ready " + screen);

                performance.now() - t.time;

                await new Promise((resolve) => {
                  function check() {
                    if (getComputedStyle(panel).opacity === "1") {
                      content = performance.now() - t.time;
                      resolve();
                    } else requestAnimationFrame(check);
                  }
                  requestAnimationFrame(check);
                });
                if (close) document.querySelector(close).click();
                if (screen === "reset-confirm")
                  document.querySelector("#close-settings-btn").click();
              }
              document.querySelector("#drawer-done-btn").click();
              const input = document.querySelector("#search-input");
              input.focus();
              await frames();
              for (const query of ["検証対象", ""]) {
                const t = await start();
                if (query) {
                  input.value = query;
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                } else document.querySelector("#clear-search-btn").click();
                const expected = query ? 250 : 500;
                if (
                  document.querySelectorAll(".note-card").length !== expected ||
                  document.querySelector(".app-shell").inert
                )
                  throw Error("search not ready");

                performance.now() - t.time;
                await frames();

                performance.now() - t.time;
              }
              for (const [screen, button, root, focus, close] of [
                [
                  "confirmation",
                  "#settings-btn",
                  "#settings-modal",
                  "#settings-btn",
                  null,
                ],
                [
                  "reset-confirm",
                  "#reset-board-btn",
                  "#confirm-modal",
                  "#reset-board-btn",
                  "#confirm-cancel-btn",
                ],
              ]) {
                document.querySelector(focus).focus();
                await frames();
                const t = await start();
                document.querySelector(button).click();
                const modal = document.querySelector(root),
                  panel =
                    modal.querySelector(
                      ".drawer-panel,.settings-panel,.confirm-panel",
                    ) || modal;
                if (
                  modal.hidden ||
                  modal.inert ||
                  !modal.classList.contains("is-open") ||
                  getComputedStyle(modal).pointerEvents === "none"
                )
                  throw Error("native operation not ready " + screen);
                const interactive = performance.now() - t.time;
                let content;
                await new Promise((resolve) => {
                  function check() {
                    if (getComputedStyle(panel).opacity === "1") {
                      content = performance.now() - t.time;
                      resolve();
                    } else requestAnimationFrame(check);
                  }
                  requestAnimationFrame(check);
                });
                rows.push({
                  screen,
                  content,
                  interactive,
                  startPhase: t.phase,
                  targetPhase: phase,
                });
                if (close) document.querySelector(close).click();
                if (screen === "reset-confirm")
                  document.querySelector("#close-settings-btn").click();
              }
              return rows;
            },
            { phase: (run * 7) % 17 },
          );
          rows.push(
            ...timings.map((t) => ({
              source,
              viewport,
              count: 500,
              run,
              cache,
              ...t,
            })),
          );
        }
        await context.close();
        fs.writeFileSync(
          process.env.OUTPUT || "performance/round2/after-clear-phased.json",
          JSON.stringify(
            {
              date: new Date().toISOString(),
              browser: browser.version(),
              versions,
              definition:
                "same prior settings/help/editor/calendar then search and clear-button order; settle two frames; await rAF then identical 0..16ms phase delay; native interactive immediately after click/dispatch; content next opaque rAF (modal), two rAF (search/scroll)",
              rows,
              errors,
            },
            null,
            2,
          ),
        );
        console.log(source, viewport.width, run);
      }
  await browser.close();
  if (errors.length) throw Error(errors.join("\n"));
})();

const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");

const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
const source = process.argv[2],
  output = process.argv[3];
(async () => {
  const b = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    }),
    rows = [],
    errors = [];
  try {
    for (const n of [50, 500])
      for (let run = 0; run < Number(process.env.REPEATS || 5); run++)
        for (const type of ["note", "column"]) {
          const c = await b.newContext({
              viewport: { width: 1440, height: 900 },
            }),
            p = await c.newPage();
          p.on("pageerror", (e) => errors.push(e.message));
          await p.addInitScript((d) => {
            if (!localStorage.getItem("petaborad.state.v1"))
              localStorage.setItem("petaborad.state.v1", JSON.stringify(d));
          }, fixture(n));
          await p.goto(
            process.env.TARGET_URL || pathToFileURL(path.resolve(source)).href,
          );
          await p.waitForFunction(
            () =>
              !document.querySelector(".app-shell").inert &&
              document.querySelector("#save-indicator").dataset.state ===
                "saved",
          );
          if (process.env.FILTER_QUERY)
            await p.locator("#search-input").fill(process.env.FILTER_QUERY);
          const from = await p
            .locator(type === "note" ? ".note-card" : ".column-handle")
            .first()
            .boundingBox();
          const target = await p
            .locator(
              type === "note"
                ? ".column:nth-child(2) .note-card"
                : ".column:nth-child(3)",
            )
            .first()
            .boundingBox();
          const id = await p
            .locator(type === "note" ? ".note-card" : ".column")
            .first()
            .getAttribute(type === "note" ? "data-note-id" : "data-column-id");
          await p.evaluate(
            ({ type, id }) => {
              let pointerDown, moveStart;
              const isDragging = () =>
                Boolean(
                  document.querySelector(
                    type === "note" ? ".is-dragging" : ".is-column-dragging",
                  ),
                );
              document.addEventListener(
                "pointerdown",
                () => {
                  pointerDown = performance.now();
                },
                true,
              );
              document.addEventListener(
                "pointermove",
                () => {
                  moveStart = performance.now();
                },
                true,
              );
              document.addEventListener("pointermove", () => {
                if (
                  pointerDown !== undefined &&
                  isDragging() &&
                  window.__grab === undefined
                ) {
                  const triggeringMove = moveStart;
                  window.__grab = {
                    downToState: performance.now() - pointerDown,
                    triggeringMoveHandler: performance.now() - moveStart,
                  };
                  window.__grabFrame = new Promise((resolve) => {
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() =>
                        resolve(performance.now() - triggeringMove),
                      ),
                    );
                  });
                }
              });
              const valid = () => {
                const s = window.__PETA_BOARD_TEST__.getState();
                if (type === "note")
                  return (
                    s.board.columns[1].notes[0].id === id &&
                    document
                      .querySelectorAll(".column")[1]
                      .querySelector(".note-card").dataset.noteId === id
                  );
                return (
                  s.board.columns[1].id === id &&
                  document.querySelectorAll(".column")[1].dataset.columnId ===
                    id
                );
              };
              document.addEventListener(
                "pointerup",
                () => {
                  window.__start = performance.now();
                  window.__done = new Promise((resolve) => {
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() =>
                        resolve({
                          ready: performance.now() - window.__start,
                          valid: valid(),
                        }),
                      ),
                    );
                  });
                  window.__save = new Promise((resolve) => {
                    function check() {
                      if (
                        document.querySelector("#save-indicator").dataset
                          .state === "saved" &&
                        valid()
                      )
                        resolve(performance.now() - window.__start);
                      else requestAnimationFrame(check);
                    }
                    requestAnimationFrame(check);
                  });
                },
                true,
              );
              document.addEventListener("pointerup", () => {
                window.__handler = performance.now() - window.__start;
                window.__handlerReady =
                  valid() &&
                  !document.querySelector(".app-shell").inert &&
                  document
                    .querySelectorAll(".column")[1]
                    .querySelector(".note-edit-btn")?.disabled === false;
              });
            },
            { type, id },
          );
          await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
          await p.mouse.down();
          await p.mouse.move(target.x + 30, target.y + 10, { steps: 6 });
          await p.evaluate(
            () =>
              new Promise((r) => {
                requestAnimationFrame(() => requestAnimationFrame(r));
              }),
          );
          await p.mouse.up();
          const result = await p.evaluate(async () => ({
            ...(await window.__done),
            handler: window.__handler,
            handlerReady: window.__handlerReady,
            save: await window.__save,
            grab: { ...window.__grab, resultProxy: await window.__grabFrame },
          }));
          assert(result.valid);
          assert(Object.values(result.grab).every(Number.isFinite));
          assert(result.handlerReady);
          assert(await p.locator("#note-drawer").isHidden());
          assert.equal(
            await p
              .locator(
                ".drop-marker,.column-drop-marker,.is-dragging,.is-column-dragging,.is-drop-target",
              )
              .count(),
            0,
          );
          const state = await p.evaluate(() =>
            window.__PETA_BOARD_TEST__.getState(),
          );
          await p.reload();
          await p.waitForFunction(
            () => !document.querySelector(".app-shell").inert,
          );
          const reloaded = await p.evaluate(() =>
            window.__PETA_BOARD_TEST__.getState(),
          );
          assert.deepEqual(reloaded.board, state.board);
          const boundaries = await p.evaluate(() =>
            [...document.querySelectorAll(".column")].every(
              (col, i, all) =>
                col.querySelector('[aria-label="左へ移動"]').disabled ===
                  (i === 0) &&
                col.querySelector('[aria-label="右へ移動"]').disabled ===
                  (i === all.length - 1),
            ),
          );
          assert(boundaries);
          rows.push({ n, type, run, ...result });
          console.log(n, type, run, result);
          await c.close();
        }
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      output,
      JSON.stringify(
        {
          date: new Date().toISOString(),
          source,
          version: crypto
            .createHash("sha256")
            .update(fs.readFileSync(source))
            .digest("hex"),
          browser: b.version(),
          viewport: "1440x900",
          url:
            process.env.TARGET_URL || pathToFileURL(path.resolve(source)).href,
          filterQuery: process.env.FILTER_QUERY || null,
          definition:
            "Grab: pointerdown to drag class includes robot transport/path/threshold delay; triggeringMoveHandler is synchronous move to drag class, not input queue. Grab resultProxy is two rAF, not real Paint/display. Native mouse: first note to head of second column / first column before third. Start pointerup capture; ready at second rAF with correct state+DOM; save indicator and reload verify persistence. Handler is synchronous pointerup processing. Each run independent browser context.",
          rows,
          errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await b.close();
  }
})();

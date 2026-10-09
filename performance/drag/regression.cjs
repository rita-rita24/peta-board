const fs = require("node:fs"),
  assert = require("node:assert/strict");

const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
(async () => {
  const b = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    }),
    versions = [],
    errors = [],
    checks = [];
  try {
    for (const file of ["performance/drag/before.html", "peta-board.html"]) {
      const html = fs
        .readFileSync(file, "utf8")
        .replace(
          "  mountIcons();\n  configureInputLimits();",
          "window.__dragTest={moveNote,moveColumnBefore,getBeforeCard,getBeforeColumn,dropMarker,columnDropMarker,finishPointerDrag,finishColumnDrag};\n  mountIcons();\n  configureInputLimits();",
        );
      fs.writeFileSync(
        require("node:path").join(
          require("node:os").tmpdir(),
          "peta-drag-regression.html",
        ),
        html,
      );
      const snapshots = [];
      for (const width of [375, 1440])
        for (const kind of ["small", "spread", "dense", "two"]) {
          const data = fixture(kind === "small" ? 50 : 500);
          if (kind === "dense")
            data.board.columns = [
              {
                id: "c0",
                title: "列0",
                notes: data.board.columns.flatMap((c) => c.notes),
              },
              { id: "c1", title: "列1", notes: [] },
            ];
          if (kind === "two")
            data.board.columns = [
              {
                id: "c0",
                title: "検索限定",
                notes: data.board.columns[0].notes.slice(0, 2),
              },
              { id: "c1", title: "移動先", notes: [] },
            ];
          const c = await b.newContext({ viewport: { width, height: 900 } }),
            p = await c.newPage();
          p.on("pageerror", (e) => errors.push(e.message));
          await p.addInitScript((d) => {
            Date.now = () => 1791500000000;
            localStorage.setItem("petaborad.state.v1", JSON.stringify(d));
          }, data);
          await p.goto(
            require("node:url").pathToFileURL(
              require("node:path").join(
                require("node:os").tmpdir(),
                "peta-drag-regression.html",
              ),
            ).href,
          );
          await p.waitForFunction(
            () => !document.querySelector(".app-shell").inert,
          );
          const oracle = await p.evaluate(() => {
            let cases = 0;
            const h = window.__dragTest;
            function compare(items, fn, start, size) {
              const points = [
                -10000,
                100000,
                ...items
                  .filter(
                    (_, i) =>
                      i % Math.max(1, Math.floor(items.length / 30)) === 0,
                  )
                  .flatMap((el) => {
                    const r = el.getBoundingClientRect(),
                      v = r[start] + r[size] / 2;
                    return [v - 0.01, v, v + 0.01];
                  }),
              ];
              for (const x of points) {
                let best = null,
                  offset = -Infinity;
                for (const el of items) {
                  const r = el.getBoundingClientRect(),
                    o = x - r[start] - r[size] / 2;
                  if (o < 0 && o > offset) {
                    offset = o;
                    best = el;
                  }
                }
                if (fn(x) !== best) throw Error("hit-test mismatch");
                cases++;
              }
            }
            const list = document.querySelector(".note-list");
            list.firstElementChild.classList.add("is-dragging");
            for (const scroll of [0, 200, 100000]) {
              list.scrollTop = scroll;
              for (const marker of [false, true]) {
                if (marker)
                  list.insertBefore(
                    h.dropMarker,
                    list.children[Math.min(3, list.children.length - 1)],
                  );
                else h.dropMarker.remove();
                compare(
                  [...list.querySelectorAll(".note-card:not(.is-dragging)")],
                  (y) => h.getBeforeCard(list, y),
                  "top",
                  "height",
                );
              }
            }
            h.dropMarker.remove();
            list.firstElementChild.classList.remove("is-dragging");
            list.scrollTop = 0;
            for (const scroll of [0, 200, 100000]) {
              document.querySelector(".board-shell").scrollLeft = scroll;
              compare(
                [...document.querySelectorAll(".column")],
                (x) => h.getBeforeColumn(x),
                "left",
                "width",
              );
            }
            document.querySelector(".board-shell").scrollLeft = 0;
            return cases;
          });
          checks.push({ file, width, kind, oracle });
          async function snap(label) {
            await p.evaluate(
              () =>
                new Promise((r) => {
                  requestAnimationFrame(() => requestAnimationFrame(r));
                }),
            );
            snapshots.push({
              width,
              kind,
              label,
              ...(await p.evaluate(() => ({
                state: window.__PETA_BOARD_TEST__.getState().board,
                summary: document.querySelector("#board-summary").textContent,
                cols: [...document.querySelectorAll(".column")].map((c) => ({
                  id: c.dataset.columnId,
                  count: c.querySelector(".column-count").textContent,
                  left: c.querySelector('[aria-label="左へ移動"]').disabled,
                  right: c.querySelector('[aria-label="右へ移動"]').disabled,
                  empty: c.querySelector(".column-empty")?.textContent ?? null,
                  cards: [...c.querySelectorAll(".note-card")].map((n) => ({
                    id: n.dataset.noteId,
                    col: n.dataset.columnId,
                    text: n.textContent,
                    width: n.getBoundingClientRect().width,
                    height: n.getBoundingClientRect().height,
                  })),
                })),
              }))),
            });
          }
          await snap("initial");
          await p.evaluate(() => {
            const s = window.__PETA_BOARD_TEST__.getState();
            window.__dragTest.moveNote(
              s.board.columns[0].notes[0].id,
              "c1",
              null,
            );
          });
          await snap("cross-column append");
          await p.evaluate(() => {
            const s = window.__PETA_BOARD_TEST__.getState();
            window.__dragTest.moveNote(
              s.board.columns[0].notes[0].id,
              "c1",
              s.board.columns[1].notes[0].id,
            );
          });
          await snap("cross-column before");
          await p.evaluate(() => {
            const s = window.__PETA_BOARD_TEST__.getState();
            window.__dragTest.moveNote(
              s.board.columns[1].notes[0].id,
              "c1",
              null,
            );
          });
          await snap("same-column append");
          await p.evaluate(() =>
            window.__dragTest.moveColumnBefore("c0", null),
          );
          await snap("column to end");
          await p.evaluate(() =>
            window.__dragTest.moveColumnBefore("c0", "c1"),
          );
          await snap("column before");
          await p
            .locator("#search-input")
            .fill(kind === "two" ? "検索限定" : "検証対象");
          await snap("filtered");
          await p.evaluate(() => {
            const s = window.__PETA_BOARD_TEST__.getState();
            if (s.board.columns[0].notes.length)
              window.__dragTest.moveNote(
                s.board.columns[0].notes[0].id,
                "c1",
                null,
              );
            else
              window.__dragTest.moveNote(
                s.board.columns[1].notes[0].id,
                "c0",
                null,
              );
          });
          await snap("filtered cross-column");
          await p.locator("#search-input").fill("");
          await snap("clear search");
          await c.close();
        }
      versions.push(snapshots);
    }
    assert.deepEqual(versions[1], versions[0]);
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      process.env.OUTPUT || "performance/drag/regression.json",
      JSON.stringify(
        {
          date: new Date().toISOString(),
          snapshots: versions[0].length,
          checks,
          errors,
          equal: true,
        },
        null,
        2,
      ),
    );
    console.log(
      "parity snapshots",
      versions[0].length,
      "geometry comparisons",
      checks.reduce((s, c) => s + c.oracle, 0),
    );
  } finally {
    await b.close();
  }
})();

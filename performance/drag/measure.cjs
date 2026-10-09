const fs = require("node:fs"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict");

const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
function data(kind) {
  const d = fixture(kind === "small" ? 50 : 500);
  if (kind === "dense") {
    d.board.columns = [
      {
        id: "c0",
        title: "列0",
        notes: d.board.columns.flatMap((c) => c.notes),
      },
      { id: "c1", title: "列1", notes: [] },
    ];
  }
  return d;
}
const source = process.argv[2] || "performance/drag/before.html",
  output = process.argv[3] || "performance/drag/before.json";
const names = [
  "previewPointerDrop",
  "previewColumnDrop",
  "getBeforeCard",
  "getBeforeColumn",
  "finishPointerDrag",
  "finishColumnDrag",
  "renderBoard",
];
const code = fs
  .readFileSync(source, "utf8")
  .replace(
    "  mountIcons();\n  configureInputLimits();",
    "window.__dm={};window.__resetDM=()=>window.__dm={rects:0,functions:{},frames:[],events:0};const __rect=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(...args){if(window.__dm.rects!==undefined)window.__dm.rects++;return __rect.apply(this,args)};" +
      names
        .map(
          (n) =>
            `{const f=${n};${n}=function(...args){const t=performance.now();try{return f(...args)}finally{if(window.__dm.functions){const r=window.__dm.functions['${n}']||={ms:0,calls:0,max:0};const ms=performance.now()-t;r.ms+=ms;r.calls++;r.max=Math.max(r.max,ms)}}}}`,
        )
        .join("") +
      'document.addEventListener("pointerdown",e=>window.__pid=e.pointerId,true);document.addEventListener("pointerup",e=>window.__up=performance.now(),true);\n  mountIcons();\n  configureInputLimits();',
  );
fs.writeFileSync(
  require("node:path").join(
    require("node:os").tmpdir(),
    "peta-drag-measure.html",
  ),
  code,
);
(async () => {
  const b = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    }),
    rows = [],
    errors = [];
  try {
    for (const kind of ["small", "spread", "dense"])
      for (let run = 0; run < 5; run++) {
        const c = await b.newContext({
            viewport: { width: 1440, height: 900 },
          }),
          p = await c.newPage();
        p.on("pageerror", (e) => errors.push(e.message));
        await p.addInitScript((d) => {
          if (!localStorage.getItem("petaborad.state.v1"))
            localStorage.setItem("petaborad.state.v1", JSON.stringify(d));
        }, data(kind));
        await p.goto(
          require("node:url").pathToFileURL(
            require("node:path").join(
              require("node:os").tmpdir(),
              "peta-drag-measure.html",
            ),
          ).href,
        );
        await p.waitForFunction(
          () =>
            !document.querySelector(".app-shell").inert &&
            document.querySelector("#save-indicator").dataset.state === "saved",
        );
        for (const type of ["note", "column"]) {
          const box = await p
              .locator(type === "note" ? ".note-card" : ".column-handle")
              .first()
              .boundingBox(),
            x = box.x + box.width / 2,
            y = box.y + box.height / 2;
          await p.mouse.move(x, y);
          await p.mouse.down();
          await p.mouse.move(x + 12, y + 12);
          await p.evaluate(
            () =>
              new Promise((r) => {
                requestAnimationFrame(() => requestAnimationFrame(r));
              }),
          );
          const metrics = await p.evaluate(
            async ({ x, y, type }) => {
              window.__resetDM();
              const samples = [];
              let last;
              for (let i = 0; i < 20; i++) {
                await new Promise((r) => {
                  requestAnimationFrame((t) => {
                    if (last !== undefined) window.__dm.frames.push(t - last);
                    last = t;
                    r();
                  });
                });
                const start = performance.now();
                for (let j = 0; j < 8; j++) {
                  const xx = type === "column" ? x + 15 + (i % 2) * 20 : x + 15,
                    yy = type === "note" ? y + 15 + (i % 2) * 15 : y + 15;
                  document.dispatchEvent(
                    new PointerEvent("pointermove", {
                      pointerId: window.__pid,
                      pointerType: "mouse",
                      buttons: 1,
                      bubbles: true,
                      cancelable: true,
                      clientX: xx,
                      clientY: yy,
                    }),
                  );
                  window.__dm.events++;
                }
                samples.push(performance.now() - start);
              }
              await new Promise((r) => {
                requestAnimationFrame(() => requestAnimationFrame(r));
              });
              return {
                ...window.__dm,
                samples,
                markerReady:
                  document.querySelector(
                    type === "note" ? ".drop-marker" : ".column-drop-marker",
                  ) !== null,
              };
            },
            { x, y, type },
          );
          assert(metrics.markerReady);
          await p.keyboard.press("Escape");
          await p.mouse.up();
          assert.equal(
            await p.locator(".drop-marker,.column-drop-marker").count(),
            0,
          );
          rows.push({ kind, type, run, ...metrics });
          console.log(
            source,
            kind,
            type,
            run,
            metrics.rects,
            metrics.functions[
              type === "note" ? "getBeforeCard" : "getBeforeColumn"
            ],
          );
        }
        await c.close();
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
              viewport: { width: 1440, height: 900 },
              definition:
                "20 rAF sampling windows, each injects 8 pointermoves; operation CPU and rAF timestamp intervals, not confirmed paint/compositor/physical presentation; synthetic high-frequency input, genuine mouse capture and Esc/up cleanup; no commits",
              rows,
              errors,
            },
            null,
            2,
          ),
        );
      }
    assert.deepEqual(errors, []);
  } finally {
    await b.close();
  }
})();

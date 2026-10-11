const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");

const engines = require("../../scripts/runtime.cjs");
const engine = process.env.BROWSER || "chromium";
const fixture = require("../../scripts/fixture.cjs");
const outputDirectory = process.env.OUTPUT_DIR || "performance/round9/boundary";
const sourceFiles = [
  process.env.BASELINE_SOURCE || "performance/round9/before.html",
  process.env.CANDIDATE || "performance/round9/candidate-inline.html",
];
function varied(n) {
  const d = fixture(n);
  for (const [i, note] of d.board.columns.flatMap((c) => c.notes).entries()) {
    note.title = note.id + " " + (i % 3 ? "短い題名" : "長い題名".repeat(20));
    note.body =
      i % 4 === 0
        ? "一行"
        : i % 4 === 1
          ? "一行\n二行"
          : i % 4 === 2
            ? "\n".repeat(10) + "長文".repeat(1200)
            : "本文".repeat(2000);
    note.tags =
      i % 2 ? [] : ["とても長いタグ".repeat(3), "仕事", "確認", "追加"];
    note.dueDate = i % 2 ? "" : "2026-10-01";
    note.checklist = i % 2 ? [] : note.checklist;
  }
  return d;
}
(async () => {
  const browser = await engines[engine].launch({
      headless: true,
      ...(engine === "chromium" && process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : {}),
    }),
    results = [];
  try {
    for (let run = 0; run < Number(process.env.TRIALS || 1); run++)
      for (const width of process.env.CONTROL_ONLY ? [320] : [320, 375, 1440])
        for (const [count, variant] of process.env.CONTROL_ONLY
          ? [[500, true]]
          : [
              [5, false],
              [50, false],
              [500, false],
              [50, true],
              [500, true],
            ]) {
          const snapshots = [];
          for (const source of sourceFiles) {
            const context = await browser.newContext({
                viewport: { width, height: 900 },
              }),
              page = await context.newPage();
            await page.addInitScript(
              (d) =>
                localStorage.setItem("petaborad.state.v1", JSON.stringify(d)),
              variant ? varied(count) : fixture(count),
            );
            await page.goto(
              require("node:url").pathToFileURL(
                require("node:path").resolve(source),
              ).href,
            );
            await page.waitForFunction(
              () => !document.querySelector(".app-shell").inert,
            );
            const states = [];
            async function capture(label) {
              await page.waitForFunction(
                () =>
                  document.querySelector("#save-indicator").dataset.state ===
                  "saved",
              );
              // 既存UIの最長140msの遷移が終わった状態を比較する。
              await page.waitForTimeout(180);
              await page.evaluate(
                () =>
                  new Promise((r) => {
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() =>
                        requestAnimationFrame(() => requestAnimationFrame(r)),
                      ),
                    );
                  }),
              );
              const geometry = await page.evaluate(() =>
                [
                  ...document.querySelectorAll(
                    ".column,.note-list,.note-card,.note-card>*",
                  ),
                ].map((e) => {
                  const r = e.getBoundingClientRect();
                  return {
                    class: e.className,
                    rect: [r.x, r.y, r.width, r.height],
                    scroll: [
                      e.scrollHeight,
                      e.scrollWidth,
                      e.scrollTop,
                      e.scrollLeft,
                    ],
                    text: e.textContent,
                  };
                }),
              );
              const shot = await page.screenshot({ animations: "disabled" });
              fs.writeFileSync(
                `${outputDirectory}/check-${run}-${width}-${count}-${variant}-${label.replaceAll(" ", "_")}-${source.includes("before") ? "before" : "after"}.png`,
                shot,
              );
              states.push({
                label,
                geometry,
                pixels: crypto.createHash("sha256").update(shot).digest("hex"),
              });
            }
            await capture("initial");
            await page.locator("#search-input").fill(variant ? "n1" : "付箋1");
            await capture("filtered threshold");
            await page.evaluate(
              () => (document.querySelector(".board-shell").scrollLeft = 1e9),
            );
            await capture("horizontal last column");
            await page.evaluate(() => {
              for (const e of document.querySelectorAll(".note-list"))
                e.scrollTop = 1e9;
            });
            await capture("vertical bottom");
            await page.setViewportSize({ width, height: 1700 });
            await capture("resize taller");
            await page.setViewportSize({ width, height: 400 });
            await capture("resize shorter");
            await page.evaluate(() => {
              document.documentElement.style.fontSize = "24px";
              document.documentElement.style.setProperty(
                "--pb-note-body-lines",
                "5",
              );
            });
            await capture("larger font and five lines");
            const accessibility = await page
              .locator("#kanban-board")
              .ariaSnapshot();
            snapshots.push({ states, accessibility });
            await context.close();
          }
          for (let i = 0; i < snapshots[0].states.length; i++) {
            const b = snapshots[0].states[i],
              a = snapshots[1].states[i];
            const geometryEqual =
                JSON.stringify(b.geometry) === JSON.stringify(a.geometry),
              pixelsEqual = b.pixels === a.pixels;
            results.push({
              run,
              width,
              count,
              variant,
              label: b.label,
              geometryEqual,
              pixelsEqual,
            });
            if (!geometryEqual) {
              fs.writeFileSync(
                `${outputDirectory}/display-diff.json`,
                JSON.stringify(
                  {
                    date: new Date().toISOString(),
                    sourceFiles,
                    browser: browser.version(),
                    runnerSha256: crypto
                      .createHash("sha256")
                      .update(fs.readFileSync(__filename))
                      .digest("hex"),
                    b,
                    a,
                  },
                  null,
                  2,
                ),
              );
              throw Error(
                "display geometry differs " + JSON.stringify(results.at(-1)),
              );
            }
            if (!pixelsEqual)
              console.log("pixel mismatch", width, count, variant, b.label);
          }
          assert.deepEqual(
            snapshots[0].accessibility,
            snapshots[1].accessibility,
            "accessibility differs",
          );
          fs.writeFileSync(
            `${outputDirectory}/display.json`,
            JSON.stringify(
              {
                date: new Date().toISOString(),
                engine,
                browser: browser.version(),
                runnerSha256: crypto
                  .createHash("sha256")
                  .update(fs.readFileSync(__filename))
                  .digest("hex"),
                versions: Object.fromEntries(
                  sourceFiles.map((s) => [
                    s,
                    crypto
                      .createHash("sha256")
                      .update(fs.readFileSync(s))
                      .digest("hex"),
                  ]),
                ),
                bodyInternalScrollSizeExcluded: false,
                results,
                accessibilityEqual: true,
                accessibilityDefinition:
                  "Playwright board ariaSnapshot roles/names/text/values, exact comparison; visible pixels and all body/card/list dimensions and scroll also compared",
              },
              null,
              2,
            ),
          );
          console.log(width, count, variant, "identical");
        }
    assert.ok(
      results.every((result) => result.pixelsEqual),
      "settled pixels differ; see display.json",
    );
  } finally {
    await browser.close();
  }
})();

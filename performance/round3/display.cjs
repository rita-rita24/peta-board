const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");

const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
const sourceFiles = [
  "performance/round3/before.html",
  process.env.CANDIDATE || "performance/round3/candidate-pre.html",
];
function varied(n) {
  const d = fixture(n);
  for (const [i, note] of d.board.columns.flatMap((c) => c.notes).entries()) {
    note.title = i % 3 ? "短い題名" : "長い題名".repeat(20);
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
  const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    }),
    results = [];
  for (const width of [320, 375, 1440])
    for (const [count, variant] of [
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
          (d) => localStorage.setItem("petaborad.state.v1", JSON.stringify(d)),
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
                class: [...e.classList]
                  .filter(
                    (c) => c !== "has-clipped-rows" && c !== "has-note-footer",
                  )
                  .join(" "),
                rect: [r.x, r.y, r.width, r.height],
                scroll: e.classList.contains("note-body")
                  ? null
                  : [e.scrollHeight, e.scrollWidth],
                text: e.textContent,
              };
            }),
          );
          const shot = await page.screenshot({ animations: "disabled" });
          fs.writeFileSync(
            `performance/round3/check-${width}-${count}-${variant}-${label.replaceAll(" ", "_")}-${source.includes("before") ? "before" : "after"}.png`,
            shot,
          );
          states.push({
            label,
            geometry,
            pixels: crypto.createHash("sha256").update(shot).digest("hex"),
          });
        }
        await capture("initial");
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
        const session = await context.newCDPSession(page);
        const tree = await session.send("Accessibility.getFullAXTree");
        const accessibility = tree.nodes
          .filter((n) => !n.ignored && n.role?.value !== "InlineTextBox")
          .map((n) => [n.role?.value, n.name?.value, n.value?.value]);
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
          width,
          count,
          variant,
          label: b.label,
          geometryEqual,
          pixelsEqual,
        });
        if (!geometryEqual) {
          fs.writeFileSync(
            "performance/round3/display-diff.json",
            JSON.stringify({ b, a }, null, 2),
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
        "performance/round3/display.json",
        JSON.stringify(
          {
            date: new Date().toISOString(),
            versions: Object.fromEntries(
              sourceFiles.map((s) => [
                s,
                crypto
                  .createHash("sha256")
                  .update(fs.readFileSync(s))
                  .digest("hex"),
              ]),
            ),
            bodyInternalScrollSizeExcluded:
              "overflow:hidden line-clamped body only; card/list scroll extent and visible pixels checked",
            results,
            accessibilityEqual: true,
            accessibilityDefinition:
              "semantic roles/names/values including complete StaticText; browser-internal InlineTextBox line fragments excluded because zero-height text stops wrapping",
          },
          null,
          2,
        ),
      );
      console.log(width, count, variant, "identical");
    }
  await browser.close();
})();

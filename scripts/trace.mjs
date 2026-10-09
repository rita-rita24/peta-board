import { writeFile, mkdtemp, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("./runtime.cjs");
const fixture = require("./fixture.cjs");
const directory = await mkdtemp(join(tmpdir(), "peta-trace-"));
const target = join(directory, "board.html");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});
const summaries = [];
const columnMode = process.env.TRACE_FIELD === "column";
const outputDirectory = process.env.EVIDENCE_DIR || "performance/modernization";
try {
  for (const [source, label] of [
    [
      process.env.TRACE_BASELINE || "performance/modernization/before.html",
      "before",
    ],
    ["peta-board.html", "after"],
  ]) {
    await copyFile(source, target);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const data = fixture(500);
    data.board.columns = [
      {
        id: "c0",
        title: "列0",
        notes: data.board.columns.flatMap((column) => column.notes),
      },
    ];
    data.board.columns[0].notes.forEach((note) => {
      note.title = "共通 " + note.id;
    });
    await page.addInitScript(
      (data) =>
        localStorage.setItem("petaborad.state.v1", JSON.stringify(data)),
      data,
    );
    await page.goto(pathToFileURL(target).href);
    await page.waitForFunction(
      () => document.querySelector("#save-indicator").dataset.state === "saved",
    );
    await page.locator("#search-input").fill(columnMode ? "検証" : "共通");
    if (!columnMode) await page.locator(".note-edit-btn").first().click();
    const inputSelector = columnMode ? ".column-title" : "#note-title-input";
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    const session = await context.newCDPSession(page);
    const events = [];
    session.on("Tracing.dataCollected", ({ value }) => events.push(...value));
    await session.send("Tracing.start", {
      categories:
        "devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline.frame",
      transferMode: "ReportEvents",
    });
    await page.locator(inputSelector).evaluate((input) => {
      input.addEventListener(
        "input",
        () => performance.mark("input-" + input.value),
        true,
      );
    });
    for (let step = 0; step < 5; step++) {
      await page.locator(inputSelector).fill("変更" + step);
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          }),
      );
    }
    const completed = new Promise((resolve) => {
      session.once("Tracing.tracingComplete", resolve);
    });
    await session.send("Tracing.end");
    await completed;
    await writeFile(
      `${outputDirectory}/trace-${label}.json`,
      JSON.stringify({ traceEvents: events }),
    );
    const starts = events.filter((event) =>
      event.name.startsWith("input-変更"),
    );
    const paints = events.filter((event) => event.name === "Paint");
    const samples = starts.map((start) => {
      const next = paints.find(
        (paint) => paint.pid === start.pid && paint.ts >= start.ts,
      );
      return {
        mark: start.name,
        firstRendererPaintMs: next ? (next.ts - start.ts) / 1000 : null,
      };
    });
    summaries.push({
      source,
      label,
      samples,
      paintEvents: paints.length,
      layoutMs: events
        .filter((e) => e.name === "Layout")
        .reduce((sum, e) => sum + (e.dur || 0) / 1000, 0),
    });
    await context.close();
  }
  await writeFile(
    `${outputDirectory}/trace-summary.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        field: columnMode ? "column title" : "note title",
        definition:
          "Native Playwright fill input events; capture-phase input mark to first Paint in same renderer. CDP timeline captures real renderer painting, not physical display/compositor latency or INP. Five events in one dense filtered input session; field recorded separately. Instrumented attribution, not uninstrumented trial results.",
        summaries,
      },
      null,
      2,
    ),
  );
  console.log(summaries);
} finally {
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}

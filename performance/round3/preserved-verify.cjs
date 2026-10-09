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
    rows = [],
    errors = [],
    sources = [
      "performance/round3/before.html",
      process.env.CANDIDATE || "peta-board.html",
    ];
  for (const source of sources) {
    fs.copyFileSync(
      source,
      require("node:path").join(
        require("node:os").tmpdir(),
        "peta-board-r2-preserved.html",
      ),
    );
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await context.addInitScript((d) => {
      if (!localStorage.getItem("petaborad.state.v1"))
        localStorage.setItem("petaborad.state.v1", JSON.stringify(d));
    }, fixture(500));
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      require("node:url").pathToFileURL(
        require("node:path").join(
          require("node:os").tmpdir(),
          "peta-board-r2-preserved.html",
        ),
      ).href,
    );
    await page.waitForFunction(
      () =>
        !document.querySelector(".app-shell").inert &&
        document.querySelector("#save-indicator").dataset.state === "saved",
    );
    const sibling = await context.newPage();
    await sibling.goto(
      require("node:url").pathToFileURL(
        require("node:path").join(
          require("node:os").tmpdir(),
          "peta-board-r2-preserved.html",
        ),
      ).href,
    );
    await sibling.waitForFunction(
      () => !document.querySelector(".app-shell").inert,
    );
    await page.bringToFront();
    for (const kind of ["reduce", "grow", "filtered"]) {
      if (kind === "filtered") await page.locator("#search-input").fill("仕事");
      await page.locator(".column-title").first().focus();
      await page.evaluate(() => {
        window.__keptInput = document.querySelector(".column-title");
        window.__keptInput.setSelectionRange(1, 2);
      });
      const data = fixture(500);
      if (kind === "reduce")
        data.board.columns[0].notes = data.board.columns[0].notes.slice(0, 2);
      else if (kind === "filtered")
        for (const n of data.board.columns[0].notes.slice(2)) n.tags = [];
      await sibling.evaluate(async (d) => {
        const hook = window.__PETA_BOARD_TEST__;
        hook.setState(d);
        await hook.saveStateNow();
      }, data);
      const expected = kind === "grow" ? 42 : 2;
      await page.waitForFunction(
        (n) =>
          document
            .querySelector(".column .note-list")
            .querySelectorAll(".note-card").length === n,
        expected,
      );
      await page.evaluate(
        () =>
          new Promise((r) => {
            requestAnimationFrame(() => requestAnimationFrame(r));
          }),
      );
      const row = await page.evaluate(() => {
        const input = document.querySelector(".column-title"),
          list = document.querySelector(".column .note-list"),
          body = list.querySelector(".note-body");
        return {
          kept: input === window.__keptInput,
          focused: document.activeElement === input,
          selection: [input.selectionStart, input.selectionEnd],
          count: list.querySelectorAll(".note-card").length,
          bodyText: body.textContent,
          bodyHeight: body.getBoundingClientRect().height,
          cardHeight: list.querySelector(".note-card").getBoundingClientRect()
            .height,
          bodyContain: getComputedStyle(body).contain,
          summary: document.querySelector("#board-summary").textContent,
        };
      });
      assert.equal(row.kept, true);
      assert.equal(row.focused, true);
      assert.deepEqual(row.selection, [1, 2]);
      rows.push({ source, kind, ...row });
    }
    await context.close();
    console.log(source);
  }
  for (const kind of ["reduce", "grow", "filtered"]) {
    const before = rows.find((r) => r.source === sources[0] && r.kind === kind),
      after = rows.find((r) => r.source === sources[1] && r.kind === kind);
    for (const key of [
      "bodyText",
      "bodyHeight",
      "cardHeight",
      "summary",
      "selection",
      "kept",
      "focused",
      "count",
    ])
      assert.deepEqual(after[key], before[key], kind + " " + key);
    if (kind !== "grow") assert.equal(after.bodyContain, "none");
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    "performance/round3/preserved-verification.json",
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
        rows,
        errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
  console.log(
    "preserved input, updated counts, body display and filtering verified",
  );
})();

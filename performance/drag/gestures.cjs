const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");

const { chromium } = require("../../scripts/runtime.cjs");
const fixture = require("../../scripts/fixture.cjs");
(async () => {
  const b = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    }),
    checks = [],
    errors = [];
  try {
    const c = await b.newContext({ viewport: { width: 1440, height: 900 } }),
      p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(pathToFileURL(path.resolve("peta-board.html")).href);
    await p.waitForFunction(() => !document.querySelector(".app-shell").inert);
    await p.evaluate((d) => {
      window.__PETA_BOARD_TEST__.setState(d);
      document.addEventListener(
        "pointerdown",
        (e) => (window.__pid = e.pointerId),
        true,
      );
    }, fixture(500));
    const state = () =>
      p.evaluate(() =>
        JSON.stringify(window.__PETA_BOARD_TEST__.getState().board),
      );
    const original = await state();
    const frame = () =>
      p.evaluate(
        () =>
          new Promise((r) => {
            requestAnimationFrame(() => requestAnimationFrame(r));
          }),
      );
    const start = async (type = "note") => {
      const r = await p
        .locator(type === "note" ? ".note-card" : ".column-handle")
        .first()
        .boundingBox();
      await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
      await p.mouse.down();
      return r;
    };
    const clean = async () => {
      assert.equal(
        await p
          .locator(
            ".drop-marker,.column-drop-marker,.is-dragging,.is-column-dragging,.is-drop-target",
          )
          .count(),
        0,
      );
      assert(await p.locator("#note-drawer").isHidden());
    };
    let r = await start();
    await p.mouse.move(r.x + 30, r.y + 40);
    await frame();
    assert.equal(await p.locator(".drop-marker").count(), 1);
    await p.keyboard.press("Escape");
    await p.mouse.up();
    await frame();
    await clean();
    assert.equal(await state(), original);
    checks.push("Escape cancels and suppresses accidental editor click");
    r = await start();
    await p.mouse.move(r.x + 30, r.y + 40);
    await frame();
    await p.mouse.move(1, 1);
    await frame();
    assert.equal(await p.locator(".drop-marker").count(), 0);
    await p.mouse.up();
    await clean();
    assert.equal(await state(), original);
    checks.push("outside board clears preview and does not move");
    r = await start();
    await p.mouse.move(r.x + 30, r.y + 40);
    await frame();
    await p.evaluate(() =>
      document.dispatchEvent(
        new PointerEvent("pointercancel", {
          pointerId: window.__pid,
          bubbles: true,
        }),
      ),
    );
    await p.mouse.up();
    await clean();
    assert.equal(await state(), original);
    checks.push("pointercancel preserves data and clears capture feedback");
    r = await start();
    const dest = await p
      .locator(".column:nth-child(2) .note-card")
      .first()
      .boundingBox();
    await p.evaluate(
      ({ x, y }) =>
        document.dispatchEvent(
          new PointerEvent("pointerup", {
            pointerId: window.__pid,
            pointerType: "mouse",
            button: 0,
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        ),
      { x: dest.x + 20, y: dest.y + 10 },
    );
    await p.mouse.up();
    await frame();
    assert.equal(
      await p
        .locator(".column:nth-child(2) .note-card")
        .first()
        .getAttribute("data-note-id"),
      "n0",
    );
    await clean();
    checks.push("pointerup without pointermove uses final coordinates");
    r = await start("column");
    const col = await p.locator(".column:nth-child(3)").boundingBox();
    await p.evaluate(
      ({ x, y }) =>
        document.dispatchEvent(
          new PointerEvent("pointerup", {
            pointerId: window.__pid,
            pointerType: "mouse",
            button: 0,
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        ),
      { x: col.x + 20, y: col.y + 10 },
    );
    await p.mouse.up();
    await frame();
    assert.equal(
      await p.locator(".column").nth(1).getAttribute("data-column-id"),
      "c0",
    );
    await clean();
    checks.push("column pointerup without pointermove reorders correctly");
    await p.evaluate(
      (d) => window.__PETA_BOARD_TEST__.setState(d),
      fixture(500),
    );
    r = await start();
    const list = await p.locator(".note-list").first().boundingBox();
    await p.mouse.move(list.x + 100, Math.min(list.y + list.height - 4, 895));
    await p.waitForTimeout(250);
    assert(
      (await p
        .locator(".note-list")
        .first()
        .evaluate((el) => el.scrollTop)) > 0,
    );
    await p.keyboard.press("Escape");
    await p.mouse.up();
    await clean();
    checks.push("vertical edge autoscroll");
    await p.setViewportSize({ width: 375, height: 900 });
    r = await start("column");
    const shell = await p.locator(".board-shell").boundingBox();
    await p.mouse.move(Math.min(shell.x + shell.width - 4, 371), r.y + 10);
    await p.waitForTimeout(250);
    assert(
      (await p.locator(".board-shell").evaluate((el) => el.scrollLeft)) > 0,
    );
    await p.keyboard.press("Escape");
    await p.mouse.up();
    await clean();
    checks.push("horizontal edge autoscroll on 375px viewport");
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.evaluate((d) => {
      window.__PETA_BOARD_TEST__.setState(d);
      document.querySelector(".board-shell").scrollLeft = 0;
    }, fixture(50));
    await p.locator(".note-edit-btn").first().click();
    await p.locator("#note-column-input").selectOption("c1");
    assert.equal(
      await p
        .locator(".column:nth-child(2) .note-card")
        .last()
        .getAttribute("data-note-id"),
      "n0",
    );
    assert.equal(await p.locator("#note-column-input").inputValue(), "c1");
    await p.keyboard.press("Escape");
    await frame();
    checks.push("editor column selection updates note destination and drawer");
    const beforeLost = await state();
    r = await start();
    await p.mouse.move(r.x + 30, r.y + 40);
    await frame();
    await p
      .locator(".note-card")
      .first()
      .evaluate((el) =>
        el.dispatchEvent(
          new PointerEvent("lostpointercapture", {
            pointerId: window.__pid,
            bubbles: true,
          }),
        ),
      );
    await p.mouse.up();
    await clean();
    assert.equal(await state(), beforeLost);
    checks.push("lost pointer capture cancels without accidental editor");
    await p.evaluate(() => {
      const body = document.querySelector(".note-body");
      body.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 77,
          pointerType: "touch",
          button: 0,
          bubbles: true,
          clientX: 100,
          clientY: 200,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 77,
          pointerType: "touch",
          bubbles: true,
          clientX: 500,
          clientY: 300,
        }),
      );
    });
    await frame();
    assert.equal(await p.locator(".drop-marker,.is-dragging").count(), 0);
    checks.push("touch outside handle does not start dragging");
    await p.evaluate(() => {
      const handle = document.querySelector(".note-drag-handle"),
        rect = handle.getBoundingClientRect();
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 78,
          pointerType: "touch",
          button: 0,
          bubbles: true,
          clientX: rect.x + 2,
          clientY: rect.y + 2,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 78,
          pointerType: "touch",
          bubbles: true,
          cancelable: true,
          clientX: rect.x + 40,
          clientY: rect.y + 40,
        }),
      );
    });
    await frame();
    assert.equal(await p.locator(".is-dragging").count(), 1);
    await p.evaluate(() =>
      document.dispatchEvent(
        new PointerEvent("pointercancel", { pointerId: 78, bubbles: true }),
      ),
    );
    await clean();
    assert.equal(await state(), beforeLost);
    checks.push("synthetic touch handle starts and cancels dragging");
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      process.env.OUTPUT || "performance/drag/gestures.json",
      JSON.stringify(
        { date: new Date().toISOString(), checks, errors },
        null,
        2,
      ),
    );
    console.log(checks);
    await c.close();
  } finally {
    await b.close();
  }
})();

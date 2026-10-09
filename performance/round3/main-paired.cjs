const fs = require("node:fs");
const crypto = require("node:crypto");
const { chromium } = require("../../scripts/runtime.cjs");

process.argv[2] || "before.html";
const output = process.argv[3] || "round3/main-paired.json";
const repeats = Number(process.env.REPEATS || 10);
const fixture = require("../../scripts/fixture.cjs");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH,
    headless: true,
  });
  const rows = [],
    errors = [],
    versions = Object.fromEntries(
      ["performance/round3/before.html", "peta-board.html"].map((s) => [
        s,
        crypto.createHash("sha256").update(fs.readFileSync(s)).digest("hex"),
      ]),
    );
  for (const viewport of [{ width: 375, height: 812 }])
    for (const count of [500])
      for (let run = 0; run < repeats; run++)
        for (const source of run % 2
          ? ["peta-board.html", "performance/round3/before.html"]
          : ["performance/round3/before.html", "peta-board.html"]) {
          const target = source;
          fs.copyFileSync(
            source,
            require("node:path").join(
              require("node:os").tmpdir(),
              "peta-r3-main-paired.html",
            ),
          );
          const context = await browser.newContext({ viewport });
          const page = await context.newPage();
          page.on("pageerror", (e) => errors.push(e.message));
          // Fresh browser context = isolated initial browser state; identical normalized fixture in localStorage,
          // absent IndexedDB revision DB on first access. No access to user's browser profile.
          await page.addInitScript(
            ({ data }) => {
              if (!localStorage.getItem("petaborad.state.v1"))
                localStorage.setItem(
                  "petaborad.state.v1",
                  JSON.stringify(data),
                );
              window.__timings = {};
              const frame = () => {
                document.querySelectorAll(".note-card").length;
                if (
                  document.querySelector("#board-title")?.textContent ===
                    "計測ボード" &&
                  !window.__timings.content
                )
                  window.__timings.content = performance.now();
                if (
                  window.__timings.content &&
                  !document.querySelector(".app-shell").inert &&
                  !window.__timings.interactive
                )
                  window.__timings.interactive = performance.now();
                requestAnimationFrame(frame);
              };
              requestAnimationFrame(frame);
            },
            { data: fixture(count) },
          );
          const url =
            process.env.TARGET_URL ||
            `http://127.0.0.1:8765/${target === "before.html" ? "performance/" : ""}${target}`;
          for (const cache of ["cold", "warm"]) {
            if (cache === "cold") await page.goto(url);
            else await page.reload();
            await page.waitForFunction(() => window.__timings.interactive);
            const t = await page.evaluate(() => window.__timings);
            if ((await page.locator(".note-card").count()) !== count)
              throw Error("initial count mismatch");
            rows.push({
              source: target,
              viewport,
              count,
              run,
              cache,
              screen: "board",
              ...t,
            });
            async function action(screen, selector, expected) {
              const result = await page.evaluate(
                async ({ selector, expected }) => {
                  const start = performance.now();
                  document.querySelector(selector).click();
                  const el = document.querySelector(expected);
                  const panel =
                    el.querySelector(
                      ".drawer-panel,.settings-panel,.confirm-panel",
                    ) || el;
                  let interactive = null,
                    content = null;
                  await new Promise((resolve) => {
                    function check() {
                      if (
                        !el.hidden &&
                        !el.inert &&
                        getComputedStyle(el).pointerEvents !== "none" &&
                        (el.classList.contains("is-open") ||
                          expected === "#date-popover") &&
                        interactive === null
                      )
                        interactive = performance.now() - start;
                      if (
                        !el.hidden &&
                        getComputedStyle(panel).opacity === "1" &&
                        (el.classList.contains("is-open") ||
                          expected === "#date-popover") &&
                        content === null
                      )
                        content = performance.now() - start;
                      if (interactive !== null && content !== null) resolve();
                      else requestAnimationFrame(check);
                    }
                    requestAnimationFrame(check);
                  });
                  return { content, interactive };
                },
                { selector, expected },
              );
              rows.push({
                source: target,
                viewport,
                count,
                run,
                cache,
                screen,
                ...result,
              });
            }
            await action("settings", "#settings-btn", "#settings-modal");
            await page.locator("#close-settings-btn").click();
            await page.waitForFunction(
              () => document.querySelector("#settings-modal").hidden,
            );
            await action("help", "#help-btn", "#help-modal");
            await page.locator("#close-help-btn").click();
            await page.waitForFunction(
              () => document.querySelector("#help-modal").hidden,
            );
            if (count) {
              await action("editor", ".note-edit-btn", "#note-drawer");
              await action("calendar", "#note-due-field", "#date-popover");
              await page.keyboard.press("Escape");
              await page.waitForFunction(
                () => document.querySelector("#date-popover").hidden,
              );
              await page.keyboard.press("Escape");
              await page.waitForFunction(
                () => document.querySelector("#note-drawer").hidden,
              );
            }
            if (process.env.MODALS_ONLY) {
              await action("confirmation", "#settings-btn", "#settings-modal");
              await action(
                "reset-confirm",
                "#reset-board-btn",
                "#confirm-modal",
              );
              await page.locator("#confirm-cancel-btn").click();
              await page.waitForFunction(
                () => document.querySelector("#confirm-modal").hidden,
              );
              await page.locator("#close-settings-btn").click();
              await page.waitForFunction(
                () => document.querySelector("#settings-modal").hidden,
              );
              continue;
            }
            await page.locator("#search-input").focus();
            await page.evaluate(
              () =>
                new Promise((r) => {
                  requestAnimationFrame(() => requestAnimationFrame(r));
                }),
            );
            const search = await page.evaluate(async () => {
              const start = performance.now();
              const input = document.querySelector("#search-input");
              input.value = "検証対象";
              input.dispatchEvent(new Event("input", { bubbles: true }));
              await new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
              });
              return {
                content: performance.now() - start,
                interactive: performance.now() - start,
                result: performance.now() - start,
                cards: document.querySelectorAll(".note-card").length,
                summary: document.querySelector("#board-summary").textContent,
              };
            });
            if (search.cards !== Math.ceil(count / 2))
              throw Error("search count mismatch");
            rows.push({
              source: target,
              viewport,
              count,
              run,
              cache,
              screen: "search",
              ...search,
            });
            const clear = await page.evaluate(async () => {
              const start = performance.now();
              document.querySelector("#clear-search-btn").click();
              await new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
              });
              return {
                content: performance.now() - start,
                interactive: performance.now() - start,
              };
            });
            rows.push({
              source: target,
              viewport,
              count,
              run,
              cache,
              screen: "search-clear",
              ...clear,
            });
            await action("confirmation", "#settings-btn", "#settings-modal");
            await action("reset-confirm", "#reset-board-btn", "#confirm-modal");
            await page.locator("#confirm-cancel-btn").click();
            await page.waitForFunction(
              () => document.querySelector("#confirm-modal").hidden,
            );
            await page.locator("#close-settings-btn").click();
            await page.waitForFunction(
              () => document.querySelector("#settings-modal").hidden,
            );
          }
          await context.close();
          fs.writeFileSync(
            `performance/${output}`,
            JSON.stringify(
              {
                date: new Date().toISOString(),
                url,
                versions,
                platform: process.platform,
                mode: process.env.TARGET_URL?.startsWith("file:")
                  ? "local-file"
                  : "localhost",
                modalDefinition:
                  "content: panel opacity=1; interactive: is-open, non-inert, pointer-events enabled",
                searchDefinition:
                  "focused input, settled two frames; input event or clear click to correct result after two frames",
                version: crypto
                  .createHash("sha256")
                  .update(
                    fs.readFileSync(
                      target === "before.html"
                        ? "performance/before.html"
                        : target,
                    ),
                  )
                  .digest("hex"),
                browser: browser.version(),
                repeats,
                rows,
                errors,
              },
              null,
              2,
            ),
          );
          console.log(viewport.width, count, run, "done");
        }
  await browser.close();
  if (errors.length) throw Error(errors.join("\n"));
})();

import assert from "node:assert/strict";
import { copyFile, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const directory = process.env.EVIDENCE_DIR || "performance/round5";
const sources = [`${directory}/before.html`, "peta-board.html"];
const temporary = await mkdtemp(join(tmpdir(), "peta-drag-release-"));
const target = join(temporary, "board.html");
const rows = [],
  stages = [];
const version = createHash("sha256")
  .update(await readFile("peta-board.html"))
  .digest("hex");
async function run(file, args, extra = {}) {
  assert.equal(
    createHash("sha256")
      .update(await readFile("peta-board.html"))
      .digest("hex"),
    version,
  );
  await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      stdio: "inherit",
      env: { ...process.env, ...extra },
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? accept() : reject(new Error(`${file}: ${code}`)),
    );
  });
}
try {
  for (const query of ["", "検証"])
    for (let pair = 0; pair < 5; pair++)
      for (const source of pair % 2 ? sources.toReversed() : sources) {
        await copyFile(source, target);
        const label = source === "peta-board.html" ? "current" : "before";
        const output = `${directory}/drag-commit-${query ? "filtered" : "all"}-${label}-${pair}.json`;
        await run("performance/drag/commit.cjs", [source, output], {
          REPEATS: "1",
          TARGET_URL: pathToFileURL(target).href,
          FILTER_QUERY: query,
        });
        const data = JSON.parse(await readFile(output, "utf8"));
        rows.push(
          ...data.rows.map((row) => ({
            ...row,
            run: pair,
            query,
            source,
            date: data.date,
            sourceHash: data.version,
            url: data.url,
          })),
        );
      }
  await writeFile(
    `${directory}/drag-commits.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        version,
        rows,
        definition:
          "Native mouse, 1440x900,50/500notes,note/column,empty and matching query. AB/BA paired5 contexts/condition, same temporary URL. Grab state/2rAF, final state/2rAF and save+reload are distinct; no physical display/INP.",
      },
      null,
      2,
    ),
  );
  for (const query of ["", "検証"]) {
    const output = `${directory}/production-drag-${query ? "filtered" : "all"}.json`;
    await run("performance/drag/commit.cjs", ["peta-board.html", output], {
      REPEATS: "5",
      FILTER_QUERY: query,
    });
    stages.push({ file: output, passed: true });
  }
  for (const [source, label] of [
    [sources[0], "before"],
    [sources[1], "after"],
  ]) {
    const output = `${directory}/drag-movement-${label}.json`;
    await run("performance/drag/measure.cjs", [source, output]);
    stages.push({ file: output, passed: true });
  }
  await writeFile(
    `${directory}/drag-stages.json`,
    JSON.stringify(
      { version, date: new Date().toISOString(), stages },
      null,
      2,
    ),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const directory = process.env.EVIDENCE_DIR || "performance/round5";
const url = pathToFileURL(resolve("peta-board.html")).href;
const hash = async () =>
  createHash("sha256")
    .update(await readFile("peta-board.html"))
    .digest("hex");
const version = await hash();
const stages = [];
async function run(name, file, args, extra) {
  assert.equal(
    await hash(),
    version,
    "Distribution changed during measurement",
  );
  const start = new Date().toISOString();
  console.log("Starting", name, version);
  await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      stdio: "inherit",
      env: { ...process.env, EVIDENCE_DIR: directory, ...extra },
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? accept() : reject(new Error(`${name}: exit ${code}`)),
    );
  });
  assert.equal(await hash(), version);
  stages.push({ name, start, end: new Date().toISOString(), passed: true });
  await writeFile(
    `${directory}/measurement-stages.json`,
    JSON.stringify({ version, url, stages }, null, 2),
  );
}
await run("paired operations", "scripts/remaining-operations.mjs", [], {
  BASELINE_SOURCE: `${directory}/before.html`,
  MORE_OPERATIONS: "1",
});
await run("distribution operations", "scripts/remaining-operations.mjs", [], {
  PRODUCTION_ONLY: "1",
  PRODUCTION_URL: url,
  MORE_OPERATIONS: "1",
});
await run("paired renderer traces", "scripts/remaining-operations.mjs", [], {
  BASELINE_SOURCE: `${directory}/before.html`,
  MORE_OPERATIONS: "1",
  COUNTS: "500",
  TRACE_OPERATIONS: "1",
  OUTPUT: `${directory}/final-operation-traces.json`,
});
await run("native distribution theme", "scripts/theme-performance.mjs", [], {
  PRODUCTION_ONLY: "1",
  PRODUCTION_URL: url,
  OUTPUT: `${directory}/theme-production-after.json`,
});
await run(
  "distribution screens",
  "performance/modernization/screens.cjs",
  [
    "peta-board.html",
    `${directory.replace(/^performance\//, "")}/production-screens.json`,
  ],
  { TARGET_URL: url },
);
await run("distribution continuous operations", "scripts/continuous.mjs", [], {
  PRODUCTION_ONLY: "1",
  PRODUCTION_URL: url,
  OUTPUT: `${directory}/production-continuous.json`,
});
await run("distribution history stress", "scripts/history-stress.mjs", [], {
  PRODUCTION_URL: url,
  OUTPUT: `${directory}/history.json`,
});
await run("distribution midnight callback", "scripts/midnight.mjs", [], {
  OUTPUT: `${directory}/midnight.json`,
});

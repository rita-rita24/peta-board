import { spawn } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const directory = await mkdtemp(join(tmpdir(), "peta-screens-"));
const target = join(directory, "board.html");
async function run(file, args = [], extra = {}) {
  console.log("Running", file, ...args);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      stdio: "inherit",
      env: { ...process.env, ...extra },
    });
    child.on("error", reject);
    child.on("exit", (status) => {
      if (status === 0) resolve();
      else reject(new Error(`${file} failed: ${status}`));
    });
  });
}
try {
  for (const [source, label] of [
    ["performance/modernization/before.html", "before"],
    ["peta-board.html", "after"],
  ]) {
    if (process.env.AFTER_ONLY && label === "before") continue;
    await run("performance/modernization/measure.cjs", [
      source,
      `performance/modernization/edit-${label}.json`,
    ]);
    await copyFile(source, target);
    await run(
      "performance/modernization/screens.cjs",
      [source, `modernization/screens-${label}.json`],
      { TARGET_URL: pathToFileURL(target).href },
    );
    await run("performance/drag/commit.cjs", [
      source,
      `performance/modernization/drag-commit-${label}.json`,
    ]);
    await run("performance/drag/measure.cjs", [
      source,
      `performance/modernization/drag-${label}.json`,
    ]);
  }
  for (const file of ["io-measure", "errors", "empty-editor"])
    await run(`performance/modernization/${file}.cjs`);
} finally {
  await rm(directory, { recursive: true, force: true });
}

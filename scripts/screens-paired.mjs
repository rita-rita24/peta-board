import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const directory = process.env.EVIDENCE_DIR || "performance/round6";
const sources = [`${directory}/before.html`, "peta-board.html"];
const version = createHash("sha256")
  .update(await readFile(sources[1]))
  .digest("hex");
const temporary = await mkdtemp(join(tmpdir(), "peta-screen-pair-"));
const target = join(temporary, "board.html");
const rows = [];
try {
  for (let run = 0; run < 5; run++) {
    for (const source of run % 2 ? sources.toReversed() : sources) {
      await copyFile(source, target);
      const label = source === sources[1] ? "after" : "before";
      const output = `${directory}/screen-pair-${label}-${run}.json`;
      await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "performance/modernization/screens.cjs",
            source,
            output.replace(/^performance\//, ""),
          ],
          {
            stdio: "inherit",
            env: {
              ...process.env,
              REPEATS: "1",
              TARGET_URL: pathToFileURL(target).href,
            },
          },
        );
        child.on("error", reject);
        child.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`screens: ${code}`)),
        );
      });
      const data = JSON.parse(await readFile(output, "utf8"));
      assert.deepEqual(data.errors, []);
      rows.push(
        ...data.rows.map((row) => ({
          ...row,
          run,
          source,
          version: data.version,
        })),
      );
      assert.equal(
        createHash("sha256")
          .update(await readFile(sources[1]))
          .digest("hex"),
        version,
      );
    }
  }
  await writeFile(
    `${directory}/screens-paired.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        version,
        url: pathToFileURL(target).href,
        definition:
          "Same temporary file URL, AB/BA, five independent contexts per version and condition. Supplement for production sampling differences; not production ratios. All original values retained.",
        rows,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

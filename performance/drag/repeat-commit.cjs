const fs = require("node:fs"),
  { execFileSync } = require("node:child_process");
const files = {
  before: "performance/drag/before.html",
  after: "peta-board.html",
};
const combined = {};
for (const version of ["before", "after"])
  combined[version] = JSON.parse(
    fs.readFileSync(`performance/drag/commit-${version}.json`),
  );
for (let pair = 0; pair < 5; pair++)
  for (const version of pair % 2 ? ["after", "before"] : ["before", "after"]) {
    const out = `performance/drag/commit-${version}-pair${pair}.json`;
    execFileSync(
      process.execPath,
      ["performance/drag/commit.cjs", files[version], out],
      { env: { ...process.env, REPEATS: "1" }, stdio: "inherit" },
    );
    const data = JSON.parse(fs.readFileSync(out));
    if (data.version !== combined[version].version)
      throw Error("source changed");
    combined[version].rows.push(
      ...data.rows.map((r) => ({ ...r, run: pair + 5, date: data.date })),
    );
  }
for (const version of ["before", "after"])
  fs.writeFileSync(
    `performance/drag/commit-${version}-combined.json`,
    JSON.stringify(
      {
        ...combined[version],
        additionalDefinition:
          "Original five plus five additional paired runs, alternating order; each condition 10 measurements.",
        finished: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

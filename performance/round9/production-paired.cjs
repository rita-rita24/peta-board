const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  { spawnSync } = require("node:child_process"),
  { pathToFileURL } = require("node:url");
const directory = __dirname;
const target = path.resolve("peta-board.html");
const original = fs.readFileSync(target);
const sources = [
  "performance/round9/before.html",
  "performance/round9/candidate-search.html",
];
const payloads = sources.map((source) => fs.readFileSync(source));
const sha = (body) => crypto.createHash("sha256").update(body).digest("hex");
assert.equal(
  sha(original),
  sha(payloads[1]),
  "Validated release must be installed before measurement",
);
const runner = path.resolve("scripts/search-render.mjs");
const runnerSha256 = sha(fs.readFileSync(runner));
try {
  for (const variant of ["standard", "unicode"]) {
    const observations = [],
      rows = [];
    let browser;
    for (let cycle = 0; cycle < 5; cycle++) {
      for (const [position, index] of [0, 1, 1, 0].entries()) {
        const output = path.join(
          directory,
          `production-${variant}-${cycle}-${position}.json`,
        );
        fs.writeFileSync(target, payloads[index]);
        const env = {
          ...process.env,
          PRODUCTION_ONLY: "1",
          BROWSER: "chromium",
          ALLOW_CLIPPED_CLASS: "",
          FIXTURE_VARIANT: variant,
          WIDTHS: "1440",
          COUNTS: "500",
          REPEATS: "1",
          OUTPUT: output,
        };
        if (variant === "unicode") env.QUERIES = JSON.stringify(["列"]);
        else delete env.QUERIES;
        const result = spawnSync(process.execPath, [runner], {
          env,
          stdio: "inherit",
          timeout: 180000,
        });
        assert.equal(
          result.status,
          0,
          `Production comparison failed: ${variant}/${cycle}/${position}`,
        );
        const data = JSON.parse(fs.readFileSync(output, "utf8"));
        assert.equal(data.runnerSha256, runnerSha256);
        assert.equal(data.url, pathToFileURL(target).href);
        assert.equal(data.versions["peta-board.html"], sha(payloads[index]));
        assert.deepEqual(data.errors, []);
        if (browser) assert.equal(data.browser, browser);
        browser = data.browser;
        observations.push({
          cycle,
          position,
          source: sources[index],
          date: data.date,
          file: path.basename(output),
          sha256: sha(fs.readFileSync(output)),
        });
        rows.push(
          ...data.rows.map((row) => ({
            ...row,
            source: sources[index],
            cycle,
            position,
          })),
        );
      }
    }
    const beforeHashes = new Map(
      rows
        .filter((row) => row.source === sources[0])
        .map((row) => [row.query, row.behaviorSha256]),
    );
    for (const row of rows)
      assert.equal(
        row.behaviorSha256,
        beforeHashes.get(row.query),
        "Production content/state differ",
      );
    fs.writeFileSync(
      path.join(
        directory,
        `${variant === "standard" ? "search" : "unicode"}-production-interleaved.json`,
      ),
      JSON.stringify(
        {
          date: new Date().toISOString(),
          browser,
          versions: Object.fromEntries(
            sources.map((source, index) => [source, sha(payloads[index])]),
          ),
          runnerSha256,
          wrapperSha256: sha(fs.readFileSync(__filename)),
          url: pathToFileURL(target).href,
          productionOnly: false,
          productionCompared: true,
          fixtureVariant: variant,
          definition:
            "Actual distribution file URL; five ABBA cycles, ten isolated browser contexts/source,1440x900,500 notes. Synthetic input CPU/correct-result-plus-two-rAF proxies; not physical input/display/INP. All behavior hashes compare exactly. Standard queries fixed in underlying runner; Unicode query is only 列. Release restored in finally even on failure.",
          observations,
          rows,
          errors: [],
        },
        null,
        2,
      ),
    );
  }
} finally {
  fs.writeFileSync(target, original);
  assert.equal(
    sha(fs.readFileSync(target)),
    sha(original),
    "Release restore failed",
  );
}

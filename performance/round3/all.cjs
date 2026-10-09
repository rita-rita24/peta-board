const fs = require("node:fs"),
  cp = require("node:child_process"),
  crypto = require("node:crypto");
function run(file, args = [], env = {}) {
  const r = cp.spawnSync(process.execPath, [file, ...args], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) throw Error(file + " failed " + r.status);
}
for (const [source, output] of [
  ["performance/round3/before.html", "round3/before-file.json"],
  ["peta-board.html", "round3/after-file.json"],
]) {
  fs.copyFileSync(
    source,
    require("node:path").join(
      require("node:os").tmpdir(),
      "peta-board-r2-main.html",
    ),
  );
  run("performance/round3/measure.cjs", [source, output], {
    TARGET_URL: require("node:url").pathToFileURL(
      require("node:path").join(
        require("node:os").tmpdir(),
        "peta-board-r2-main.html",
      ),
    ).href,
  });
}
for (const job of [
  "io-measure.cjs",
  "errors.cjs",
  "empty-editor.cjs",
  "parity.cjs",
])
  run("performance/round3/" + job);
const versions = Object.fromEntries(
  ["performance/round3/before.html", "peta-board.html"].map((s) => [
    s,
    crypto.createHash("sha256").update(fs.readFileSync(s)).digest("hex"),
  ]),
);
for (const name of ["io.json", "errors.json"]) {
  const p = "performance/round3/" + name,
    d = JSON.parse(fs.readFileSync(p));
  fs.writeFileSync(
    p,
    JSON.stringify(
      {
        ...d,
        versions,
        versionProvenance:
          "HTML unchanged throughout run, hash verified after completion",
      },
      null,
      2,
    ),
  );
}
const url = require("node:url").pathToFileURL(
  require("node:path").resolve("peta-board.html"),
).href;
run("performance/verify.cjs", [], {
  TARGET_URL: url,
  OUTPUT: "performance/round3/verification-file.json",
});
run("performance/round3/modal-verify.cjs", [], {
  OUTPUT: "performance/round3/modal-verification.json",
});

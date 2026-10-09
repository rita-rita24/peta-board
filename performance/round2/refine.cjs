const cp = require("node:child_process"),
  fs = require("node:fs"),
  crypto = require("node:crypto");
for (const file of ["phased.cjs", "io-phased.cjs", "empty-search.cjs"]) {
  const r = cp.spawnSync(process.execPath, ["performance/round2/" + file], {
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) throw Error(file + " failed " + r.status);
}
const p = "performance/round2/io-phased.json",
  d = JSON.parse(fs.readFileSync(p));
d.versions = Object.fromEntries(
  ["performance/round2/before.html", "peta-board.html"].map((s) => [
    s,
    crypto.createHash("sha256").update(fs.readFileSync(s)).digest("hex"),
  ]),
);
fs.writeFileSync(p, JSON.stringify(d, null, 2));

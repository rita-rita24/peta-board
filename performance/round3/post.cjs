const cp = require("node:child_process");
for (const [file, env] of [
  [
    "paired.cjs",
    {
      CANDIDATE: "peta-board.html",
      OUTPUT: "performance/round3/paired-final.json",
    },
  ],
  ["profile.cjs", {}],
  ["scroll-verify.cjs", {}],
  ["preserved-verify.cjs", {}],
  ["empty-search.cjs", {}],
  ["phased.cjs", {}],
]) {
  const r = cp.spawnSync(process.execPath, ["performance/round3/" + file], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) throw Error(file + " failed " + r.status);
}

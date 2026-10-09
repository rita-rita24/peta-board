const cp = require("node:child_process");
for (const [file, env] of [
  [
    "performance/round2/paired.cjs",
    {
      CANDIDATE: "peta-board.html",
      OUTPUT: "performance/round2/paired-final.json",
    },
  ],
  ["performance/round2/profile.cjs", {}],
  ["performance/round2/scroll-verify.cjs", {}],
]) {
  const r = cp.spawnSync(process.execPath, [file], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) throw Error(file + " failed " + r.status);
}

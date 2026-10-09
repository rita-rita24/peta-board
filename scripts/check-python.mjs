import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const python = process.env.PYTHON || "python3";
for (const args of [
  ["-m", "ruff", "check", "performance", "scripts"],
  ["-m", "ruff", "format", "--check", "performance", "scripts"],
  ["scripts/python-regression.py"],
]) {
  const result = spawnSync(python, args, { stdio: "inherit" });
  assert.equal(result.status, 0, `${python}: ${args.join(" ")}`);
}

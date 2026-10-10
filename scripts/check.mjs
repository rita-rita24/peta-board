import assert from "node:assert/strict";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { Script } from "node:vm";
import { spawnSync } from "node:child_process";

const html = await readFile("peta-board.html", "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1, "Keep one standalone application script");
assert.equal(
  (html.match(/<\/script>/g) ?? []).length,
  scripts.length,
  "Unmatched script end tag",
);
await mkdir(".checks", { recursive: true });
for (const [index, [, source]] of scripts.entries()) {
  new Script(source, { filename: `application-${index}.js` });
  await writeFile(`.checks/application-${index}.js`, source);
}
for (const [index, [, source]] of [
  ...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g),
].entries()) {
  await writeFile(`.checks/style-${index}.css`, source);
}
const prohibited = [
  /\bvar\s+[\w$]/,
  /\.substr\s*\(/,
  /\.hasOwnProperty\s*\(/,
  /document\.write\s*\(/,
  /new\s+FileReader\b/,
  /\.onkeypress\s*=/,
  /\.which\b/,
];
for (const pattern of prohibited)
  assert(!pattern.test(scripts[0][1]), `Obsolete pattern: ${pattern}`);
const files = await readdir("performance", { recursive: true });
for (const file of files.filter((file) => file.endsWith(".cjs"))) {
  new Script(await readFile(`performance/${file}`, "utf8"), { filename: file });
}
const python = files
  .filter((file) => file.endsWith(".py"))
  .map((file) => `performance/${file}`);
const result = spawnSync(
  process.env.PYTHON || "python3",
  [
    "-c",
    'import ast,sys; [ast.parse(open(p, encoding="utf-8").read(), filename=p) for p in sys.argv[1:]]',
    ...python,
  ],
  { stdio: "inherit" },
);
assert.equal(result.status, 0, "Python syntax check failed");
console.log(
  `Application JS, 3 CSS blocks, ${files.filter((file) => file.endsWith(".cjs")).length} CJS and ${python.length} Python files checked`,
);

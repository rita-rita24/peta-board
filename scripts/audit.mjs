import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { createHash } from "node:crypto";
const entries = [];
async function visit(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (
      [
        ".git",
        "node_modules",
        ".checks",
        ".ruff_cache",
        ".venv",
        ".DS_Store",
      ].includes(item.name)
    )
      continue;
    const path = directory === "." ? item.name : `${directory}/${item.name}`;
    if (item.isDirectory()) {
      await visit(path);
      continue;
    }
    const body = await readFile(path);
    const extension = extname(path);
    const category =
      path === "peta-board.html"
        ? "application-source"
        : extension === ".html"
          ? "frozen-comparison-input"
          : [".cjs", ".mjs", ".py", ".yml"].includes(extension)
            ? "tooling-source"
            : [
                  "package.json",
                  ".htmlvalidate.json",
                  ".stylelintrc.json",
                  "pyproject.toml",
                  "requirements-dev.txt",
                  ".gitignore",
                ].includes(path)
              ? "tooling-configuration"
              : path === "package-lock.json"
                ? "generated-dependency-lock"
                : "documentation-or-evidence";
    entries.push({
      path,
      extension,
      category,
      bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
  }
}
await visit(".");
const html = await readFile("peta-board.html", "utf8");
await writeFile(
  process.env.OUTPUT || "performance/modernization/inventory.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      sourceFunctionCount: [...html.matchAll(/^  (?:async )?function /gm)]
        .length,
      codeBlocks: {
        html: 1,
        css: [...html.matchAll(/<style\b/g)].length,
        javascript: [...html.matchAll(/<script\b/g)].length,
      },
      entries: entries.filter(
        (entry) => !entry.path.endsWith("inventory.json"),
      ),
    },
    null,
    2,
  ),
);
console.log("Inventory:", entries.length, "files");

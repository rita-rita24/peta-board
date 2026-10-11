const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const directory = __dirname;
const files = fs
  .readdirSync(directory)
  .filter(
    (name) =>
      /^(?:search|unicode|inline)-.*\.json$/.test(name) &&
      !name.includes("runner"),
  );
const data = Object.fromEntries(
  files.map((name) => [
    name,
    JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")),
  ]),
);
function stats(rows, metric) {
  const values = rows.map((row) => row[metric]).toSorted((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return {
    n: values.length,
    median:
      values.length % 2
        ? values[middle]
        : (values[middle - 1] + values[middle]) / 2,
    minimum: values[0],
    maximum: values.at(-1),
  };
}
function compare(label, before, after) {
  const conditions = new Map(
    before.rows.map((row) => [
      JSON.stringify([row.width, row.count, row.query]),
      row,
    ]),
  );
  const rows = [];
  for (const [key, condition] of conditions) {
    const same = (row) =>
      JSON.stringify([row.width, row.count, row.query]) === key;
    for (const metric of ["handler", "resultProxy"]) {
      const b = stats(before.rows.filter(same), metric),
        a = stats(after.rows.filter(same), metric);
      if (!a.n) continue;
      rows.push({
        label,
        width: condition.width,
        count: condition.count,
        query: condition.query,
        metric,
        before: b,
        after: a,
        saved: b.median - a.median,
        percent: b.median ? ((b.median - a.median) / b.median) * 100 : null,
      });
    }
  }
  return rows;
}
const rows = [];
for (const [name, dataset] of Object.entries(data)) {
  if (!dataset.rows || dataset.productionOnly) continue;
  const sources = Object.keys(dataset.versions);
  if (sources.length !== 2) continue;
  rows.push(
    ...compare(
      dataset.productionCompared
        ? `${name.startsWith("unicode") ? "unicode" : "search"}-ABBA-production`
        : name,
      { rows: dataset.rows.filter((row) => row.source === sources[0]) },
      { rows: dataset.rows.filter((row) => row.source === sources[1]) },
    ),
  );
}
for (const prefix of ["search", "unicode"]) {
  const b = data[`${prefix}-production-before.json`],
    a = data[`${prefix}-production-after.json`];
  if (!b || !a) continue;
  if (
    !b.productionOnly ||
    !a.productionOnly ||
    b.url !== a.url ||
    (b.fixtureVariant || "standard") !== (a.fixtureVariant || "standard") ||
    JSON.stringify(
      b.queries || ["付箋1", "通常", "一致しない語", "", "検証"],
    ) !==
      JSON.stringify(a.queries || ["付箋1", "通常", "一致しない語", "", "検証"])
  )
    throw Error("Production conditions differ");
  assert.equal(b.browser, a.browser, "Production browser differs");
  const byCase = new Map(
    b.rows.map((row) => [
      JSON.stringify([row.width, row.count, row.run, row.query]),
      row.behaviorSha256,
    ]),
  );
  assert.equal(b.rows.length, a.rows.length, "Production sample count differs");
  for (const row of a.rows)
    assert.equal(
      row.behaviorSha256,
      byCase.get(JSON.stringify([row.width, row.count, row.run, row.query])),
      "Production behavior differs",
    );
  rows.push(...compare(`${prefix}-production`, b, a));
}
const relatedRows = [];
for (const name of [
  "remaining-operations.json",
  "continuous.json",
  "continuous-confirm.json",
  "history-ready.json",
]) {
  const filename = path.join(directory, name);
  if (!fs.existsSync(filename)) continue;
  const dataset = JSON.parse(fs.readFileSync(filename, "utf8"));
  const sources = Object.keys(dataset.versions);
  const inputRows =
    name === "history-ready.json"
      ? dataset.rows.map((row) => ({
          ...row,
          width: 1440,
          count: 500,
          operation: "history-ready",
        }))
      : dataset.rows;
  const conditions = new Map(
    inputRows.map((row) => [
      JSON.stringify([row.width, row.count, row.operation]),
      row,
    ]),
  );
  for (const [key, condition] of conditions) {
    for (const metric of [
      "handler",
      "frameReady",
      "savedMs",
      "hiddenMs",
      "resultProxy",
      "controllerElapsed",
      "displayProxy",
    ]) {
      const same = (row, source) =>
        row.source === source &&
        JSON.stringify([row.width, row.count, row.operation]) === key &&
        Number.isFinite(row[metric]);
      const before = stats(
        inputRows.filter((row) => same(row, sources[0])),
        metric,
      );
      const after = stats(
        inputRows.filter((row) => same(row, sources[1])),
        metric,
      );
      if (!before.n || !after.n) continue;
      relatedRows.push({
        label: name,
        width: condition.width,
        count: condition.count,
        operation: condition.operation,
        metric,
        before,
        after,
        saved: before.median - after.median,
        percent: before.median
          ? ((before.median - after.median) / before.median) * 100
          : null,
      });
    }
  }
}
fs.writeFileSync(
  path.join(directory, "related-times.md"),
  "|検証環境／幅／枚数／操作|指標|前中央値ms|後中央値ms|短縮ms|率%|n前/後|前min–max／後min–max ms|\n|---|---|---:|---:|---:|---:|---|---|\n" +
    relatedRows
      .map(
        (row) =>
          `|${row.label}／${row.width}／${row.count}／${row.operation}|${row.metric}|${row.before.median.toFixed(2)}|${row.after.median.toFixed(2)}|${row.saved.toFixed(2)}|${row.percent === null ? "算出不可" : row.percent.toFixed(2)}|${row.before.n}/${row.after.n}|${row.before.minimum.toFixed(2)}–${row.before.maximum.toFixed(2)}／${row.after.minimum.toFixed(2)}–${row.after.maximum.toFixed(2)}|`,
      )
      .join("\n") +
    "\n",
);
fs.writeFileSync(
  path.join(directory, "summary.json"),
  JSON.stringify(
    {
      date: new Date().toISOString(),
      runnerSha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(__filename))
        .digest("hex"),
      definition:
        "Same-condition medians, (before-after)/before*100; minima/maxima show spread, no aggregate percentage. handler is synchronous synthetic input CPU; resultProxy includes correct result and two rAF, not physical display/INP.",
      evidence: Object.fromEntries(
        files.map((name) => [
          name,
          crypto
            .createHash("sha256")
            .update(fs.readFileSync(path.join(directory, name)))
            .digest("hex"),
        ]),
      ),
      rows,
      relatedRows,
    },
    null,
    2,
  ),
);
const decision = (row) =>
  row.label === "unicode-ABBA-production" && row.metric === "handler"
    ? "長文CPU短縮を確認"
    : row.label.endsWith("production") && !row.label.includes("ABBA")
      ? "参考値・時間帯の負荷差あり"
      : row.saved < 0
        ? "観測増加・再現性未確認"
        : "観測差・体感改善未確認";
const round = (value) => (value === null ? "算出不可" : value.toFixed(2));
for (const kind of ["production", "paired"]) {
  const selected = rows.filter(
    (row) => row.label.endsWith("production") === (kind === "production"),
  );
  fs.writeFileSync(
    path.join(directory, `${kind}-times.md`),
    "|測定／幅／枚数／検索語|指標|前中央値ms|後中央値ms|短縮ms|率%|n前/後|前min–max／後min–max ms|判定|\n|---|---|---:|---:|---:|---:|---|---|---|\n" +
      selected
        .map(
          (row) =>
            `|${row.label}／${row.width}／${row.count}／${row.query || "解除"}|${row.metric}|${round(row.before.median)}|${round(row.after.median)}|${round(row.saved)}|${round(row.percent)}|${row.before.n}/${row.after.n}|${round(row.before.minimum)}–${round(row.before.maximum)}／${round(row.after.minimum)}–${round(row.after.maximum)}|${decision(row)}|`,
        )
        .join("\n") +
      "\n",
  );
}
console.log("Summarized", rows.length, "metrics");

import { readFile, writeFile } from "node:fs/promises";
const directory = "performance/modernization/";
const read = async (name) =>
  JSON.parse(await readFile(directory + name, "utf8"));
const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const output = [];
function compare(area, condition, metric, before, after) {
  const a = median(before),
    b = median(after);
  const reduction = a - b;
  const noise = Math.max(1, a * 0.1);
  output.push({
    area,
    condition,
    metric,
    beforeMedian: a,
    afterMedian: b,
    reductionMs: reduction,
    reductionPercent: a >= 1 ? (reduction / a) * 100 : null,
    beforeTrials: before.length,
    afterTrials: after.length,
    beforeMin: Math.min(...before),
    beforeMax: Math.max(...before),
    afterMin: Math.min(...after),
    afterMax: Math.max(...after),
    verdict:
      Math.abs(reduction) <= noise
        ? "改善未確認（差が小さい）"
        : reduction > 0
          ? "短縮（この測定条件）"
          : "悪化（この測定条件）",
  });
}
function grouped(area, before, after, key, metrics) {
  const keys = [...new Set(before.map(key))];
  for (const condition of keys) {
    const a = before.filter((row) => key(row) === condition);
    const b = after.filter((row) => key(row) === condition);
    for (const metric of metrics) {
      const left = a.map((row) => row[metric]).filter(Number.isFinite);
      const right = b.map((row) => row[metric]).filter(Number.isFinite);
      if (left.length && right.length)
        compare(area, condition, metric, left, right);
    }
  }
}
const edits = await Promise.all([
  read("edit-before.json"),
  read("edit-after.json"),
]);
for (const phase of ["first", "repeated"]) {
  const rows = edits.map((data) =>
    data.rows.map((row) => {
      const samples =
        phase === "first" ? row.samples.slice(0, 1) : row.samples.slice(1);
      return {
        ...row,
        handler: median(samples.map((s) => s.handler)),
        frameReady: median(samples.map((s) => s.frameReady)),
      };
    }),
  );
  grouped(
    "編集",
    rows[0],
    rows[1],
    (r) =>
      `${r.width}px/${r.n}件/検索${r.filtered ? "あり" : "なし"}/${r.field}/${phase}`,
    ["handler", "frameReady"],
  );
}
const screens = await Promise.all([
  read("screens-before.json"),
  read("screens-after.json"),
]);
const paired = await read("startup-paired.json");
grouped(
  "起動再確認",
  paired.rows.filter((r) => r.source.includes("before")),
  paired.rows.filter((r) => r.source === "peta-board.html"),
  (r) => `1440px/50件/${r.cache}/交互AB-BA`,
  ["content", "interactive"],
);
grouped(
  "画面",
  screens[0].rows,
  screens[1].rows,
  (r) => `${r.viewport.width}px/${r.count}件/${r.cache}/${r.screen}`,
  ["content", "interactive"],
);
const drag = await Promise.all([
  read("drag-commit-before.json"),
  read("drag-commit-after.json"),
]);
grouped(
  "ドラッグ確定",
  drag[0].rows,
  drag[1].rows,
  (r) => `${r.n}件/${r.type}`,
  ["handler", "ready", "save"],
);
const motion = await Promise.all([
  read("drag-before.json"),
  read("drag-after.json"),
]);
const motionRows = motion.map((data) =>
  data.rows.map((r) => ({
    ...r,
    frameMedian: median(r.frames),
    previewCpu: (
      r.functions.previewPointerDrop || r.functions.previewColumnDrop
    ).ms,
  })),
);
grouped(
  "ドラッグ連続",
  motionRows[0],
  motionRows[1],
  (r) => `${r.kind}/${r.type}`,
  ["frameMedian", "previewCpu"],
);
for (const name of ["io.json", "empty-editor.json", "errors.json"]) {
  const data = await read(name);
  grouped(
    name,
    data.rows.filter((r) => r.source.includes("before")),
    data.rows.filter((r) => r.source === "peta-board.html"),
    (r) =>
      `${r.viewport?.width || 1440}px/${r.count ?? 0}件/${r.cache || ""}/${r.screen || r.condition || r.kind}`,
    ["content", "interactive", "result", "save"],
  );
}
await writeFile(
  directory + "results.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      production: false,
      definition:
        "Median of five independent trials. Editing repeated phase uses the median of seven events within each trial, then five trial medians. min/max are trial-level. Difference verdict is descriptive with max(1ms,10% baseline) noise guard, not statistical significance. Time reduction applies only to time metrics; rects excluded. No overall average improvement.",
      rows: output,
    },
    null,
    2,
  ),
);
const columns = Object.keys(output[0]);
const csv = (value) => `"${String(value ?? "算出不可").replaceAll('"', '""')}"`;
await writeFile(
  directory + "results.csv",
  [
    columns.join(","),
    ...output.map((row) => columns.map((key) => csv(row[key])).join(",")),
  ].join("\n") + "\n",
);
const f = (n) => (n === null ? "算出不可" : n.toFixed(1));
await writeFile(
  directory + "RESULTS.md",
  "# ローカル比較結果（本番ではない）\n\n各行5試行／5試行。編集のrepeatedは各試行7イベントの中央値を5試行で集計。content/interactiveは各ランナーの終了条件、frameReady/readyは2 rAFの代理指標。時間以外のrectsに短縮率は適用しない。最小・最大値はresults.csv参照。判定は有意差検定ではない。\n\n|対象|条件|指標|前中央値|後中央値|差|短縮率%|判定|\n|---|---|---|---:|---:|---:|---:|---|\n" +
    output
      .map(
        (r) =>
          `|${r.area}|${r.condition}|${r.metric}|${f(r.beforeMedian)}|${f(r.afterMedian)}|${f(r.reductionMs)}|${r.metric === "rects" ? "対象外" : f(r.reductionPercent)}|${r.verdict}|`,
      )
      .join("\n") +
    "\n",
);
console.log("Comparison rows:", output.length);

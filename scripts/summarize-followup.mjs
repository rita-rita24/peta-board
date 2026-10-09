import { readFile, writeFile } from "node:fs/promises";
const directory = "performance/followup/";
const read = async (name) =>
  JSON.parse(await readFile(directory + name, "utf8"));
const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b),
    middle = Math.floor(values.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const comparisons = [];
function compare(operation, condition, metric, before, after) {
  const a = median(before),
    b = median(after);
  comparisons.push({
    operation,
    condition,
    metric,
    beforeMedian: a,
    afterMedian: b,
    reductionMs: a - b,
    reductionPercent: a >= 1 ? ((a - b) / a) * 100 : null,
    beforeTrials: before.length,
    afterTrials: after.length,
    beforeMin: Math.min(...before),
    beforeMax: Math.max(...before),
    afterMin: Math.min(...after),
    afterMax: Math.max(...after),
    verdict:
      Math.abs(a - b) <= Math.max(1, a * 0.1)
        ? "改善未確認"
        : a > b
          ? "短縮（測定条件内）"
          : "悪化（測定条件内）",
  });
}
const column = await read("column-search.json");
for (const width of [375, 1440])
  for (const count of [50, 500])
    for (const metric of ["handler", "frameReady"]) {
      const values = Object.keys(column.versions).map((source) =>
        Array.from({ length: 5 }, (_, run) =>
          median(
            column.rows
              .filter(
                (r) =>
                  r.source === source &&
                  r.width === width &&
                  r.count === count &&
                  r.run === run,
              )
              .map((r) => r[metric]),
          ),
        ),
      );
      compare(
        "列名編集・検索結果不変",
        `${width}px/${count}件/1列/連続8入力`,
        metric,
        ...values,
      );
    }
const operations = await read("remaining-operations.json");
for (const width of [375, 1440])
  for (const count of [50, 500])
    for (const operation of new Set(operations.rows.map((r) => r.operation)))
      for (const metric of ["handler", "frameReady", "savedMs"]) {
        const values = Object.keys(operations.versions).map((source) =>
          operations.rows
            .filter(
              (r) =>
                r.source === source &&
                r.width === width &&
                r.count === count &&
                r.operation === operation,
            )
            .map((r) => r[metric])
            .filter(Number.isFinite),
        );
        if (values.every((v) => v.length))
          compare(
            operation,
            `${width}px/${count}件/4または12列`,
            metric,
            ...values,
          );
      }
const continuous = await read("continuous.json");
for (const width of [375, 1440])
  for (const count of [50, 500])
    for (const operation of new Set(continuous.rows.map((r) => r.operation)))
      for (const metric of ["handler", "resultProxy", "controllerElapsed"]) {
        const values = Object.keys(continuous.versions).map((source) =>
          continuous.rows
            .filter(
              (r) =>
                r.source === source &&
                r.width === width &&
                r.count === count &&
                r.operation === operation,
            )
            .map((r) => r[metric])
            .filter(Number.isFinite),
        );
        if (values.every((v) => v.length === 5))
          compare(
            operation,
            `${width}px/${count}件/native-or-synthetic-see-runner`,
            metric,
            ...values,
          );
      }
await writeFile(
  directory + "results.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      productionComparison: false,
      definition:
        "Five independent trials/source/condition. Column edit uses median of eight events within each trial, then median of five trial medians. min/max at trial level. Descriptive noise guard max(1ms,10% baseline); not statistical significance. This is same temporary URL comparison; production file results are separate, no claimed production before/after rate.",
      comparisons,
    },
    null,
    2,
  ),
);
const columns = Object.keys(comparisons[0]);
const quote = (x) => `"${String(x ?? "算出不可").replaceAll('"', '""')}"`;
await writeFile(
  directory + "results.csv",
  [
    columns.join(","),
    ...comparisons.map((row) => columns.map((k) => quote(row[k])).join(",")),
  ].join("\n") + "\n",
);
const f = (x) => (x === null ? "算出不可" : x.toFixed(1));
await writeFile(
  directory + "RESULTS.md",
  "# 追加のローカル前後比較\n\n前後各5試行。列名は各試行8入力の中央値を集計。handlerは同期処理、frameReadyは2 rAF代理、savedMsは保存表示まで（最終状態を別途再読込確認）。本番配布ファイルの直接計測はproduction-*.jsonへ分けた。本番の変更前値はないため、本番短縮率ではない。\n\n|操作|条件|指標|前ms|後ms|差ms|短縮率%|判定|\n|---|---|---|---:|---:|---:|---:|---|\n" +
    comparisons
      .map(
        (r) =>
          `|${r.operation}|${r.condition}|${r.metric}|${f(r.beforeMedian)}|${f(r.afterMedian)}|${f(r.reductionMs)}|${f(r.reductionPercent)}|${r.verdict}|`,
      )
      .join("\n") +
    "\n",
);
console.log("Additional comparison rows:", comparisons.length);

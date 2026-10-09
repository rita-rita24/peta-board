import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const directory = process.env.EVIDENCE_DIR || "performance/round4";
const read = async (path) => JSON.parse(await readFile(path, "utf8"));
const beforeHash = createHash("sha256")
  .update(await readFile(`${directory}/before.html`))
  .digest("hex");
const afterHash = createHash("sha256")
  .update(await readFile(process.env.AFTER_SOURCE || "peta-board.html"))
  .digest("hex");
const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b),
    i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
};
const comparisons = [];
function compare(
  scope,
  operation,
  condition,
  metric,
  before,
  after,
  observations = 5,
) {
  assert.equal(before.length, 5);
  assert.equal(after.length, 5);
  assert([...before, ...after].every(Number.isFinite));
  const a = median(before),
    b = median(after);
  comparisons.push({
    scope,
    operation,
    condition,
    metric,
    beforeMedian: a,
    afterMedian: b,
    reductionMs: a - b,
    reductionPercent: a >= 1 ? ((a - b) / a) * 100 : null,
    beforeTrials: 5,
    afterTrials: 5,
    observationsPerVersion: observations,
    beforeMin: Math.min(...before),
    beforeMax: Math.max(...before),
    afterMin: Math.min(...after),
    afterMax: Math.max(...after),
    implementationRelated: process.env.LIFECYCLE_PHASE
      ? false
      : process.env.RECONCILIATION_PHASE
        ? scope.includes("synthetic-operations") &&
          [
            "付箋複製",
            "付箋削除の確定",
            "付箋削除の復元",
            "チェック項目復元",
            "列追加",
            "列削除の確定",
            "列削除の復元",
            "列を右へ移動",
          ].includes(operation)
        : null,
    interpretation: process.env.LIFECYCLE_PHASE
      ? "離脱監視の登録範囲のみ変更した段階。これらの操作の時間差から今回の効果を確認できない"
      : process.env.RECONCILIATION_PHASE &&
          !scope.includes("synthetic-operations")
        ? "今回の更新経路と関係しない指標。採取時点・記録条件の差があり、値の差だけでは今回の効果を確認できない"
        : "記述的な観測差。因果関係・有意差を保証しない",
    verdict:
      Math.abs(a - b) <= Math.max(1, a * 0.1)
        ? "改善未確認"
        : a > b
          ? "短縮（観測条件内）"
          : "悪化（観測条件内）",
  });
}
const nativeBefore = await read(`${directory}/theme-production-before.json`),
  nativeAfter = await read(`${directory}/theme-production-after.json`);
assert.equal(nativeBefore.versions["peta-board.html"], beforeHash);
assert.equal(nativeAfter.versions["peta-board.html"], afterHash);
assert.equal(
  new URL(nativeBefore.productionUrl).href,
  new URL(nativeAfter.productionUrl).href,
);
for (const width of [375, 1440])
  for (const count of [50, 500])
    for (const phase of ["first", "repeat"])
      for (const metric of [
        "handler",
        "firstRendererPaintMs",
        "resultProxy",
        "savedMs",
        "eventTiming.inputDelayMs",
        "eventTiming.processingMs",
        "eventTiming.duration",
      ]) {
        if (
          metric.startsWith("eventTiming.") &&
          ![nativeBefore, nativeAfter].every((data) =>
            data.rows.every((row) =>
              Number.isFinite(row.eventTiming?.[metric.split(".")[1]]),
            ),
          )
        )
          continue;
        const values = [nativeBefore, nativeAfter].map((data) =>
          Array.from({ length: 5 }, (_, run) =>
            median(
              data.rows
                .filter(
                  (row) =>
                    row.width === width &&
                    row.count === count &&
                    row.run === run &&
                    (phase === "first" ? row.step === 0 : row.step > 0),
                )
                .map((row) =>
                  metric
                    .split(".")
                    .reduce((value, field) => value?.[field], row),
                ),
            ),
          ),
        );
        compare(
          "production/native-theme",
          "テーマ切替",
          `${width}px/${count}件/${phase}`,
          metric,
          ...values,
          phase === "first" ? 5 : 20,
        );
      }
const screensBefore = await read(
    process.env.SCREEN_BASELINE ||
      "performance/followup/production-screens.json",
  ),
  screensAfter = await read(`${directory}/production-screens.json`);
assert.equal(screensBefore.version, beforeHash);
assert.equal(screensAfter.version, afterHash);
assert.equal(new URL(screensBefore.url).href, new URL(screensAfter.url).href);
const key = (row) =>
  JSON.stringify([
    row.viewport.width,
    row.viewport.height,
    row.count,
    row.cache,
    row.screen,
  ]);
for (const condition of new Set(screensAfter.rows.map(key)))
  for (const metric of ["content", "interactive"]) {
    const values = [screensBefore, screensAfter].map((data) =>
      data.rows
        .filter((row) => key(row) === condition)
        .map((row) => row[metric]),
    );
    compare(
      "production/screens-DOM-proxy",
      JSON.parse(condition).at(-1),
      condition,
      metric,
      ...values,
    );
  }
const operations = await read(`${directory}/remaining-operations.json`),
  productionOperations = await read(`${directory}/production-operations.json`);
assert.equal(operations.versions[`${directory}/before.html`], beforeHash);
assert.equal(operations.versions["peta-board.html"], afterHash);
assert.equal(productionOperations.versions["peta-board.html"], afterHash);
for (const width of [375, 1440])
  for (const count of [50, 500])
    for (const operation of new Set(
      operations.rows.map((row) => row.operation),
    ))
      for (const metric of ["handler", "frameReady", "savedMs", "hiddenMs"]) {
        const values = [`${directory}/before.html`, "peta-board.html"].map(
          (source) =>
            operations.rows
              .filter(
                (row) =>
                  row.source === source &&
                  row.width === width &&
                  row.count === count &&
                  row.operation === operation,
              )
              .map((row) => row[metric])
              .filter(Number.isFinite),
        );
        if (values.every((group) => group.length === 5))
          compare(
            "temporary/synthetic-operations",
            operation,
            `${width}px/${count}件`,
            metric,
            ...values,
          );
      }
if (process.env.PRODUCTION_OPERATION_BASELINE) {
  const baseline = await read(process.env.PRODUCTION_OPERATION_BASELINE);
  assert.equal(baseline.versions["peta-board.html"], beforeHash);
  assert.equal(
    new URL(baseline.productionUrl).href,
    new URL(productionOperations.productionUrl).href,
  );
  for (const width of [375, 1440])
    for (const count of [50, 500])
      for (const operation of new Set(
        productionOperations.rows.map((row) => row.operation),
      ))
        for (const metric of ["handler", "frameReady", "savedMs", "hiddenMs"]) {
          const values = [baseline, productionOperations].map((data) =>
            data.rows
              .filter(
                (row) =>
                  row.width === width &&
                  row.count === count &&
                  row.operation === operation,
              )
              .map((row) => row[metric])
              .filter(Number.isFinite),
          );
          if (values.every((group) => group.length === 5))
            compare(
              "production/synthetic-operations",
              operation,
              `${width}px/${count}件`,
              metric,
              ...values,
            );
        }
}
const productionValues = [];
for (const width of [375, 1440])
  for (const count of [50, 500])
    for (const operation of new Set(
      productionOperations.rows.map((row) => row.operation),
    ))
      for (const metric of ["handler", "frameReady", "savedMs", "hiddenMs"]) {
        const values = productionOperations.rows
          .filter(
            (row) =>
              row.width === width &&
              row.count === count &&
              row.operation === operation,
          )
          .map((row) => row[metric])
          .filter(Number.isFinite);
        if (values.length === 5)
          productionValues.push({
            operation,
            condition: `${width}px/${count}件`,
            metric,
            median: median(values),
            min: Math.min(...values),
            max: Math.max(...values),
            trials: 5,
            beforeMeasured: comparisons.some(
              (row) =>
                row.scope === "production/synthetic-operations" &&
                row.operation === operation &&
                row.condition === `${width}px/${count}件` &&
                row.metric === metric,
            ),
            reductionPercent: null,
          });
      }
const data = {
  date: new Date().toISOString(),
  beforeHash,
  afterHash,
  definition:
    "Five independent trial values per condition. Native first click separate from repeat clicks; repeat = median of four clicks within each trial, then median of five trials. Before/after URLs compare using standard URL serialization, keeping original raw URLs. Native renderer Paint, handler, two-rAF proxy and saved status are distinct. Screen values are DOM/rAF/opacity/inert proxies, not confirmed physical display. Screen before is the previous production-path run of the identical frozen baseline; same browser/fixture/runner, different sampling epoch. Production native A-then-B; temporary synthetic AB/BA. Descriptive max(1ms,10%) guard is not significance. All negative results retained, no cross-condition average. Supplemental production synthetic operations are after-only unless PRODUCTION_OPERATION_BASELINE is supplied and hash/same URL verified. Never mix temporary ratios into production rates. Before sampling epochs can differ; this is not a randomized field experiment.",
  comparisons,
  productionValues,
};
await writeFile(`${directory}/results.json`, JSON.stringify(data, null, 2));
const columns = Object.keys(comparisons[0]),
  quote = (value) => `"${String(value ?? "算出不可").replaceAll('"', '""')}"`;
await writeFile(
  `${directory}/results.csv`,
  [
    columns.join(","),
    ...comparisons.map((row) =>
      columns.map((column) => quote(row[column])).join(","),
    ),
  ].join("\n") + "\n",
);
const f = (value) => (value === null ? "算出不可" : value.toFixed(1));
await writeFile(
  `${directory}/RESULTS.md`,
  `# ${process.env.RESULT_TITLE || "計測条件を分けた第4回結果"}\n\n定義・版・ばらつきはresults.json／CSV。productionは配布パス同士、temporaryは隔離URL同士。画面のcontent／interactiveはDOM状態の代理指標。renderer Paintも物理表示・INPではない。記述的な判定を因果関係や有意差と同一視しない。\n\n|範囲|操作|条件|指標|前ms|後ms|差ms|短縮率%|判定|\n|---|---|---|---|---:|---:|---:|---:|---|\n` +
    comparisons
      .map(
        (row) =>
          `|${row.scope}|${row.operation}|${row.condition}|${row.metric}|${f(row.beforeMedian)}|${f(row.afterMedian)}|${f(row.reductionMs)}|${f(row.reductionPercent)}|${row.verdict}|`,
      )
      .join("\n") +
    "\n",
);
console.log(
  "Comparisons:",
  comparisons.length,
  "production values:",
  productionValues.length,
);

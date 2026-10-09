# テーマ・Python実行環境・検査補強の記録

この段階の変更はf9f6ae…→e26dcd…に限定する。後続の配布版と総合結果は[最終報告](../round6/REPORT.md)を参照する。過去値を新しいハッシュの値として扱わない。

テーマの明暗2色をCSSの共有変数にし、3つの明暗・印刷定義から参照する。テーマ属性を書き換えた後で全体のスタイルを読む処理を、属性変更前の共有色の読みに置き換えた。[getComputedStyle](https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle)と[Chromeの強制再計算の説明](https://developer.chrome.com/docs/performance/insights/forced-reflow)を確認（2026-10-10）。明暗・meta色・実背景・印刷色・保存を78比較点×3エンジンで確認した。

同じ配布パスで順番に記録した初回テーマ切替（1440px・500枚・5コンテキスト）の同期ハンドラ中央値は53.1→0.5ms、最初のrenderer Paintは108.0→95.1ms、2rAF代理値208.7→175.7ms、保存表示335.4→247.5msだった。Paintは物理提示ではなく、試行幅も広い。CPUの削減をそのまま体感改善率にしない。初回と繰り返しは別集計、全ての負の行も[result CSV](results.csv)に保持した。

[公式Python3.15.0](https://www.python.org/downloads/release/python-3150/)のソースSHAを照合して隔離ビルドした。Ruff7ファイル・過去6ランナーの出力比較が実際の3.15で通過。詳細はpython-runtime.json／python-regression.json、再現可能なビルドログは後続round5に保存。Ruffのpy315専用規則は開発中という実行警告があるため、previewを使わず安定py314を維持し、3.15の構文・実行を別に確認する。

非推奨which検出の正規表現に混入していた制御文字を修正し、ESLintのAST規則を追加。注入したwhichを両検査が意図した理由で拒否することをobsolete-guard.jsonに記録した。初期計測の除外理由はmeasurement-exclusions.json。元の数値と除外入力は保持している。

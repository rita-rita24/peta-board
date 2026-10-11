# 検索描画の追加改善（2026-10-11 JST）

## ① 実施結果

ユーザー指定の本番はローカルHTML配布。500枚・1440px幅・長文Unicode本文が検索に一致しない条件で、実ファイルの交互ABBA計測（各10回）により同期入力CPU中央値67.75→29.65ms、38.10ms／56.24%短縮を確認した。結果＋2rAFは408.45→383.35ms（6.15%）だが範囲が重なるため体感改善は未確認。GitHub Actionsは追加・有効化せず、検索描画のJavaScriptを変更し、ローカル検証と配布HTMLの前後計測を行う。配布対象は[peta-board.html](../../peta-board.html)。配布版SHA-256は4823f2e31fb6c8a1135d60fed668bd5132e8fce1f65a3e0053d23dc526319175。変更前は30143609a812f288974b3a84a93d1a07b544af5990c9f9fb3ca8696bee330bd2。反映版・日時・本番URL・証拠のSHAは[release-status.json](release-status.json)。GitHub反映先はrita-rita24/peta-boardのmain。反映コミットは、この報告を含むGit履歴と作業完了時の回答で確認する。

一致しない本文についてもUnicodeの文字位置対応表を作っていた経路を、検索語の一致判定後に必要な場合だけ処理する形へ変更した。renderNoteでは検索語と本文の小文字化を再利用し、抜粋対象の中間配列を減らした。一致箇所の位置変換、重複範囲の統合、128範囲上限、抜粋3件と残件表示は維持する。新しいキャッシュや遅延・debounceは追加していない。初回表示性能の追加再計測は今回未実施。保存・初回の関連操作は回帰と28操作の比較で確認するが、その値から読み込み速度の改善を推定しない。

横方向だけのCSS包含を加える案も比較したが、通常検索の短縮と悪化が混在したため不採用。配布CSSは変更しない。[inline-search.json](inline-search.json)はこの不採用案の検証環境の値であり、本番の改善率ではない。先行の境界画像比較[boundary/display.json](boundary/display.json)では35状態の寸法とアクセシビリティが一致し、4画像にボタンの色の差があった。遷移中の比較である可能性を切り分けるため、以降は180ms待ってから画像を比較する。先行値を安定後の証拠として扱わない。先行境界ランナーは実行SHAのみを記録しており、その全ソースは凍結していない。180ms待つ最終ランナーでの追加1試行は[boundary-inline-stable/display.json](boundary-inline-stable/display.json)の全7状態で一致した。遷移が色差の原因だとは断定しない。このCSS案は採用根拠に使わない。

全画面・全操作の完了とは扱わない。6画面系統・52操作群の[対応表](../round6/operations.json)を継続し、検索の標準5語とUnicode8語を追加確認する。最低対応ブラウザーの未指定、実機IME・タッチ・Safari、スクリーンリーダー、実利用INP、長時間メモリー、一部操作の未計測と過去の負値の原因未確定は残る。GitHub Actionsの削除・無効化は今回の明示指示に従う運用であり、再追加を完了条件にしない。

## ② コードの現代化の結果

今回の単位は実装経路・箇所。導入年による基本構文の置換ではなく、現行標準機能を使って重複処理を整理した。

|言語・領域|変更前|採用した方法|変更前件数|移行済み|必要な例外|未対応|対象・根拠|
|---|---|---|---:|---:|---:|---:|---|
|JS・強調表示経路|不一致でも文字位置表を構築|indexOfの一致なしを先に判定しtextContentで反映|1|1|0|0|appendHighlightedText|
|JS・カード描画箇所|検索語と本文の小文字化を再取得|1回の取得・変換を同じ描画内で再利用|1|1|0|0|renderNote、キャッシュ追加なし|
|JS・抜粋候補の組み立て|配列展開・map・filterで全候補を複製|順序を保つループで一致候補を蓄積|1|1|0|0|renderNote、表示上限と残件数を維持|

既存の移行数・例外の箇所と解消条件は[前段の現代化表](../round8/REPORT.md)を引き継ぐ。旧式と判断した既存の置換対象は残件0、互換性参照10（IME補助判定1、beforeunload returnValue1、CSSのWebKit名等8）、Ruffのpy314ターゲット設定1、空下書き破棄の全面描画経路1は継続。これらを全廃済みとしない。

公式資料確認日2026-10-11。[String.indexOf](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/indexOf)、[CSS contain](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/contain)、[Playwright ariaSnapshot](https://playwright.dev/docs/api/class-locator#locator-aria-snapshot)を確認。既存の標準JS APIを使い、ブラウザー最低対応範囲を縮小する新APIや構文は追加しない。CSS案はinline-sizeがブロック方向のサイズを固定しないことを確認したが、効果が安定せず不採用。

管理範囲はアプリ1、CJS78、MJS23、Python7、設定6、依存ロック1の計116ファイル。GitHub Actions用YAMLは0、凍結比較HTMLは48本。検査環境はNode24.21.0、Python3.15.0、Ruff0.16.10、Playwright1.64.0、ESLint10.12.0、html-validate11.16.2、Stylelint17.16.0、Prettier3.9.9。依存関係とロックは変更なし。実行時の外部依存は0。アプリはHTML1・CSS3・JS1、トップレベル関数213。追加の比較ランナーも全体の静的検査対象。凍結HTMLは過去比較入力、依存・生成物は別分類。最終の全ファイル一覧は[inventory.json](inventory.json)。

## ③ 本番での操作別時間計測

本番の前後はいずれも実際の配布HTMLのfile URLで、保存領域を分離したブラウザーコンテキストを使用する。標準fixtureは50／500件、幅375／1440px、高さ900px、各条件5試行。Unicode fixtureは本文3300 UTF-16コード単位のİ・ababa・絵文字とチェック項目・4件目以降のタグを含む。同一クエリ順で測定する。

同期inputハンドラーCPUと、正しい結果を反映して2rAF経過する時間を別指標にする。後者は物理表示・実入力の応答時間やINPではない。検索は保存対象ではないため、この計測に保存完了時間を混ぜない。固定の検索順に伴うウォームアップと背景処理の負荷がある。短縮率=(前中央値−後中央値)/前中央値×100、負値も残し、異なる条件の平均改善率は作らない。

[production-paired.cjs](production-paired.cjs)で実際の配布パスへ旧版／採用版をABBA順に置き、各条件5サイクル・各版10コンテキストを追加比較した。対象は幅1440・500枚、通常5語とUnicodeの「列」1語。ブラウザーも毎回分離し、同じランナーSHA・ブラウザー版・URLと全表示／状態ハッシュを検査する。最後にfinallyで採用版のバイト列を復元し、SHAの一致を確認した。[search-production-interleaved.json](search-production-interleaved.json)／[unicode-production-interleaved.json](unicode-production-interleaved.json)と各20個の個別実行ファイルに日時とハッシュを保存する。通常検索解除のCPUは6.30→6.30ms（0%）、本文検索のCPUは7.55→6.65ms、結果＋2rAFは49.85→52.10ms（−4.51%）。通常検索の体感改善は未確認。

先に離れた時間帯で取得した本番の前後値は、通常検索解除のCPUまで60%以上短縮し、交互対照と一致しない。背景負荷・実行時の状態変化を切り分けきれないため、これらを参考値とし、77〜79%という長文CPUの率を今回の効果として採用しない。全条件の中央値・最小・最大・回数と率は[本番集計表](production-times.md)へ保存する。[検証環境集計表](paired-times.md)は別分類。[summary.json](summary.json)に丸め前の数値と元データのハッシュを記録する。検証用の一時URLで交互AB/BA実行した値は、本番の値と別に示す。過去の異なる日の測定を今回の本番前値に使わない。

## ④ 連続操作の追従性

今回の変更は同期検索描画であり、連続ドラッグの表示処理には触れていない。既存の回帰検証で最終位置・順序・保存を確認する。検索CPUの差からFPS・滑らかさの改善を推定しない。今回のnative wheel、リサイズ、pageshow、カレンダーキー、履歴移動の交互比較は[continuous.json](continuous.json)。CPUと結果代理・保存を確認する関連操作の比較は[remaining-operations.json](remaining-operations.json)。全数値は[関連操作集計](related-times.md)に残す。これらは検証用の一時file URLによる値で、本番の短縮率に混ぜない。連続操作のresultProxyは操作命令の送信・観測費用を含む2rAF代理、history-backはコントローラーの壁時計で、物理入力から表示までの時間ではない。relatedのframeReadyは1rAF、savedMsは開始から保存表示がsavedになるまで、hiddenMsはツールチップ非表示まで。history-forwardは正しさのみ確認し時間を計らない。既存の[連続操作の記録](../round6/REPORT.md)のrAF間隔等は当時の観測であり、新版の再測定として扱わない。

## ⑤ 検証の根拠と残る課題

検索比較は一時file URLで同一エンジン内の完全なボードHTML、全カードと子要素の寸法、順序、件数、概要、フォーカス、選択、列・シェルのスクロール、保存状態を前後比較し、再読み込みで件数を確認する。検索語にはİの小文字化による展開、結合点、絵文字、重複するaba、複数語、検索解除と不一致を含める。比較の許容差は設定しない。

[search-runner.json](search-runner.json)はChromeの全条件比較に使った実行ソースとSHA。[search-runner-selected.json](search-runner-selected.json)は試行数・件数・検索語の選択、進捗出力、比較完了後のデータ解放を追加した版。本番の標準前後はinitial-search-runner.jsonの同一ソースを使い、長文前後はselected版の同一ソースで検索語「列」だけを比較する。[initial-search-runner.json](initial-search-runner.json)は初回のCSS候補と本番前標準測定に使った版。各実行の途中でランナーやアプリを変更しない。ABBAラッパーは子実行の開始前に配布版を切り替え、完了後にSHAと結果を検査する。子実行中にファイルを変更しない。境界比較は全カード・本文内部の寸法とスクロール、画像SHA、ARIAスナップショットを比較し、保存・遷移終了後に撮影する。[display-runner.json](display-runner.json)に最終実行ソースを凍結する。

不採用の候補は[candidate-inline.html](candidate-inline.html)、採用候補は[candidate-search.html](candidate-search.html)、戻す配布版は[before.html](before.html)。復旧判断は表示・状態・順序・保存・操作の差、または再現する明確な性能悪化。復旧時はbefore.htmlを配布HTMLに戻して検証し、Gitで新規の復旧コミットをpushする。

次の有望な候補は検索時のレイアウト費用の削減。過去の包含範囲変更ではリサイズ後のスクロール位置差、今回の横方向包含では性能の負値があり、表示の維持と安定した短縮の証拠が必要。実機と最低対応環境の確認には、対象環境の指定とその端末へのアクセスが必要。これらの未達を残したまま全体完了と報告しない。


再現例（インストール済みのNode24とPlaywright、Python3.15／Ruffを使う）：

```sh
mkdir -p .checks/round9-recheck
EVIDENCE_DIR=.checks/round9-recheck BASELINE_SOURCE=performance/round9/before.html BROWSERS=chromium,firefox,webkit npm run ci
EVIDENCE_DIR=.checks/round9-recheck BASELINE_SOURCE=performance/round9/before.html AFTER_SOURCE=performance/round9/candidate-search.html node scripts/search-render.mjs
EVIDENCE_DIR=.checks/round9-recheck BASELINE_SOURCE=performance/round9/before.html FIXTURE_VARIANT=unicode COUNTS=50 REPEATS=2 BROWSER=firefox AFTER_SOURCE=performance/round9/candidate-search.html node scripts/search-render.mjs
node performance/round9/summarize.cjs
```

出力先OUTPUT／EVIDENCE_DIRを別ディレクトリに指定し、今回の生データを上書きしない。summarize.cjsは凍結した入力から集計表のみを再生成する。3エンジンの検索比較ではChromeは50／500枚・各5試行、Firefox／WebKitのUnicode8語は50枚・各2試行、通常5語は50／500枚・各5試行。500枚のUnicode8語をFirefox／WebKitで追加確認したとは扱わない。


採用版の回帰は[regression.json](regression.json)でChrome154.0.8037.99／Firefox157.0／WebKit27.2の各102状態が一致し、ページエラーは0。[storage-regression.json](storage-regression.json)11項目、[gestures.json](gestures.json)11項目、[drag-regression.json](drag-regression.json)72状態／7,200幾何検査、[unload-ci.json](unload-ci.json)の保存・IME・離脱試験も成功。終了時試験のChromiumは同梱156.0.8078.4を使う。Python3.15で過去6ランナーの出力も一致した。[ci.log](ci.log)にnpm run ciの全段階を保存した。集計器を後から拡張したため、最終版にも静的・書式検査を再実行する。

検索は3エンジンの通常600観測／300対、Unicode448観測／224対が一致。JS採用版の境界は3エンジン各7状態、計21比較で本文内部を含む寸法・スクロール・画像・ARIAが一致した。Chrome500枚のUnicode8語は5試行、Firefox／WebKitは50枚2試行であり、試行範囲を相互に拡張して解釈しない。本番前後の比較でも条件別の表示・状態ハッシュの一致を確認する。


今回の関連操作比較は500枚・1440px幅・各5試行、28操作280観測（140対）。連続操作比較は50／500枚・375／1440px・各5試行、12操作480観測（240対）。wheel-yの500枚1440pxは74.60→76.80ms、resizeは44.60→45.40ms、history-backは195→235msと負値もあり、継続的な滑らかさの改善は確認していない。大きな値の増減は経路別の再現調査が残る。ドラッグ最終位置・順序・保存は今回の回帰を通過したが、rAF間隔／FPS／物理表示の新たな測定は行っていない。


履歴移動の負値を追加確認した[continuous-confirm.json](continuous-confirm.json)も480観測・エラー0。500枚1440pxのcontrollerElapsedは173→201msで増加が残った。より狭い「編集を挟まない500枚の履歴復帰」では[history-ready.cjs](history-ready.cjs)／[history-ready.json](history-ready.json)を使い、ブラウザー内で保存済み・500カード・操作可能状態と2rAFを確認した時刻を記録した。表示代理は195.90→199.20ms（−1.68%、n5／5）、範囲188.40–208.20／197.50–211.90ms。コントローラーは456→461ms。狭い条件では40msの表示遅延を確認しなかったが、前段にカレンダー操作等を含む連続試験の負値の原因を証明したとは扱わない。一連の利用での履歴移動の再現調査は残る。プローブには初期1rAFの状態確認と命令送信費用が含まれ、物理表示の計測ではない。

# 全操作・現代化の検証記録 — 2026-10-10 JST

現在の配布版・Python3.15実行・最終検証は[最終報告](../round6/REPORT.md)を参照。この報告の時間と未完了事項は当時の状態に限定する。

これは前回の比較版 `e1e807d…` の記録です。ユーザーによる本番指定（ローカルHTML配布）後の追加実装と配布版の直接検証は[追加検証記録](../followup/REPORT.md)を参照してください。この記録の過去の数値・未実施状態を新しい版の測定値として扱わないでください。

検索中の編集の主要な遅延は解消した。管理対象の実行コード全体に静的検査を適用し、検証スクリプトの重複・環境依存も整理した。ただし、**全操作の性能目標達成、現代化の全完了、本番反映・本番再計測は未完了**。以下の値は隔離したローカル環境の測定であり、本番の短縮率ではない。

## ① 実施結果

|項目|状態|
|---|---|
|更新した配布ソース|`peta-board.html`（単独で動作するオフラインHTML）|
|最終版SHA-256|`e1e807d63e82a144e55fb2c30c2cd88d990e27664afab75ef52db68593ed0489`|
|比較元SHA-256|`77ab5d2c45b696787a6ca5d71f030f7deff142fcfdd6dd2f6961e5fd47c25674`|
|比較元の定義|依頼開始時の作業中HTML。既存の未コミット変更を含む。Git HEAD `23dd083`との性能比較ではない|
|実装・計測日|2026-10-10 JST。各JSONのdateはUTCで保存|
|本番URL・公開バージョン・公開日時|未特定・未公開。ローカル更新を本番公開と扱わない|
|公開先の調査|GitHubのリポジトリ取得成功。Pagesなし、homepage未設定、公開Releaseなし。CLI未認証。コネクターの権限は取得できたが既存公開先・手順を確定できず|
|性能改善|500件・検索中の連続題名編集で同期処理230.0→0.3ms、2フレーム待ちの代理指標268.2→33.3ms（87.6%短縮）|
|挙動検証|3エンジン×63比較点が一致。保存11項目、ドラッグ操作11項目、ドラッグ状態72点・位置探索7,200比較、モーダル6項目が通過|
|未完了|外部公開、本番計測、全操作の時間計測、実IME・実機タッチ・実Safari・スクリーンリーダー、最低対応ブラウザー確定、リモートCI、開発依存の未修正脆弱性|

ソース一覧は[inventory.json](inventory.json)。アプリはHTML1ファイル、CSS3ブロック、JS1ブロック・208関数。検証用ソースはCJS73ファイル（performance内71＋共通部品2）、MJS8、Python6、CI YAML1。過去比較HTML35ファイルは実験入力として固定し、移行のために書き換えない。外部node_modules・生成ロック・生データ・文書を区別して記録した。TypeScript、バックエンド、SQL、テンプレート生成、適用済みDBマイグレーションはない。

画面はボード・編集・カレンダー・設定・ヘルプ・確認の6種類、操作は51グループ。[operations.json](operations.json)にURL、前提、期待結果、関連関数、計測状況を記載した。同じ検索照合・保存形式・描画・移動経路を共有する操作を代表化している。権限別UIやサーバーAPIはない。保存領域はオリジン別で、fileとlocalhostは同一保存領域と見なさない。

## ② コードの現代化の結果

調査日は2026-10-10 JST。新しい構文の年ではなく、正式仕様・ブラウザーの実装・対応環境の維持で判断した。基本的な関数・ループ・条件分岐・CJSは現行の標準であり、一律廃止しない。

|領域・単位|既存|採用|前件数|移行済み|必要な例外|未対応|検査範囲・根拠|
|---|---|---|---:|---:|---:|---:|---|
|HTML・終了タグ|余分なscript終了タグ|正しい1対のscript|1|1|0|0|アプリ、HTML標準・html-validate|
|JS・API参照|非推奨UIEvent.which|isComposing、限定した229補助判定|1|1|0|0|アプリ、MDN・禁止パターン検査|
|JS・JSON比較箇所|変更判定のJSON.stringify比較|変更結果bool、配列・チェック項目の意味比較|3|3|0|0|withActiveNote、タグ、チェック項目正規化。保存・バックアップのJSON化は必要なので継続|
|JS・編集描画経路|検索不一致時に列全体を生成|カード単位の削除・復帰、順序・件数更新|1|1|0|0|renderEditedNote、前後状態比較|
|JS・タイマー管理箇所|ツールチップ非表示タイマーを積み重ねる|clearTimeoutで1件に限定|1|1|0|0|showTooltip/hideTooltip、世代番号の防護も維持|
|JS・順序探索箇所|forEach内のindexOf反復|forEachのindex|1|1|0|0|チェック項目ラベル、比較検証|
|検証JS・利用ファイル|Playwrightの個人環境絶対パス|共通runtime.cjs＋npm依存|58|58|0|0|既存65 CJSのうちブラウザー利用58ファイル|
|検証JS・利用ファイル|別スクリプトの文字列をVMで抽出するfixture依存|fixture.cjsへの明示的依存|58|58|0|0|既存fixture利用58ファイル。fixture実装は共通1箇所に集約|
|検証JS・宣言|未使用ローカル宣言|削除（初期化に副作用があるものは式を保持）|72|72|0|0|初回ESLint指摘の宣言数。VM抽出削除と重なるため各行を合計しない|
|検証JS・Promise executor|式形式による無意味な返値|ブロック形式|69|69|0|0|初回ESLint指摘数、no-promise-executor-return|
|Python・テキストI/O呼び出し|ロケール依存のencoding省略|encoding="utf-8"|53|53|0|0|6ファイル、ASTと構文検査|
|JS・互換参照|keyCode===229|IMEのイベント順序例外のため限定して維持|1|0|1|0|実IMEと最低環境確認後に解除可否を判断|
|JS・互換参照|beforeunload returnValue|preventDefaultと既存互換処理|1|0|1|0|旧対応環境未確定。最低環境確定後に解除判断|
|CSS・互換プロパティ名|WebKit独自プロパティ|標準line-clampも併用、既存表示用3名を限定許可|3|0|3|0|font-smoothing、box-orient、line-clamp。最低環境・表示一致の確認が解除条件|
|CSS・互換セレクター／値|WebKitのscrollbar3種、search-cancel-button、display:-webkit-box|表示・操作を維持して継続|5|0|5|0|プロパティ名とは別の5箇所。標準scrollbar・line-clampと最低対応環境での同等表示確認が解除条件|

件数は修正箇所・宣言・ファイルなど行に示す単位。集約・削除・規則設定は区別した。移行判断済みルールの対象残件は0だが、互換性例外と以下の環境未完了を残すため「旧式実装全廃」とは言わない。過去比較HTMLの旧コードは変更後コードの残件に混ぜず、固定実験入力として一覧に残した。

|仕様・環境|採用範囲・状態|公式根拠と条件|
|---|---|---|
|ECMAScript 2026、第17版|正式公開された2026仕様を検査基準に採用。2027ドラフトや未実装提案は採用しない|[ECMA-262](https://ecma-international.org/publications-and-standards/standards/ecma-262/)。ESLint ecmaVersion 2026。アプリへ2026固有機能の強制導入はしない|
|HTML Living Standard|構造、inert、DOM API。既存のカスタムモーダルをキーボード・表示維持のため継続|[script要素](https://html.spec.whatwg.org/multipage/scripting.html)、[inert](https://html.spec.whatwg.org/multipage/interaction.html#inert)。dialogへの全面置換はフォーカス・描画契約の検証が別途必要|
|CSS nesting / line-clamp|既存のネイティブnestingと標準line-clampを継続。CSS構造検査追加。新たな未対応APIは追加しない|[MDN nesting](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Nesting)、[line-clamp](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/line-clamp)。[CSS nesting草案](https://drafts.csswg.org/css-nesting-1/)を正式公開済み仕様と混同しない|
|IME・離脱処理|which除去。isComposingがfalseになるIMEイベント順序に229補助判定を継続|[MDN keydown](https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event)、[which](https://developer.mozilla.org/en-US/docs/Web/API/UIEvent/which)、[beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)|
|Node.js|計測・検査に24.21.0 LTS。最新Current 26.11.1も検討し、CIで保守期間が長いLTS24を選択|[リリース系列](https://nodejs.org/en/about/previous-releases)、[v24.21.0](https://nodejs.org/en/blog/release/v24.21.0)。システムNode22の全体設定は変更せず隔離実行|
|検査依存|ESLint10.12.0、html-validate11.16.2、Playwright1.64.0、Prettier3.9.9、Stylelint17.16.0。lock固定|[ESLint flat config](https://eslint.org/docs/latest/use/configure/configuration-files)、[Playwright](https://playwright.dev/docs/intro)。実行時のアプリ依存は0|
|検証CJS|明示的な共通部品、node:組み込み、os.tmpdir、pathToFileURL、executor返値禁止|[Node組み込み](https://nodejs.org/api/modules.html#built-in-modules)、[ESLint executor規則](https://eslint.org/docs/latest/rules/no-promise-executor-return)。CJS自体は公式サポート対象で旧式扱いしない|
|Python|pathlib・標準json/statisticsを継続、UTF-8を明示|[pathlib](https://docs.python.org/3/library/pathlib.html#pathlib.Path.read_text)。ホストPython3.9.6で構文検査のみ。最新系列への検証環境更新・全履歴集計の再実行は未実施|
|GitHub Actions|checkout v7.0.1、setup-node v7.1.0、upload-artifact v7.0.2。Node24、3エンジンでチェック|各公式[checkout](https://github.com/actions/checkout/releases/tag/v7.0.1)、[setup-node](https://github.com/actions/setup-node/releases/tag/v7.1.0)、[upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v7.0.2)。ワークフロー作成済み、リモート実行未実施|

再混入防止は`scripts/check.mjs`による埋め込みJS抽出・構文検査・禁止API検査、全MJS/CJSへのESLint、HTML検査、抽出CSSのStylelint、検証ソースのPrettier、Python構文検査。vendorプロパティは一括除外せず3名だけ許可する。アプリの保存形式・キー、Web LocksとIndexedDBの更新順序、160ms自動保存は維持した。[Web Locks仕様](https://www.w3.org/TR/web-locks/)に従う同時保存の制御を削除して速度を稼がない。

開発依存にはhighが5パッケージ残る。原因はbracesの深いパターンによるスタック枯渇で、確認時の最新3.0.3にも公式修正版がない。[公式アドバイザリー](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)と[監査結果](dependency-audit.json)を保存した。npm auditが提示するStylelint7.7.0への大幅なダウングレードは最新基準と整合しないため採用しない。検査は固定された信頼済みglobを使用し、アプリ本体へこの依存は配信しない。安全な修正版への更新は残件。

## ③ 画面別・操作別の時間計測結果

**本番は未計測。以下はローカルChrome154.0.8037.99、file URL、合成データの結果。** 180代表条件・370指標行は[RESULTS.md](RESULTS.md)、試行ごとの範囲は[results.csv](results.csv)、集計定義は[results.json](results.json)。異なる条件の短縮率を平均しない。

|画面・条件|指標|前中央値ms|後中央値ms|差ms|短縮率|試行|判定|
|---|---|---:|---:|---:|---:|---|---|
|編集・1440px・500件・検索中・連続題名|同期入力処理|230.0|0.3|229.7|99.9%|5/5（各7イベント）|CPU処理の短縮|
|同条件|結果確定＋2 rAF|268.2|33.3|234.9|87.6%|5/5（各7イベント）|描画待ちの代理指標の短縮|
|編集・375px・500件・検索中・連続題名|同期入力処理|235.9|0.4|235.5|99.8%|5/5（各7イベント）|短縮|
|同条件|結果確定＋2 rAF|271.4|33.2|238.2|87.8%|5/5（各7イベント）|短縮|
|ボード・1440px・50件・初回・交互再計測|主要表示／操作可能|55.1|51.7|3.4|6.2%|5/5|改善未確認|
|同条件・再読み込み|主要表示／操作可能|34.0|33.7|0.3|0.9%|5/5|改善未確認|
|ドラッグ・500件・付箋移動確定|同期ハンドラー|6.2|5.4|0.8|12.9%|5/5|差が小さく改善未確認|
|同条件|正しい結果＋2 rAF|26.9|25.3|1.6|5.9%|5/5|改善未確認|
|同条件|保存表示完了＋再読込確認|200.9|195.9|5.0|2.5%|5/5|保存高速化は未確認|
|ドラッグ・500件・列移動確定|正しい結果＋2 rAF|32.7|32.3|0.4|1.2%|5/5|改善未確認|
|同条件|保存表示完了＋再読込確認|200.8|188.4|12.4|6.2%|5/5|改善未確認|

短縮率=(前−後)/前×100。1ms未満の前値は精度不足として算出不可。集計スクリプトの判定はmax(1ms,前値の10%)を差の目安にする記述的分類で、有意差検定ではない。未計測は未計測のまま残す。各時刻は表示完了・操作可能・同期ハンドラー・結果・保存を別項目にしたが、測定終了条件が一致する場合は同値になる。

最初の一括測定ではデスクトップ50件の初回表示72.4→111.5ms（−54.0%）を含む負の行が出た。測定順序を交互にした追加5試行では55.1→51.7msとなり、起動の悪化も高速化も再現を確認できなかった。[startup-paired.json](startup-paired.json)は再確認の記録で、元の負の結果を削除・置換していない。初回ヘルプ12.0→32.9msなど、一部モーダル・空データ・エラーの負の値も全表に残した。フレーム位相や環境変動と実装差を十分に切り分けられていないため、残る性能課題とする。

## ④ 連続操作の追従性・滑らかさ

|操作|条件・区間|指標|前|後|試行・観測|評価|
|---|---|---|---:|---:|---|---|
|検索中の連続題名入力|1440px・500件・最初の検索除外後|同期処理ms|230.0|0.3|5試行×7イベント／版|列全体の再生成を除去|
|同条件|同上|結果＋2フレームms|268.2|33.3|5×7／版|各試行中央値をさらに中央値化|
|描画トレース|1440px・500件・検索中の5入力|入力mark→同一rendererの最初のPaint ms中央値|205.4|11.4|1セッション×5入力／版|描画負荷削減の裏付け。独立5試行とは区別|
|同トレース|5入力を含む取得区間|Layout累積ms|666.0|15.2|1セッション／版|帰属調査、通常試行の時間と混ぜない|
|高頻度付箋ドラッグ|dense・20フレーム×8イベント|フレーム間隔中央値ms|16.7|16.7|5試行×20フレーム／版|改善未確認|
|同条件|プレビュー関数20回|CPU累積ms中央値|4.3|6.0|5試行／版|−1.7ms。区間累積の悪化が残る|
|高頻度列ドラッグ|dense・20フレーム×8イベント|フレーム間隔中央値ms|16.7|16.7|5試行×20フレーム／版|改善未確認|
|同条件|プレビュー関数20回|CPU累積ms中央値|1.6|3.0|5試行／版|−1.4ms。区間累積の悪化が残る|

ドラッグの矩形取得数はdense付箋220／220、列40／40で同じ。FPSへの時間短縮率換算は行わない。frameReadyは実表示の到達時間やINPではない。CDP Paintも物理ディスプレイ・コンポジターの提示を保証しない。合成pointermoveは実タッチの追従性の代わりにならない。つかみ始めの遅延、スクロール・リサイズの滑らかさは今回未計測。

実マウスの移動確定は最終列・順序・DOM・保存・再読込を各5回確認。ドラッグの比較72点、位置探索7,200比較、キャンセル・lostcapture・最終座標・自動縦横スクロール・合成タッチを既存ランナーで再検証した。既存ドラッグアルゴリズムは今回変更しておらず、前回の大幅改善を今回の効果に混ぜない。

## ⑤ 検証の根拠と残る課題

### 再現方法と計測条件

1. Node24.21.0以上、`npm ci`、`npx playwright install chromium firefox webkit`を準備する。
2. `BROWSERS=chromium,firefox,webkit npm run ci`で構文・静的検査と挙動比較を行う。
3. `node scripts/benchmark.mjs`で比較元と変更後を同じ一時URLへ順にコピーして測定する。`CHROME_PATH`で同一の実Chromeを指定可能。デフォルトはPlaywright Chromiumなので、再現時はブラウザー番号も確認する。
4. `node scripts/startup-paired.mjs`で起動の交互測定、`node scripts/trace.mjs`で描画の帰属調査、`node scripts/summarize.mjs`で集計する。
5. `node scripts/audit.mjs`で管理対象とSHA-256の一覧を更新する。

ブラウザーはheadless、独立コンテキスト、ユーザーのプロファイル・保存領域へアクセスしない。人工的なCPU・ネットワーク制限なし。各条件5試行。0/50/500件、幅375/1440pxを性能比較し、回帰検証は320/375/1440px。画面ランナー高さは812/900px、編集は900px。通常fixtureは50件4列、500件12列、本文約2,400〜2,800字、チェック項目3/30件。編集測定のみ密集1列。初回はIndexedDB未作成、warmは同じコンテキストの再読込。起動時間にはfixture投入と初期化も含む。実ユーザーのデータ・権限・端末による測定ではない。

変更なし入力の早期return、検索用WeakMapの無効化、検索除外／再一致、本文・タグ・チェック・期限、取り消し、移動、状態置換、保存を確認。WeakMapは削除済みオブジェクトを保持せず、別タブ同期やimportは正規化した新規オブジェクトなので古いキャッシュを使わない。列名もキャッシュキーの照合に含む。

### 原因・変更・効果・検証の対応

|確認した原因／旧実装|変更|効果|検証|
|---|---|---|---|
|検索で消えた付箋を入力するたびに500枚を再生成|単一カードの有無・一致遷移だけ更新|連続入力230→0.3ms、PaintとLayoutも減少|検索除外・復帰・順序・寸法、3エンジン比較|
|毎入力で全チェック項目をJSON化、検索文字列を再連結|フィールド変更bool・意味比較・WeakMap|描画減少と合わせて同期CPU減少。単独寄与率は未分離|キャッシュ無効化とチェック削除取り消しを比較|
|最初の候補で通常編集にもscrollTopを読む|一致状態が変わらない場合は即return|通常500件編集で0.4→約16msの悪化を発見し修正|失敗候補のedit-candidate-regression.jsonも保存|
|検証コードが個人環境・VM抽出に依存|共通部品、依存固定、OS非依存パス|保守性・再現性。アプリ速度の効果は主張しない|全CJS/MJS静的検査、実ブラウザーの回帰|
|旧API・不正HTML・無制御タイマー|which除去、終了タグ修正、タイマー1件化|標準適合と不要処理整理。タイマー単体の性能効果は未計測|HTML/CSS/JS検査、表示比較・モーダル検証|

### 保存した証拠と検証範囲

- `edit-before/after.json`：編集の各イベントの生値。
- `screens-before/after.json`：全画面・検索の初回／再表示、0/50/500件。
- `io.json`：取り込み確認／結果、バックアップの実ダウンロード内容、別タブ同期。
- `errors.json`、`empty-editor.json`：空・破損・保存読み取り失敗・Web Locksなし等。
- `drag-before/after.json`、`drag-commit-before/after.json`：追従／確定／保存。
- `trace-before/after.json`、`trace-summary.json`：Chromeトレースと帰属。
- `regression.json`：Chromium156.0.8078.4、Firefox157.0、WebKit27.2、各63点一致、pageerrorなし。
- `storage-regression.json`、`gestures.json`、`drag-regression.json`、`modal-verification.json`：機能確認。
- 36枚のbefore/after PNG：各エンジン・幅・初期表示／設定保存後。320px初期表示を目視比較し一致確認。
- `checks.json`、`inventory.json`、`release-status.json`：最終検査・コード一覧・公開状況。

本番最低対応環境は未指定。現行の3エンジン検証を旧WebView・実Safari・実端末の確認と混同しない。合成IMEはOSの日本語変換の検証にならない。全Python履歴集計の実行結果は未確認。古い集計ランナーが対応する比較版のハッシュに限定されるのは再現性の保護で、現行版をその古い結果と集計しない。

375pxのWebKitで設定保存後の画像も前後比較した。120字の題名が小さいカード内で下の情報と重なる表示は比較元にもあり、前後で同じ。既存の表示問題として未解消で、寸法一致を表示品質の全面合格とは扱わない。

### 残件・再開条件・復旧

操作一覧の12グループには今回の時間未計測または実機未確認を明記した。戻る／進む、縦横スクロール、リサイズ、深夜の期限更新、実IME、ツールチップ、日付・設定・ヘルプ内の細かな操作は時間計測が残る。主要表示や保存が十分速いかを一律保証する目標値はない。検索中編集の代理指標50ms以内は今回満たしたが、他の操作で改善未確認・負の結果がある。

残る候補は、500件時の初回列生成、取り込みの大きな同期処理、保存前JSON化・localStorage書き込み、密集列移動のフレーム予算。仮想化は表示・検索・アクセシビリティに影響するため追加仕様検証が必要。Worker化は更新順序とオフライン単独HTMLを維持した検証が必要。保存待機を減らすと書き込み回数・競合が変わるので、今回の測定だけで短縮しない。推定の追加効果を実測値として示さない。

通常の本番反映は依頼で許可されているが、配布先・既存手順が特定できない。確認済みの公開先がない状態で新規ホスティングを作成したり、開始時からある未コミット作業を一括で公開したりしない。再開に必要なのは配布先と反映手順、最低対応ブラウザー。公開後に配信HTMLのハッシュ、保存・同期・import・drag・取り消し、同じ代表条件の性能を確認する。本番前データがなければ本番短縮率は算出しない。

更新前への復旧はアプリを`before.html`から戻す。Git HEADに戻すと依頼開始以前の作業も失うため、その方法は使わない。今回保存形式は変更していない。file URLのパスを変えると保存領域が変わる可能性があるので、配布ファイル名・位置を維持し、利用者は事前にバックアップする。外部公開していないため、公開先のrollbackは未実施。

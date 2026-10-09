# 全操作・現代化の追加検証（2026-10-10 JST）

## ① 実施結果

本番はユーザー指定のローカルHTML配布。[peta-board.html](../../peta-board.html)のSHA-256は30143609a812f288974b3a84a93d1a07b544af5990c9f9fb3ca8696bee330bd2。今回、配布版のバイト列は変更していない。既存の改善を維持し、検索レイアウトの追加案2種類を実装・比較したが、リサイズ後の位置差を確認したため採用しなかった。同期入力CPUと結果＋2rAF、表示・状態を比較する管理計測コードを拡充した。

全体のリファクタリング・高速化の完了条件は未達。決定済み置換対象は残件0だが、互換性例外10、Ruffターゲット設定1、空下書き破棄の挙動維持経路1を残す。最低対応環境・実機IME／タッチ／Safari、実利用INP、リモートCI、未計測操作、前回の負値の原因未確定が残る。今回の候補を配布版の改善として報告しない。

管理範囲はアプリHTML1／CSS3／JS1・213関数、CJS74、MJS23、Python7、YAMLと埋め込みBash、JSON／TOML設定。管理ソース／設定／ロックは合計113ファイル（アプリ1、検証コード105、設定6、ロック1）。比較入力の凍結HTML45本は別分類。6画面系統・52操作群の[対応表](../round6/operations.json)を継続し、今回の検索語5種類・2幅・2データ量を補足する。TypeScript、バックエンド、SQL、DB移行は存在しない。全ファイルとハッシュは[inventory.json](inventory.json)。版・本番URL・実行日時・証拠のハッシュは[release-status.json](release-status.json)。JSONの時刻はUTC、JSTは+9時間。

遅延候補は、9〜10枚の検索結果が列のCSS高さ上限を超えるのに、従来の画面高さによる条件では本文の内在サイズ計算を省けない経路。案AはCSSのmin-height／max-heightをDOM変更前に読み、既存の包含・折り返し省略の条件を広げた。案Bは折り返しを維持してサイズ包含だけを広げた。どちらも通常検索の一致を確認し、短縮値を示した。しかし320px・500件・長短題名と本文の混合・最右列まで横移動・各リスト最下部・高さ900→1700の条件で、先頭列内カードの位置に20pxの差が出た。見える範囲の画像は一致しても位置の維持条件を満たさないので不採用。

同じ配布版どうしで同一境界条件を5回繰り返した対照は全35状態で寸法・画像・アクセシビリティ名／役割が一致した。候補の差を単なる測定ノイズとして除外しない。スクロールアンカーや包含解除が関係する可能性はあるが、原因は未確定。必要な復旧は配布版を変更しないことで完了し、両候補を比較入力として凍結した。

## ② コードの現代化の結果


調査日は2026-10-10。箇所・呼び出し・宣言・ファイル・設定など、行ごとに件数の単位を示す。重複範囲と異なる単位を合計しない。過去記録の移行数を保持し、規則追加と実際のソース置換は別に扱う。

|言語・領域／単位|旧実装|採用した実装|変更前|移行済み|例外|未対応|根拠・範囲|
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
|JS・列名編集の描画経路|一致結果が同じでも列内の全カードを再生成|既存DOMと状態のID順を照合、差があればMapとreplaceChildrenで既存要素を再利用|1|1|0|0|[列名の前段記録](../followup/REPORT.md)|
|Python・複文箇所|セミコロンやコロン後の圧縮複文|独立した文・ブロック|85|85|0|0|6履歴Python、[前段記録](../followup/REPORT.md)|
|Python・複数import文|1行に複数module|整理したimport|6|6|0|0|6履歴Python、[前段記録](../followup/REPORT.md)|
|Python・import順序のファイル|不統一|Ruffの順序規則|6|6|0|0|6履歴Python、[前段記録](../followup/REPORT.md)|
|Python・宣言|未使用import|削除|2|2|0|0|6履歴Python、[前段記録](../followup/REPORT.md)|
|Python・宣言|不要なUTF-8 coding宣言|削除。テキストI/OのUTF-8指定は継続|3|3|0|0|6履歴Python、[前段記録](../followup/REPORT.md)|
|Python・UTC参照|datetime.timezone.utc|datetime.UTC|2|2|0|0|6履歴Python、[前段記録](../followup/REPORT.md)|
|Python・CSV I/O呼び出し|改行をOS既定に任せる3書き込み、明示closeなしの2読み込み|newline=""、withによる解放|5|5|0|0|6履歴Python、[前段記録](../followup/REPORT.md)|
|CSS・背景定義|明暗・印刷の色を3箇所に定義|共有CSS変数2色を参照|3|3|0|0|applyThemeと印刷、3エンジン|
|JS・スタイル読取経路|テーマ属性変更後に全体スタイルを読取|変更前に共有色を読取|1|1|0|0|同期スタイル再計算を回避、CDPトレース|
|JS・付箋コレクション経路|全ボード再生成|該当列・カード・容量・件数更新|4|4|0|0|追加／複製／削除／復元|
|JS・列コレクション経路|全ボード再生成|既存列を保持し追加・削除・順序更新|3|3|0|0|追加／削除／復元。既存並べ替え2呼び出しも共通化|
|JS・検索中移動経路|全ボード再生成|移動元と先だけ照合|1|1|0|0|renderMovedNote|
|JS・離脱購読経路|beforeunload常時登録|未保存・変換中だけ登録／解除|1|1|0|0|named handler、保存／キャンセル／再試行／別タブ|
|検査・正規表現箇所|which禁止境界が制御文字|正しい単語境界＋独立AST規則|1|1|0|0|注入プローブで拒否確認|
|Python・実行環境の不足|3.15実行未確認|公式3.15.0のSHA照合・隔離ビルドと実行|1|1|0|0|7ファイル静的検査と過去6出力|
|CI・環境取得経路|未提供の3.15アーカイブだけに依存|公式ソース・SHA照合の条件付きビルド|1|1|0|0|Bash構文とローカルビルド検証。Linux実行は未実施|
|検証JS・資源管理経路|検索ランナーの起動失敗時に一時ディレクトリーが残る|起動をtry内へ移し、close失敗でもfinallyで解放|1|1|0|0|search-render.mjs、故意の起動失敗による解放確認|
|検証JS・資源管理経路|表示assert失敗時にブラウザー終了処理を通らない|finallyで必ずclose|1|1|0|0|display.cjs、不一致再試行で確認|
|JS・IME互換参照|keyCode229|イベント順序を補う限定参照|1|0|1|0|最低環境／実機IME確認後に削除判断|
|JS・離脱互換参照|returnValue|preventDefault＋trueを限定併用|1|0|1|0|Chrome／Edge119未満の互換。最低環境確定後に削除判断|
|CSS・互換プロパティ名|WebKit固有3名|標準と併用して限定継続|3|0|3|0|font-smoothing／box-orient／line-clamp|
|CSS・互換セレクター／値|scrollbar3種／search-cancel／webkit-box|既存表示・操作の維持|5|0|5|0|最低環境で標準の同等表示確認後に削除判断|
|Ruff・言語ターゲット設定|py315専用規則は開発中|previewを使わずpy314＋実際の3.15構文／実行|1|0|1|0|Ruff0.16.10の実行警告。正式安定対応後に更新|
|JS・空下書き破棄経路|全描画|元の経路を維持|1|0|1|0|部分更新ではフォーカスが列題名から追加ボタンに変化。挙動維持が採用条件|

安定したECMAScript2026第17版を解析基準に採用し、未実装提案をアプリへ導入しない。[ECMA-262](https://ecma-international.org/publications-and-standards/standards/ecma-262/)。HTMLは[Living Standard](https://html.spec.whatwg.org/multipage/)、CSSは[共有変数](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties)と既存nesting／標準line-clampを維持。独自モーダルはフォーカス・キーボード・inertの契約を検証し、dialogへ機械的には置換しない。[line-clamp](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/line-clamp)の互換制約を残す。

[replaceChildren](https://developer.mozilla.org/en-US/docs/Web/API/Element/replaceChildren)とMapで既存DOMを保持し、不要な全体生成を除去した。[beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)の推奨に従い、保存済み時の購読を解除する。preventDefaultとreturnValue=trueは旧環境への限定互換。[IMEイベント順序](https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event)のため229補助判定を維持する。

Node24.21.0 LTS、ESLint10.12.0、html-validate11.16.2、Playwright1.64.0、Prettier3.9.9、Stylelint17.16.0、Ruff0.16.10を固定した。NodeのCurrent系列よりLTSの保守期間を選択。アプリ実行時依存0。[Python3.15.0公式](https://www.python.org/downloads/release/python-3150/)ソースのSHAを照合してmacOSでビルドし、通常GIL・JITオフで実行。3.14.8互換確認も保持。[実ランタイム設定とビルド記録](../round5/python-runtime.json)。[ビルド設定](https://docs.python.org/3.15/using/configure.html)。公式Actions manifestには取得時点で3.15安定版が未掲載だったため、CIにソース取得の代替経路と実際のバージョンassertを追加した。[取得根拠](../round6/python-ci-availability.json)。リモートCI／Linuxビルドは未実行。

再混入防止は全管理MJS／CJSと抽出アプリJSのESLint、禁止API＋which AST規則、HTML構造、CSS3ブロック、Python7本のRuff／整形／構文と6ランナー出力比較、CI埋め込みBashのbash -n。除外はnode_modulesと公式CPython等の外部コード、凍結した比較HTMLだけで、管理ソースを一括除外しない。[開発規約](../../README.md)。UTF-8／CSV改行／with解放／UTC／共通fixtureとruntimeを適用し、不要宣言・VM文字列依存・タイマー積み上げを除去。保存キーpetaborad.state.v1、形式version1、160ms待機、Web Locks／IndexedDBの更新順序、500枚／12列／32MiB上限は維持。



今回の更新は管理MJS1本（scripts/search-render.mjs）と新規CJS1本（display.cjs）。ES2026の解析・禁止API・Promise返値禁止・HTML・CSS・整形の基準を適用した。検索の描画寸法、入力選択、フォーカス、スクロール、全状態を前後照合し、実配布file URLでの計測とFirefox／WebKitの経路を追加した。検証のためだけに、明示した最適化用クラス名を正規化できる。寸法や表示内容・状態の差は正規化しない。配布アプリではこの検証許可を使わない。

候補の高さ読取は既存の[getComputedStyle](https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle)と[min-heightがmax-heightに優先するCSS規則](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/max-height)に沿う。資料確認日は2026-10-10。新しい実験APIや対応環境の縮小は導入していない。アプリの置換件数としては0で、試験案の実装件数と区別する。候補HTML2本のJS／CSSを抽出して検査した。初回HTML検査のCLI拡張子を.jsと誤指定した記録を保持し、package.jsonの正式な.mjs経路で再実行して通過。検査規則の無効化はしていない。

## ③ 本番での画面・操作別の時間計測

今回の本番検索計測は、実際の配布file URLを隔離コンテキストで開き、合成50／500件、375／1440×900、Chrome154、macOS26.2 arm64で行う。各条件5コンテキスト、検索語は「付箋1」「通常」「一致しない語」「空」「検証」の固定順。利用者の保存領域は使わない。同一コンテキスト内の順次操作なので、各イベントを独立試行としない。タイトル検索は検索系列の初回、後続は反復・暖機を含む。

handlerは合成InputEventを同期処理するCPU時間、resultProxyは正しい結果が成立した後に2回のrAFを待つまでの時間。ネイティブの入力初期反応、物理提示、Paint、保存完了を保証しない。検索は保存状態を変えない。今回の終了条件による変更前の本番値がないため、短縮率は算出不可。版自体も変更していないので、候補の一時URLでの率を本番へ転用しない。

|本番・1440px／500件・固定系列|指標|前中央値ms|後中央値ms|後の範囲ms|差・率|回数前／後|
|---|---|---|---:|---|---|---|
|検索付箋1|handler|未計測|8.8|8.7〜8.9|算出不可|0／5|
|検索付箋1|resultProxy|未計測|166.9|165.5〜167.6|算出不可|0／5|
|検索通常|handler|未計測|7.5|7.4〜7.7|算出不可|0／5|
|検索通常|resultProxy|未計測|51.1|49.3〜51.3|算出不可|0／5|
|検索一致しない語|handler|未計測|2.7|2.7〜2.8|算出不可|0／5|
|検索一致しない語|resultProxy|未計測|33.1|32.1〜35.3|算出不可|0／5|
|検索クリア|handler|未計測|5.2|5.0〜5.3|算出不可|0／5|
|検索クリア|resultProxy|未計測|133.4|132.8〜149.3|算出不可|0／5|
|検索検証|handler|未計測|14.7|14.5〜15.1|算出不可|0／5|
|検索検証|resultProxy|未計測|116.6|115.8〜116.8|算出不可|0／5|

本番の全40指標と試行幅は[results.json](results.json)、[CSV](results.csv)、100生観測は[search-production-final.json](search-production-final.json)。配布HTMLのハッシュとfile URLを各データへ保存した。以前の本番で確認した付箋復元235.4→33.6ms、列復元240.0→33.9ms（500件、5/5、結果＋2rAF）は[前回の本番証拠](../round6/collection-production-results.json)を維持する。今回の再計測値ではない。全816指標・設定／カレンダー等の負値も[前回報告](../round6/REPORT.md)から削除しない。

次は一時URLの交互前後比較で、**不採用案の検証値**。配布版を更新していないので本番の改善ではない。率は（前中央値−後中央値）÷前中央値×100、負値も保持する。各条件5／5、同じテンポラリーfile URL・同じ合成データ・AB／BAの順を交互に変える。系列内の順序は固定し、比較条件を混ぜない。

|不採用案・エンジン／1440px／500件|操作|指標|前ms|候補ms|差ms|率|試行|
|---|---|---|---:|---:|---:|---:|---|
|案A・初期／154.0.8037.99|付箋1|handler|8.8|9.5|-0.7|-8.0%|5／5|
|案A・初期／154.0.8037.99|付箋1|resultProxy|166.3|65.9|100.4|60.4%|5／5|
|案B／154.0.8037.99|付箋1|handler|8.8|9.3|-0.5|-5.7%|5／5|
|案B／154.0.8037.99|付箋1|resultProxy|167.1|99.9|67.2|40.2%|5／5|
|案B／154.0.8037.99|クリア|handler|5.2|5.0|0.2|3.8%|5／5|
|案B／154.0.8037.99|クリア|resultProxy|133.5|149.5|-16.0|-12.0%|5／5|
|案B／157.0|付箋1|handler|13.0|14.0|-1.0|-7.7%|5／5|
|案B／157.0|付箋1|resultProxy|52.0|64.0|-12.0|-23.1%|5／5|
|案B／157.0|クリア|handler|12.0|12.0|0.0|0.0%|5／5|
|案B／157.0|クリア|resultProxy|109.0|112.0|-3.0|-2.8%|5／5|
|案B／27.2|付箋1|handler|21.0|20.0|1.0|4.8%|5／5|
|案B／27.2|付箋1|resultProxy|207.0|169.0|38.0|18.4%|5／5|
|案B／27.2|クリア|handler|10.0|10.0|0.0|0.0%|5／5|
|案B／27.2|クリア|resultProxy|388.0|388.0|0.0|0.0%|5／5|

全エンジンの40条件指標ずつと案Aの初期値はresults.json／CSVに保存する。移行途中で計測ランナーのファイルを修正した初期案Bのsearch-contain.jsonは、最後に読んだランナーSHAと実行ソースが一致しないため最終集計から除外する。同じ候補・現行ソースでsearch-contain-final.jsonを再実行し、正しい[実行ソース](search-measurement-source.json)を保存した。案Aの初期ランナーも後続変更があるため現行ランナーSHAで再現したと扱わず、初期値として区別する。動作や位置差を理由なく除外して性能だけを採用しない。

## ④ 連続操作の追従性・滑らかさ

配布HTMLのバイト列は前回の連続検証と同じ。今回、ドラッグ／スクロールの新しい前後系列は未計測で、性能の追加改善を主張しない。検索の2rAF時間を連続操作のFPSや実測表示追従性へ変換しない。

|配布版・条件|保持する前回の検証|前／後|評価・限界|
|---|---|---|---|
|500件・密なドラッグ|rAF更新間隔P95／最大|16.8／16.8ms → 16.8／16.8ms|改善未確認。rAF間隔で物理FPSではない|
|同条件|25ms以上／50ms以上の間隔|両版0／0|性能率へ変換しない|
|検索中の付箋移動|CPU／結果＋2rAF／保存|22.2→22.1／33.5→33.9／185.1→185.2ms|5／5。負の差も保持。新計測ではない|
|ドラッグ結果|最終ID順・列・保存・取り消し|前回の全検証通過|[生観測と観測数](../round6/drag-results.json)|
|高さ変更後の候補|カード位置の前後一致|20px差|候補の不採用理由。滑らかさの改善とは別の維持条件|

前回の初回ドラッグ計測中断19コンテキストは根本原因が未確定で、同版の完全再実行通過をもって初回失敗を消していない。詳細、7200移動、保存、最終順序、各試行の区間は[前回総合記録](../round6/REPORT.md)。

## ⑤ 検証の根拠と残る課題

通常検索は各エンジンで2幅×2件数×5コンテキスト×5語×前後＝200観測、100対の寸法・本文・件数・ID順・全状態・フォーカス・入力選択・スクロールを比較する。最適化用クラスだけを明示して正規化し、それ以外の差はassertで失敗する。リロードで元の全付箋を復元し、ページ例外も照合する。実本番100観測は前後対ではなく独立した現行版の値。

表示境界試験は320／375／1440幅、5／50／500件、長短題名・本文・フッター有無、横端、縦端、高さ1700／400、文字24pxと本文5行を含む。案A／Bは320px・500件混合の高さ1700で失敗し、その先の条件は未実施。各案のそれ以前の28状態は寸法が一致した。位置差の追加検証では対象リストのscrollTopが配布版20px・候補0pxだった。寸法だけでなくスクロール値を記録した同一版対照も5試行・35状態で一致した。3幅全105状態で表示検証済みとはしない。画像の完全一致も、位置が画面外で異なるケースを合格にする理由にしない。対照は同一HTML5試行・35状態一致。AX比較はInlineTextBoxのブラウザー内部の折り返し断片のみ除き、完全StaticTextを含む役割・名前・値を比較する。実機読み上げ試験とは区別する。

最終的に検索ランナーは起動失敗時も一時ディレクトリーを解放し、本番モードでは一時ファイルを作らないよう整理した。表示ランナーはassert失敗時もfinallyでブラウザーを閉じる。既存／新規の資源管理経路2箇所を修正。起動失敗を故意に発生させた[解放検証](cleanup-probe.json)と、失敗をそのまま記録して終了した表示再試行を保持。タイミング処理は変更せず、3エンジンの実行ソースと最終本番の実行ソースをそれぞれ凍結した。最終版で本番100観測を再実行。

今回の全管理JS、抽出候補JS、アプリ／候補HTML、抽出CSS、Prettier、Python3.15でのRuff7／format7／過去出力6、禁止API／CI埋め込みBash／git diff --checkの結果は[checks.json](checks.json)。初回実行上の誤指定は[checks-initial.json](checks-initial.json)に保持。アプリが同一ハッシュなので、前回の3エンジン各102対、保存・同期・失敗・離脱・履歴・日付の検証も有効範囲を明示して引用し、新しい検証件数には加えない。

再現はNode24.21.0と固定依存を使う。通常候補はEVIDENCE_DIR=performance/round8、AFTER_SOURCE=performance/round8/candidate-contain.html、ALLOW_CLIPPED_CLASS=1、BROWSERを指定してscripts/search-render.mjsを実行。本番はPRODUCTION_ONLY=1とOUTPUTを指定し同じランナーを実行。表示の不一致はCANDIDATEとCONTROL_ONLY=1、OUTPUT_DIRを指定してdisplay.cjsで再現し、対照はCANDIDATE=performance/round8/before.html・TRIALS=5。利用者データに触れない隔離ブラウザーを使う。実行ソースと候補・配布版のハッシュを保存する。

採用判断の対応は「列の実際の上限と既存条件の不一致 → CSS上限を読んで包含条件を拡大 → 同期DOM変更前の読取・共通引数 → 通常検索の短縮観測 → リサイズ後位置不一致 → 不採用」。性能だけで維持条件を上書きしない。案Bも位置差を解消できず不採用。より安全に包含の解除とスクロール位置を維持する案は未実装で、追加効果は推定しない。

残課題は、候補のリサイズ位置差の原因解明、前回の設定／カレンダーの負値の完全切り分け、一部操作の未計測、実機IME・タッチ・Safari／WebViewと最低対応環境、実利用INP・提示・長期メモリ、リモートCI／Linux Pythonフォールバック実行。最低対応環境が確定し、互換の同等動作を確認するまで、例外10参照・設定1・空下書き1経路を残す。外部開発依存のbraces高5件も未修正で、配布HTMLには同梱されない。前回の狭幅長題名の既存表示課題も解消済みとはしない。

本番URLと版の再確認は済むが、配布先の追加指定がないため現在のHTML以外の場所への配布はしていない。ローカル単独HTMLという指定に沿う。新機能の本番反映は今回なし。全操作の高速化・全面現代化の完全達成とはしない。

# ローカルHTML配布版の最終検証（2026-10-10 JST）

## ① 実施結果

配布対象はプロジェクト直下の[peta-board.html](../../peta-board.html)。ユーザーが指定した「ローカルHTMLの配布」を本番とし、同じfile URLを隔離ブラウザーで直接開いて再計測した。更新済みファイルのSHA-256は `30143609a812f288974b3a84a93d1a07b544af5990c9f9fb3ca8696bee330bd2`。最後の比較元は `59bdc461ed5029ea7cbe60fe637b34b89eef5bbffff8f68ba99cd6a7563e580b`（round6/before.html）。配布ファイル更新と検証は完了したが、利用者の端末への配布・インストールやリモートCI実行は確認していない。

本番URLは[release-status.json](release-status.json)のproductionUrl。UTCの計測時刻は[measurement-stages.json](measurement-stages.json)、日本時間はUTC+9。最終本番の主計測は2026-10-10 03:57〜04:07 JST、ドラッグと追加検証は各JSONに別の取得時刻を保存。前後のChromeは154.0.8037.99、macOS26.2 arm64、同じfixture・保存キー・パス。公開Webサービスへのデプロイではない。

単一HTML、CSS3ブロック、JS1ブロック・213関数、管理CJS73本、MJS21本（設定1本を含む）、Python7本、CI YAMLと埋め込みBash、JSON／TOML設定を監査対象とした。TypeScript、バックエンド、SQL、DB移行履歴は存在しない。過去比較HTML40本は変更しない実験入力、npm lockは生成設定、node_modulesと隔離CPythonは外部コードとして区別する。最終件数と各ハッシュは[inventory.json](inventory.json)。6画面系統・52操作群の対応は[operations.json](operations.json)。画面100条件×5試行、操作560観測、テーマ100イベント、連続操作240観測を最終配布版で取得した。無効な入口・非該当行は実行した操作数に数えない。

現代化では決定した置換対象の未対応は0。互換性例外10箇所、Ruffの言語ターゲット1設定、挙動維持のため残した空下書き破棄1経路は明示して残す。最低対応環境が未確定で実機検証も残るため、「全旧式実装を廃止」「依頼の全完了」とはしない。

主要な性能改善は前段のテーマ再計算と付箋・列の部分更新で確認した。最終段はbeforeunloadの常時登録を未保存・変換中だけの登録に変更した。この段階の時間差から速度改善は確認できない。最終の付箋復元33.6ms・列復元33.9ms（500件・1440px、結果＋2rAF）は前段の改善後と同程度。保存は185.4／189.2msで、既存160msの待機・同期順序を維持している。

|段階|ハッシュ（先頭）|変更と確認した効果|証拠|
|---|---|---|---|
|最初の現代化|77ab5d→e1e807|検索から外れた付箋の連続編集CPU230.0→0.3ms、2rAF268.2→33.3ms。比較環境の値|[記録](../modernization/REPORT.md)|
|列名検索・Python|e1e807→f9f6ae|列名編集CPU221.3→5.6ms、2rAF260.4→33.0ms。比較環境の値|[記録](../followup/REPORT.md)|
|テーマ|f9f6ae→e26dcd|初回テーマ本番CPU53.1→0.5ms、最初のrenderer Paint108.0→95.1ms、2rAF208.7→175.7ms（5/5）|[記録](../round4/REPORT.md)|
|部分更新|e26dcd→59bdc4|本番の付箋復元235.4→33.5ms、列復元240.0→34.6ms。交互比較でも短縮|[記録](../round5/REPORT.md)|
|離脱監視|59bdc4→301436|保存済み0／未保存1リスナー。未保存の警告・再試行・更新反映を確認。時間改善は未確認|この報告|

各行はその段階だけの値であり、古い値を最終SHAの測定値に付け替えない。異なる操作の率を平均しない。

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
|JS・IME互換参照|keyCode229|イベント順序を補う限定参照|1|0|1|0|最低環境／実機IME確認後に削除判断|
|JS・離脱互換参照|returnValue|preventDefault＋trueを限定併用|1|0|1|0|Chrome／Edge119未満の互換。最低環境確定後に削除判断|
|CSS・互換プロパティ名|WebKit固有3名|標準と併用して限定継続|3|0|3|0|font-smoothing／box-orient／line-clamp|
|CSS・互換セレクター／値|scrollbar3種／search-cancel／webkit-box|既存表示・操作の維持|5|0|5|0|最低環境で標準の同等表示確認後に削除判断|
|Ruff・言語ターゲット設定|py315専用規則は開発中|previewを使わずpy314＋実際の3.15構文／実行|1|0|1|0|Ruff0.16.10の実行警告。正式安定対応後に更新|
|JS・空下書き破棄経路|全描画|元の経路を維持|1|0|1|0|部分更新ではフォーカスが列題名から追加ボタンに変化。挙動維持が採用条件|

安定したECMAScript2026第17版を解析基準に採用し、未実装提案をアプリへ導入しない。[ECMA-262](https://ecma-international.org/publications-and-standards/standards/ecma-262/)。HTMLは[Living Standard](https://html.spec.whatwg.org/multipage/)、CSSは[共有変数](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties)と既存nesting／標準line-clampを維持。独自モーダルはフォーカス・キーボード・inertの契約を検証し、dialogへ機械的には置換しない。[line-clamp](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/line-clamp)の互換制約を残す。

[replaceChildren](https://developer.mozilla.org/en-US/docs/Web/API/Element/replaceChildren)とMapで既存DOMを保持し、不要な全体生成を除去した。[beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)の推奨に従い、保存済み時の購読を解除する。preventDefaultとreturnValue=trueは旧環境への限定互換。[IMEイベント順序](https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event)のため229補助判定を維持する。

Node24.21.0 LTS、ESLint10.12.0、html-validate11.16.2、Playwright1.64.0、Prettier3.9.9、Stylelint17.16.0、Ruff0.16.10を固定した。NodeのCurrent系列よりLTSの保守期間を選択。アプリ実行時依存0。[Python3.15.0公式](https://www.python.org/downloads/release/python-3150/)ソースのSHAを照合してmacOSでビルドし、通常GIL・JITオフで実行。3.14.8互換確認も保持。[実ランタイム設定とビルド記録](../round5/python-runtime.json)。[ビルド設定](https://docs.python.org/3.15/using/configure.html)。公式Actions manifestには取得時点で3.15安定版が未掲載だったため、CIにソース取得の代替経路と実際のバージョンassertを追加した。[取得根拠](python-ci-availability.json)。リモートCI／Linuxビルドは未実行。

再混入防止は全管理MJS／CJSと抽出アプリJSのESLint、禁止API＋which AST規則、HTML構造、CSS3ブロック、Python7本のRuff／整形／構文と6ランナー出力比較、CI埋め込みBashのbash -n。除外はnode_modulesと公式CPython等の外部コード、凍結した比較HTMLだけで、管理ソースを一括除外しない。[開発規約](../../README.md)。UTF-8／CSV改行／with解放／UTC／共通fixtureとruntimeを適用し、不要宣言・VM文字列依存・タイマー積み上げを除去。保存キーpetaborad.state.v1、形式version1、160ms待機、Web Locks／IndexedDBの更新順序、500枚／12列／32MiB上限は維持。

## ③ 本番での画面・操作別の時間計測

以下は同一配布パスの59bdc4→301436。Chrome154、1440×900／375×812、合成0／50／500件、各条件5独立コンテキスト。前の採取時期はRound5、後はRound6で、観測時期の差がある。CPU・入力待ち・renderer Paint・結果＋2rAF・保存表示は別指標。DOM／rAF／opacity／inertの終了条件は物理画面提示や完全な描画完了を保証しない。正しい件数・順序・状態と保存後の完全な再読込を確認した。

|画面・操作・条件|指標|前ms|後ms|差ms|短縮率|前／後|判定|
|---|---|---:|---:|---:|---:|---|---|
|テーマ切替・1440px/500件/first|handler|0.2|0.2|0.0|算出不可|5/5|改善未確認|
|テーマ切替・1440px/500件/first|firstRendererPaintMs|48.1|48.1|0.1|0.1%|5/5|改善未確認|
|テーマ切替・1440px/500件/first|resultProxy|113.3|113.7|-0.4|-0.4%|5/5|改善未確認|
|テーマ切替・1440px/500件/first|savedMs|182.5|182.1|0.4|0.2%|5/5|改善未確認|
|テーマ切替・1440px/500件/first|eventTiming.inputDelayMs|2.9|3.0|-0.1|-3.4%|5/5|改善未確認|
|テーマ切替・1440px/500件/first|eventTiming.processingMs|0.3|0.2|0.1|算出不可|5/5|改善未確認|
|テーマ切替・1440px/500件/first|eventTiming.duration|80.0|80.0|0.0|0.0%|5/5|改善未確認|
|テーマ切替・1440px/500件/repeat|eventTiming.inputDelayMs|0.9|1.0|-0.1|算出不可|5/5|改善未確認|
|テーマ切替・1440px/500件/repeat|eventTiming.duration|64.0|68.0|-4.0|-6.3%|5/5|改善未確認|
|settings・[1440,900,50,"cold","settings"]|content|7.7|15.4|-7.7|-100.0%|5/5|改善未確認|
|board・[1440,900,500,"cold","board"]|content|180.6|180.9|-0.3|-0.2%|5/5|改善未確認|
|settings・[1440,900,500,"cold","settings"]|content|17.6|17.8|-0.2|-1.1%|5/5|改善未確認|
|help・[1440,900,500,"cold","help"]|content|20.2|20.0|0.2|1.0%|5/5|改善未確認|
|editor・[1440,900,500,"cold","editor"]|content|22.7|22.9|-0.2|-0.9%|5/5|改善未確認|
|calendar・[1440,900,500,"cold","calendar"]|content|6.7|6.3|0.4|6.0%|5/5|改善未確認|
|search・[1440,900,500,"cold","search"]|content|49.2|50.3|-1.1|-2.2%|5/5|改善未確認|
|search-clear・[1440,900,500,"cold","search-clear"]|content|132.4|128.6|3.8|2.9%|5/5|改善未確認|
|confirmation・[1440,900,500,"cold","confirmation"]|content|20.0|19.8|0.2|1.0%|5/5|改善未確認|
|reset-confirm・[1440,900,500,"cold","reset-confirm"]|content|2.0|4.3|-2.3|-115.0%|5/5|改善未確認|
|board・[1440,900,500,"warm","board"]|content|165.4|162.0|3.4|2.1%|5/5|改善未確認|
|board・[1440,900,500,"warm","board"]|interactive|165.4|162.0|3.4|2.1%|5/5|改善未確認|
|チェック項目復元・1440px/500件|handler|2.3|2.3|0.0|0.0%|5/5|改善未確認|
|チェック項目復元・1440px/500件|frameReady|33.8|34.1|-0.3|-0.9%|5/5|改善未確認|
|チェック項目復元・1440px/500件|savedMs|189.0|188.9|0.1|0.1%|5/5|改善未確認|
|付箋削除の復元・1440px/500件|handler|9.2|9.4|-0.2|-2.2%|5/5|改善未確認|
|付箋削除の復元・1440px/500件|frameReady|33.5|33.6|-0.1|-0.3%|5/5|改善未確認|
|付箋削除の復元・1440px/500件|savedMs|186.0|185.4|0.6|0.3%|5/5|改善未確認|
|列削除の復元・1440px/500件|handler|10.2|10.2|0.0|0.0%|5/5|改善未確認|
|列削除の復元・1440px/500件|frameReady|34.6|33.9|0.7|2.0%|5/5|改善未確認|
|列削除の復元・1440px/500件|savedMs|188.7|189.2|-0.5|-0.3%|5/5|改善未確認|

主要内容と操作可能は独立条件で観測し、終了フレームが同じ条件は同値。テーマrepeatは各試行4回の中央値を作り、その5試行中央値を比較（前後20イベント）。初回は5イベント。EventTimingは全100イベントを取得したがdurationは8ms量子化、閾値16ms、実利用INPではない。[PerformanceEventTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming)。handlerは同期CPU時間で、物理クリックからの初期反応ではない。Paintは同renderer・mark後の最初のPaintで、正しい結果全体のPaintとは限らない。

短縮率=(前−後)÷前×100。前1ms未満・欠測・非該当は算出不可で0にしない。各条件の中央値／最小／最大、全ての負の値、別採取の本番と一時比較環境の区別は[全816指標](RESULTS.md)、[CSV](results.csv)、[定義と生集計](results.json)。記述的max(1ms,10%)の目安は統計的有意差ではない。この段階は離脱購読のみの変更なので、一覧内の時間差を今回の性能効果とは判定しない。

50件・初回設定の7.7→15.4ms（−100%）などの負の値を保持した。追加の同じ一時URLで交互5試行を[screens-paired.json](screens-paired.json)に記録し、結果を[追加比較](screens-paired-results.json)に残す。本番率をこの一時比較に置き換えない。追加結果は[1440,900,50,"cold","settings"]: 8.8→11.8ms（前4.6〜13.7／後9.6〜13.1、5/5）、[1440,900,50,"cold","calendar"]: 6.0→7.6ms（前5.6〜11.3／後6.0〜10.3、5/5）、[1440,900,500,"cold","reset-confirm"]: 2.5→2.5ms（前2.4〜4.6／後2.2〜5.0、5/5）。表示待ちの位相差を含み、実装による悪化との因果は確認できない。元の負の本番値も保持する。

部分更新前e26dcdから最終配布版301436までの同一パスの本番比較も別に示す。前後の採取時期は異なり、交互比較の短縮率をここへ転記していない。同期CPUの構造的な削減はRound5の交互比較で別に確認した。試行幅と元ファイル・日時は[collection-production-results.json](collection-production-results.json)。

|操作・1440px／500件|指標|本番e26dcd前ms|本番301436後ms|差ms|短縮率|前／後|
|---|---|---:|---:|---:|---:|---|
|付箋削除の復元|handler|196.0|9.4|186.6|95.2%|5/5|
|付箋削除の復元|frameReady|235.4|33.6|201.8|85.7%|5/5|
|付箋削除の復元|savedMs|293.8|185.4|108.4|36.9%|5/5|
|列削除の復元|handler|194.4|10.2|184.2|94.8%|5/5|
|列削除の復元|frameReady|240.0|33.9|206.1|85.9%|5/5|
|列削除の復元|savedMs|270.8|189.2|81.6|30.1%|5/5|
|チェック項目復元|handler|224.7|2.3|222.4|99.0%|5/5|
|チェック項目復元|frameReady|285.3|34.1|251.2|88.0%|5/5|
|チェック項目復元|savedMs|304.9|188.9|116.0|38.0%|5/5|

保存の本番値も短くなっているが、Round5の交互比較では付箋185.5→184.9ms、列186.1→189.8msで保存改善を確認できなかった。本番の差だけから保存方式が高速化したとは断定しない。

## ④ 連続操作の追従性・滑らかさ

最終版のネイティブドラッグは50／500件、付箋／列、空検索／一致検索の8条件×前後5試行。grab状態・確定結果＋2rAF・保存と再読込を分けて取得した。同じ一時URLの交互比較は[drag-results.json](drag-results.json)。本番の実ドラッグは[全件](production-drag-all.json)／[検索中](production-drag-filtered.json)各20行で、最終版のみのため本番の短縮率は算出しない。

|操作・区間|条件|指標・単位|前→後|試行・観測|評価・限界|
|---|---|---|---|---|---|
|ドラッグ連続入力|少件数／500件分散／500件密集、付箋・列|rAF間隔中央値／P95／最大ms|drag-results.jsonの全6条件|5／5、各95間隔・800入力|20rAF窓×8合成イベント。95間隔は独立試行ではなく相関した観測。描画FPSではない|
|移動の確定|50／500、付箋／列、検索あり／なし|同期CPU／正しい結果＋2rAF／保存ms|drag-results.jsonの48比較|5／5|pointerdownから状態変化は操作自動化の転送と移動閾値も含む|
|スクロール・リサイズ|375／1440、50／500|正しいoffset／寸法＋2rAFms|production-continuous.json|各5|実wheel・viewport操作。連続実機入力や物理提示ではない|
|戻る・進む・保存|375／1440、50／500|正確な保存値と更新反映|history.json|20コンテキスト・100反復|制御側の戻り時間はpolling込み。進むは正当性のみ|

|本番連続操作・1440px／500件|指標|前中央値ms|後中央値ms|後の最小〜最大ms|試行|評価|
|---|---|---:|---:|---|---|---|
|wheel-y|resultProxy|75.4|76.3|75.1〜78.5|5/5|改善未確認|
|wheel-x|resultProxy|79.1|79.0|77.8〜79.2|5/5|改善未確認|
|resize|resultProxy|27.5|28.1|27.1〜29.4|5/5|改善未確認|
|history-back|controllerElapsed|162.0|161.0|156.0〜192.0|5/5|改善未確認|

全条件は[continuous-results.json](continuous-results.json)。スクロール1操作の完了時刻を連続操作のFPSと混同しない。


|最終段のドラッグ比較|前|後|差・評価|試行／観測|
|---|---:|---:|---|---|
|検索中500件付箋・確定CPU ms|22.2|22.1|0.1ms、追加改善未確認|5/5|
|同・正しい結果＋2rAF ms|33.5|33.9|−0.4ms、追加改善未確認|5/5|
|同・保存完了 ms|185.1|185.2|−0.1ms、追加改善未確認|5/5|
|同・down→ドラッグ状態 ms|20.0|23.7|−3.7ms、操作転送・移動閾値込み|5/5|
|密集500件付箋・rAF間隔中央値 ms|16.7|16.7|0.0ms、追加改善未確認|5/5・各95間隔|
|同・P95／最大 ms|16.8／16.8|16.8／16.8|追加改善未確認|同上|
|同・25ms以上／50ms以上の間隔数|0／0|0／0|停止の追加削減は未確認|同上・各800入力|

25／50ms以上のrAF間隔数、P95、最大も同じ定義で保存し、割合の差を時間短縮率に流用しない。16.7ms境界付近の浮動小数の超過を「落ちたフレーム」と呼ばない。最終位置・移動先・順序・上限・マーカー解除・保存再読込を検証。追加段階で滑らかさの改善は確認していない。従来の大きなドラッグ改善は[元の記録](../drag/REPORT.md)の版に限定する。

## ⑤ 検証の根拠と残る課題

[regression.json](regression.json)でChromium156.0.8078.4／Firefox157.0／WebKit27.2各102比較点が一致、errorsなし。題名・本文・タグ・チェック・日付・検索・件数・順序・フォーカス・入力選択・スクロール・複製上限・削除／復元・空下書き・モーダルを確認。保存11項目、ジェスチャー11項目、ドラッグ状態72点と探索7,200比較は各証拠JSONに保存。仮想時計の日付またぎ10条件、履歴100反復も通過した。

[unload-regression.json](unload-regression.json)は前後×3エンジン×5独立コンテキストの270観測。保存済みでは新版のbeforeunloadが0、変換開始で1・キャンセルで0、isComposingだけのタグ入力も対応。保存失敗時のネイティブ離脱警告を閉じると編集が残り、再試行保存後は0。別タブの変更を戻った後に取得することも確認。標準Playwright Chromiumはキャッシュを無効化する起動引数を含むため、標準試験でpersisted=falseだったことを本番不適格の証拠にしない。追加でその引数を解除した[cache-enabled.json](cache-enabled.json)も別記録にする。キャッシュ無効化引数を解除した追加試験でも、3エンジン×前後5試行の30履歴復帰でpersisted=trueは0だった。原因は特定しておらず、キャッシュ性能／実際のキャッシュ復帰経路は未検証。制御側時間の差をキャッシュ高速化とは報告しない。

[checks.json](checks.json)に全管理形式の検査結果。[inventory.json](inventory.json)にソース・設定・凍結入力・証拠の分類とSHA、[release-status.json](release-status.json)に本番パスと各証拠ハッシュ、段階ログ、バージョンを保存。各生JSONのdateはUTC。トレースgzipは同ディレクトリ。過去の計測値・採用しなかった実験は削除せず、除外理由はmeasurement-exclusions.json。最終ドラッグの初回実行は19コンテキストの後に子プロセスexit1で停止し、原因はログ不足で未確定。入力・数値はincomplete-dragに保持して最終集計から除外。全ログ付きの再実行と同条件プローブは成功したが、最初の停止を解決済みとは断定しない。

再現はNode24.21以上とPython3.15.0（または互換3.14.8）、npm ci、python -m pip install -r requirements-dev.txt、npx playwright install chromium firefox webkitを準備し、npm run ciで通常のverificationへ出力する。最終段の比較はBASELINE_SOURCE=performance/round6/before.html EVIDENCE_DIR=performance/round6 BROWSERS=chromium,firefox,webkit node scripts/regression.mjs。計測はEVIDENCE_DIRを新しい保存先にしてbefore.htmlを凍結し、CHROME_PATH付きrelease-measurements.mjs／drag-release.mjsを順番に実行する。並行負荷をかけず、実データのブラウザープロファイルは使わない。freshコンテキスト初回と同コンテキストreloadを分ける。ユーザー／権限の分岐は存在しない。

残る課題は以下。依頼全体の完了条件をすべて満たしたとは報告しない。

- 最低対応ブラウザー・WebView未確定。実機Safari／タッチ／OS日本語IME／スクリーンリーダー、実利用INP、物理画面追従と長時間メモリ増加は未検証。既存対応を縮小する新APIは導入していない。
- 操作一覧の合成イベントのみ／時間未計測の項目を保持。貼り付け・OS変換・実タッチ・ヘルプ本文の実スクロールなどの待ち時間や引っかかりを、今回のrAF値で完了扱いしない。
- 375px WebKitの長いボード題名の重なりは比較元にも存在し、今回の未修正の表示課題。基準の表示維持を確認したことと表示品質の解決を分ける。
- 過去1回の履歴戻り後の保存表示タイムアウトは原因未確定。今回100反復や前段の再試験で再現せず、解決したとは断定しない。
- 少件数の設定・カレンダーには本番と追加交互比較で負の値が残る（設定8.8→11.8ms、カレンダー6.0→7.6ms）。試行幅は重なるが、原因は未特定で改善済みとはしない。追加のネイティブ入力／Paintやさらに多い交互試行で切り分ける必要がある。
- 最終版でも初回全件描画・検索解除などは全体の処理が必要で、500件では約130〜180msの代理値が残る。仮想化はアクセシビリティ・全件／サイズ／検索の契約、Workerは保存順序・小件数の転送費用、保存待機短縮は書込み頻度と競合への検証が必要。追加効果は未計測で、これ以上改善しないとの証明にはしない。
- 開発依存のbraces由来high5件は公式修正版待ち。[公式アドバイザリー](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)と[監査](../modernization/dependency-audit.json)。アプリへは配信しない。古いStylelintへのダウングレードで隠さない。
- CIを作成・更新しローカルの同じ検査は通したが、GitHub実行、Linux3.15代替ビルド、利用者端末への配布は未確認。

復旧は同じ配布ファイルパスを保ってround6/before.html（59bdc4）で離脱変更のみ、round5/before.html（e26dcd）で部分更新も、round4/before.html（f9f6ae）でテーマ変更も戻す。復旧前にJSONバックアップを取得し、同じ保存オリジンで再読込・件数／順序／保存／別タブ更新を確認する。重大なデータ不整合・警告欠落・再現する性能悪化が復旧判断。Gitの既存変更をresetして復旧しない。

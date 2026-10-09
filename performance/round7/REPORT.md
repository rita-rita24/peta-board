# 全操作・現代化の追加調査（2026-10-10 JST）

## ① 実施結果

現行のローカル配布HTMLは[peta-board.html](../../peta-board.html)、SHA-256は 30143609a812f288974b3a84a93d1a07b544af5990c9f9fb3ca8696bee330bd2。前回の検証済みファイルと同じバイト列を維持した。今回追加した2本の計測コードを実行し、遅い値の原因を切り分け、検索の部分更新案を実装・比較した。性能上の利点を確認できない案を本番へ採用しなかった。元の本番更新と全816指標は[前回の総合記録](../round6/REPORT.md)。今回の補足値はその値を置換しない。

対象はHTML1、CSS3／JS1ブロック・213関数、CJS73、MJS23（今回2本を含む）、Python7、YAML／埋め込みBash、JSON／TOML設定。凍結HTML42本は実験入力、外部ライブラリーとビルド物は別分類。6画面系統・52操作群の[対応一覧](../round6/operations.json)を維持。全ファイル・ハッシュは[inventory.json](inventory.json)。TypeScript、バックエンド、SQL、DB移行は存在しない。

新しい計測は設定・カレンダー160観測、検索案200観測、本番配布パス80観測。各条件5独立コンテキスト。検索と位相は同一コンテキスト内の順次操作で、全イベントを独立試行として扱わない。配布パス・版・実行時刻は[release-status.json](release-status.json)、各JSONのdateはUTC（JSTは+9）。本番はfile URLで、利用者のブラウザー保存領域を使わない隔離した合成50件を投入した。

同期処理の一貫した悪化は今回の位相別比較で確認できなかった。ただし前回の設定8.8→11.8ms、カレンダー6.0→7.6msなどの負の値は保持し、その正確な原因を全て解決したとはしない。rAF開始位置と初回／暖機の違いが測定値へ影響することを確認した。

現代化の決定済み置換対象は残件0、互換性例外10、Ruffターゲット設定1、空下書き破棄の挙動維持経路1を引き続き残す。最低対応環境、実機IME／タッチ／Safari、実利用INP、リモートCI等が未確認のため、依頼全体の完了とは報告しない。

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

Node24.21.0 LTS、ESLint10.12.0、html-validate11.16.2、Playwright1.64.0、Prettier3.9.9、Stylelint17.16.0、Ruff0.16.10を固定した。NodeのCurrent系列よりLTSの保守期間を選択。アプリ実行時依存0。[Python3.15.0公式](https://www.python.org/downloads/release/python-3150/)ソースのSHAを照合してmacOSでビルドし、通常GIL・JITオフで実行。3.14.8互換確認も保持。[実ランタイム設定とビルド記録](../round5/python-runtime.json)。[ビルド設定](https://docs.python.org/3.15/using/configure.html)。公式Actions manifestには取得時点で3.15安定版が未掲載だったため、CIにソース取得の代替経路と実際のバージョンassertを追加した。[取得根拠](../round6/python-ci-availability.json)。リモートCI／Linuxビルドは未実行。

再混入防止は全管理MJS／CJSと抽出アプリJSのESLint、禁止API＋which AST規則、HTML構造、CSS3ブロック、Python7本のRuff／整形／構文と6ランナー出力比較、CI埋め込みBashのbash -n。除外はnode_modulesと公式CPython等の外部コード、凍結した比較HTMLだけで、管理ソースを一括除外しない。[開発規約](../../README.md)。UTF-8／CSV改行／with解放／UTC／共通fixtureとruntimeを適用し、不要宣言・VM文字列依存・タイマー積み上げを除去。保存キーpetaborad.state.v1、形式version1、160ms待機、Web Locks／IndexedDBの更新順序、500枚／12列／32MiB上限は維持。


今回の新規MJS2本は既存のECMAScript2026・Promise返値禁止・解放規約を適用した。追加時に検出したPromise executor返値3箇所をブロック形式へ修正し、静的検査が通過。[初回指摘](checks-initial.json)も保持。これは新しい管理コードの修正で、アプリに3箇所の非推奨APIがあったという意味ではない。採用しなかった候補もJS抽出・構文・ESLint・HTMLを検査し、CSS3ブロックが本番と完全一致することを確認した。

検索の部分更新案は既存の[replaceChildren](https://developer.mozilla.org/en-US/docs/Web/API/Element/replaceChildren)とMapだけを使用し、対応環境を縮小するAPIを追加しなかった。2026-10-10に資料を再確認。案は列の構造を残しカードと件数を更新する責務分離だったが、効果がないため不採用。凍結候補はcandidate-columns.html、生データはsearch-final.jsonで再現できる。

## ③ 本番での画面・操作別の時間計測

今回の本番追加計測はChrome154.0.8037.99、macOS26.2 arm64、50件、375／1440×900、初回と反復を分離した。前回の画面値はopacityやgetComputedStyleを含むrAF内観測で、今回の同期操作可能／次のrAFとは終了条件が違うため直接比較せず、前値は未計測とする。

|本番・1440px／50件|初回／反復・遅延指定|指標|前ms|後中央値ms|後の最小〜最大ms|短縮率|試行|
|---|---|---|---|---:|---|---|---|
|settings|first・0ms|synchronousReadyMs|未計測|3.5|3.3〜3.7|算出不可|0/5|
|settings|first・0ms|nextFrameProxyMs|未計測|16.8|16.4〜17.1|算出不可|0/5|
|settings|repeat・4ms|synchronousReadyMs|未計測|2.9|2.6〜3.0|算出不可|0/5|
|settings|repeat・4ms|nextFrameProxyMs|未計測|11.2|10.3〜13.1|算出不可|0/5|
|settings|repeat・8ms|synchronousReadyMs|未計測|3.0|2.7〜3.5|算出不可|0/5|
|settings|repeat・8ms|nextFrameProxyMs|未計測|7.0|6.2〜7.5|算出不可|0/5|
|settings|repeat・12ms|synchronousReadyMs|未計測|3.1|3.0〜4.0|算出不可|0/5|
|settings|repeat・12ms|nextFrameProxyMs|未計測|3.3|3.0〜4.5|算出不可|0/5|
|calendar|first・0ms|synchronousReadyMs|未計測|4.5|4.3〜5.2|算出不可|0/5|
|calendar|first・0ms|nextFrameProxyMs|未計測|16.4|15.3〜17.3|算出不可|0/5|
|calendar|repeat・4ms|synchronousReadyMs|未計測|3.3|3.1〜3.8|算出不可|0/5|
|calendar|repeat・4ms|nextFrameProxyMs|未計測|11.3|11.0〜13.2|算出不可|0/5|
|calendar|repeat・8ms|synchronousReadyMs|未計測|3.6|3.3〜3.8|算出不可|0/5|
|calendar|repeat・8ms|nextFrameProxyMs|未計測|6.8|5.7〜9.8|算出不可|0/5|
|calendar|repeat・12ms|synchronousReadyMs|未計測|4.4|4.1〜4.6|算出不可|0/5|
|calendar|repeat・12ms|nextFrameProxyMs|未計測|4.4|4.1〜4.6|算出不可|0/5|

synchronousReadyMsはhidden／inert／is-openをクリック後に同期確認した時刻。物理提示や内容全体のPaintを保証しない。nextFrameProxyMsは次のrAFまでで、表示完了ではない。[requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)の説明に従って区別する。delay0は最初の開く操作、delay4／8／12は反復を固定順で行った。位相だけでなく暖機・順序も変わるため、純粋な因果実験とはしない。初期反応・Paint・保存をこの値で代用しない。変更しない操作なので保存時間はこのプローブでは対象外。

全104補足比較・64本番値・試行幅は[results.json](results.json)、前後の負値を含む[CSV](results.csv)。本番の短縮率を一時URLの率で代用しない。以前の本番で確認した付箋復元235.4→33.6ms、列復元240.0→33.9ms（500件、5/5、結果＋2rAF）は[前回証拠](../round6/collection-production-results.json)のまま保持。新しい計測値として再掲載しない。

以下は一時URLの交互比較で、本番値ではない。新しい検索語ではカードの強調・抜粋を更新する必要があり、列を残すだけでは待ち時間を減らせなかった。候補は入力中に既存リストのスクロール位置も更新するため同期処理が増えたが、その内訳をトレースで全て特定したとはしていない。

|不採用案・1440px／500件|指標|配布版ms|候補ms|差ms|率|試行|
|---|---|---:|---:|---:|---:|---|
|検索付箋1|handler|8.7|144.4|-135.7|-1559.8%|5/5|
|検索付箋1|resultProxy|152.7|166.6|-13.9|-9.1%|5/5|
|検索解除|handler|6.3|105.7|-99.4|-1577.8%|5/5|
|検索解除|resultProxy|133.4|133.1|0.3|0.2%|5/5|
|検索検証|handler|14.2|85.6|-71.4|-502.8%|5/5|
|検索検証|resultProxy|116.3|117.2|-0.9|-0.8%|5/5|

全文・件数・順序・ボード状態・全ボードHTML・フォーカス・カーソル選択・全リスト／シェルのスクロールは100前後比較が一致。保存済み状態を再読込すると全件が復帰した。それでも性能要件を満たさず不採用で、配布ファイルを変更していない。初期起動／検索解除等の残る大きい待ち時間は未解消。

## ④ 連続操作の追従性・滑らかさ

今回の調査で新しいドラッグ・スクロール・保存実装は採用していない。同一SHAの[前回連続操作](../round6/continuous-results.json)・[ドラッグ](../round6/drag-results.json)を根拠として維持し、再実行したと表現しない。

|操作・条件|指標|変更前→配布版|試行／観測|判定・限界|
|---|---|---|---|---|
|密集500件付箋|rAF間隔中央値ms|16.7→16.7|5/5・各95間隔、800入力|追加改善未確認。実際の描画FPSではない|
|同条件|P95／最大ms|16.8／16.8→16.8／16.8|同上|相関した試行内観測|
|検索中500件付箋の確定|結果＋2rAF ms|33.5→33.9|5/5|改善未確認、正しい移動先・順序・保存を確認|

今回の候補による検索同期CPU増加は連続入力の妨げになるため採用しない。rAF位相差を滑らかさの改善率へ変換しない。物理入力から画面提示への追従や長時間の引っかかりは未検証。

## ⑤ 検証の根拠と残る課題

[checks.json](checks.json)で全管理JS・候補JS、HTML・候補HTML、CSS3、整形、Python3.15構文、CIのBash構文、git diffを再検査。Python7本のRuff・整形・過去6集計出力、Chromium／Firefox／WebKit各102比較点、保存11・ジェスチャー11・ドラッグ状態72／探索7,200・履歴100反復等は、変更していない同一SHAに対する[前回証拠](../round6/release-status.json)。今回これらを再実行したという主張ではない。リモートCIは未実行。

再現: npm ciで固定依存を準備し、Node24.21以上でEVIDENCE_DIR=performance/round7 CHROME_PATHを指定してscripts/modal-phase.mjsを実行。PRODUCTION_ONLY=1と別OUTPUTで本番のみを記録。検索案はAFTER_SOURCE=performance/round7/candidate-columns.htmlを指定してscripts/search-render.mjsを実行。元の結果を上書きしない場合は別のOUTPUTを使う。初回の計測用#boardセレクター誤りで終了した実行は結果に含めず、#kanban-boardへ修正して通過した。アプリの不具合とは扱わない。

- 本番の負値は消さない。フレーム位相の寄与を確認したが、前回の差の全原因を特定したわけではない。実入力・renderer Paintとランダム化した位相順でさらに切り分けられる。
- 初回全件描画・検索解除の残る待ち時間は未解消。今回のDOM保持案は不採用。カード自体の安全な再利用／描画計算の削減は、検索強調、状態更新、期限変化、別タブ同期、アクセシビリティ、フォーカスとの一致が採用条件で、追加効果は未計測。
- 最低対応ブラウザー／WebView未確定。実機OS IME・タッチ・Safari・スクリーンリーダー、field INP、物理提示、長時間メモリ増加、操作一覧の一部時間、実際の履歴キャッシュ復帰、GitHub CI／Linuxビルド、利用者端末への配布は未確認。
- 旧1回の履歴保存表示タイムアウトと初回ドラッグ計測のexit1は原因未確定。WebKit375pxの長題名表示課題、開発依存の公式修正版待ちも[前回課題](../round6/REPORT.md)を維持。

通常の反映対象は同じパスの単一HTML。今回は配布版を変更していないので復旧操作は不要。過去の変更を戻す手順・条件は前回報告にある。既存Git変更・利用者の保存データは今回の調査で変更しない。

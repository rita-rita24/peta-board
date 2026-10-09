import csv
import hashlib
import json
import statistics
from pathlib import Path

root = Path("performance/drag")
base = json.loads((root / "commit-before-combined.json").read_text(encoding="utf-8"))
after = json.loads((root / "commit-after-combined.json").read_text(encoding="utf-8"))
old = json.loads((root / "before.json").read_text(encoding="utf-8"))
new = json.loads((root / "after.json").read_text(encoding="utf-8"))
sha = hashlib.sha256(Path("peta-board.html").read_bytes()).hexdigest()
assert sha == after["version"] == new["version"]
rows = []


def add(condition, metric, x, y, note):
    p = statistics.median(x)
    q = statistics.median(y)
    rate = (p - q) / p * 100
    rows.append(
        [
            condition,
            metric,
            f"{p:.1f}",
            f"{q:.1f}",
            f"{rate:.1f}%",
            f"{len(x)}/{len(y)}",
            f"{min(x):.1f}–{max(x):.1f} / {min(y):.1f}–{max(y):.1f}",
            note,
        ]
    )


for n in [50, 500]:
    for kind in ["note", "column"]:
        a = [r for r in base["rows"] if r["n"] == n and r["type"] == kind]
        b = [r for r in after["rows"] if r["n"] == n and r["type"] == kind]
        label = f"ボード・{'付箋を別列の先頭へ' if kind == 'note' else '先頭列を3列目の前へ'}・{n}件/{4 if n == 50 else 12}列・1440px"
        for metric, key in [
            ("主要内容の表示", "ready"),
            ("操作可能（移動確定ハンドラ完了）", "handler"),
            ("保存完了", "save"),
        ]:
            x = [r[key] for r in a]
            y = [r[key] for r in b]
            note = (
                "改善"
                if key == "handler" or (key == "ready" and n == 500)
                else "改善未確認（前後の範囲が重なる）"
            )
            add(label, metric, x, y, note)
if (root / "save-before.json").exists() and (root / "save-after.json").exists():
    sa = json.loads((root / "save-before.json").read_text(encoding="utf-8"))
    sb = json.loads((root / "save-after.json").read_text(encoding="utf-8"))
    assert sb["version"] == sha
    for kind in ["note", "column"]:
        x = [r["saveAttribute"] for r in sa["rows"] if r["type"] == kind]
        y = [r["saveAttribute"] for r in sb["rows"] if r["type"] == kind]
        add(
            f"ボード・{'付箋' if kind == 'note' else '列'}移動・500件/12列・1440px",
            "保存完了属性の変更（追加調査）",
            x,
            y,
            "改善未確認／列は観測中央値が悪化。保存処理は未変更",
        )
extra = []
for kind, count in [
    ("small", "50件/4列"),
    ("spread", "500件/12列"),
    ("dense", "500件/2列、1列に500件"),
]:
    for t in ["note", "column"]:
        a = [r for r in old["rows"] if r["kind"] == kind and r["type"] == t]
        b = [r for r in new["rows"] if r["kind"] == kind and r["type"] == t]
        fn = "previewPointerDrop" if t == "note" else "previewColumnDrop"
        label = f"ボード・{'付箋' if t == 'note' else '列'}ドラッグ・{count}・1440px"
        for metric, x, y in [
            (
                "プレビュー処理の合計CPU時間（20フレーム/160入力）",
                [r["functions"][fn]["ms"] for r in a],
                [r["functions"][fn]["ms"] for r in b],
            ),
            (
                "フレーム間隔（各試行内中央値）",
                [statistics.median(r["frames"]) for r in a],
                [statistics.median(r["frames"]) for r in b],
            ),
        ]:
            add(
                label,
                metric,
                x,
                y,
                "改善"
                if metric.startswith("プレビュー") or (kind == "dense" and t == "note")
                else "改善未確認（表示更新周期と同程度）",
            )
for label in [
    "ボード・検索中の付箋移動",
    "ボード・Alt+上下による付箋移動",
    "ボード・375pxでの縦横の自動スクロール",
    "編集画面・移動先の列を変更",
]:
    rows.append(
        [
            label,
            "主要内容の表示／操作可能",
            "未計測",
            "未計測",
            "算出不可",
            "0/0",
            "—",
            "機能確認のみ。検索中は従来の全体再描画を維持"
            if "検索" in label
            else "機能確認のみ",
        ]
    )
with (root / "results.csv").open("w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(
        [
            "画面・操作・条件",
            "指標",
            "変更前中央値ms",
            "変更後中央値ms",
            "短縮率",
            "回数前/後",
            "範囲前/後ms",
            "判定・備考",
        ]
    )
    w.writerows(rows)
header = "| 画面・操作・条件 | 指標 | 前中央値ms | 後中央値ms | 短縮率 | 回数前/後 | 最小–最大 前/後ms | 判定・備考 |\n|---|---|---:|---:|---:|---:|---|---|\n"
table = header + "\n".join("| " + " | ".join(r) + " |" for r in rows)
report = f"""# ドラッグ処理の高速化・検証記録

対象HTML `peta-board.html` に反映済み。独立したChromeで反映版の実ドラッグ・保存・再読み込み・主要操作を確認済み。ユーザー指定のローカルHTMLを対象とし、公開本番URLはありません。外部の配布先や公開サイトへの反映・検証は未実施です。

変更前SHA-256: `{base["version"]}`  
反映版SHA-256: `{sha}`  
計測日時（UTC）: 実ドラッグ {base["date"]} ～ {after["finished"]}、高頻度入力 {old["date"]} ～ {new["date"]}。日本時間はUTC+9時間。実行日2026-10-10。

## 画面別・操作別の実測結果

対象はボードの付箋移動・列移動、および同じ移動処理を使うキーボード操作・編集画面です。直接アクセスして読込と初期保存が完了した後に操作しています。50件は4列、500件は12列、偏ったデータは2列のうち1列に500件。動的URLや権限による区分はなく、利用者はローカルHTMLの同一利用者条件です。付箋移動は別列の先頭、列移動は先頭から3列目の前を代表ケースにしました。同列・末尾・空列・検索中の移動は機能比較に含みます。

短縮率＝（変更前−変更後）÷変更前×100。負の値と改善未確認の条件も記載しています。サイト全体の改善率として集約しません。高頻度入力の合計CPU時間は実操作の待ち時間とは別の指標です。

{table}

## 終了条件・条件・再現手順

- 実ドラッグの開始点は `pointerup` のcapture段階。マウスでドラッグを開始し、移動先で2フレーム待ってから離します。主要内容は、正しい状態とDOM順序を検証した2回目のrequestAnimationFrame。1回目後の描画機会を待つための定義で、画面ピクセルの物理計測ではありません。
- 操作可能は、アプリの移動確定ハンドラがすべて終了したdocument段階。正しい状態・DOM順序、app-shellがinertでないこと、編集ボタンが有効であることを検証しています。必要なイベントは常設の委譲ハンドラと保持した列ボタンに準備済みで、非同期の初期化はありません。実際の次の操作の正常動作は機能検証で確認。表示完了とは区別した値です。
- 保存完了は保存表示がsavedとなり、移動後の状態・DOMが正しい時点。さらに再読み込み後のボード全体が移動後の状態と一致することを検証。160msの既存保存デバウンスと更新反映を維持しています。
- 高頻度入力は、本物のマウス操作でpointer captureを開始した後、20フレームに各8回、計160回の合成pointermoveを注入します。Escと本物のpointerupで終了。繰り返しプレビュー計算のCPU時間、各試行のフレーム間隔中央値を測定。実機のマウス・タッチの追従性やFPSを保証する値ではありません。
- macOS、同一端末、Chrome {after["browser"]} headless、Playwright、1440×900、light theme、CPU/ネットワーク制限なし。各実ドラッグ条件10回（最初5回＋前後順序を交互にした5組）、高頻度入力各5回。表には中央値と最小–最大を記載。異なる指標の入れ子の処理時間は加算しません。
- 独立したブラウザcontextのlocalStorageに同じfixtureを投入。ユーザーの通常ブラウザ保存領域は使用しません。50件は短い本文・各3チェック項目、500件は約2,400～2,800文字本文・各30チェック項目、タグ2件と期限付き。データ・並び順・内容を間引いていません。
- 操作対象のDOMは読み込み済みで、初回アクセスと再読み込みの性能測定とは別です。単体HTMLのためHTTP/CDN/serverキャッシュはありません。OSファイルキャッシュと端末の背景負荷は制御できません。キャッシュの追加や更新遅延は導入していません。

再現（リポジトリ直下、スクリプト内のChrome/Playwrightパスはこの端末向け）:

```sh
node performance/drag/measure.cjs performance/drag/before.html performance/drag/before.json
node performance/drag/measure.cjs peta-board.html performance/drag/after.json
node performance/drag/commit.cjs performance/drag/before.html performance/drag/commit-before.json
node performance/drag/commit.cjs peta-board.html performance/drag/commit-after.json
node performance/drag/repeat-commit.cjs
node performance/drag/regression.cjs
node performance/drag/gestures.cjs
python3 performance/drag/report.py
```

追加調査では保存表示のdata-state属性をMutationObserverで直接観測し、フレーム待ちを除いた保存完了通知も各5回測定（`save-before.json` / `save-after.json`、`save-observe.cjs`）。保存完了の悪化をフレーム待ちだけでは説明できません。既存と同じ160ms後のWeb Locks・IndexedDBリビジョン予約・全状態のlocalStorage保存で、書き込み待機・端末負荷の影響が残ります。保存方式の見直しはデータ保護と他タブの更新に影響するため今回未実施です。

生データは `before.json` / `after.json`、`commit-*-combined.json`（10回）と各 `commit-*-pair*.json`、集計は `results.csv`。初期の探索計測 `commit-after-initial.json` は終了条件の補足前の記録で、表には使いません。

## 原因・変更・検証

確認した原因: pointermoveごとに全件のgetBoundingClientRectを読み、同じ場所のマーカーを再挿入し、移動先の強調クラスを外して再設定していました。さらにRAFでも同じプレビューを繰り返し、移動確定時に全付箋と全列を再生成していました。密集列では20フレームで約89,860回の位置読み取りでした。

1. 独立した位置更新を1フレームに1回へまとめ、最新座標を使用。pointerupでは必ず最終座標を同期で確認します。自動スクロールの速度・閾値・capture・キャンセル処理を維持。
2. Gridの付箋／flexの列がDOM順に並ぶことを確認し、現在の矩形を二分探索。座標をキャッシュしないため、スクロール・サイズ変更・マーカーによる配置変化に追従。密集列の位置読み取りは220回まで減少。マーカー位置と強調先が変わらない場合はDOMを書き換えません。
3. 通常の付箋移動は対象カードのみ移設し、移動元・移動先の件数、空列、本文のレイアウト適用条件を更新。列移動は既存列を移設し、左右移動ボタンの無効条件を更新。DOM不整合と検索中の付箋移動は従来の全体再描画へ戻る設計。履歴・保存方式・権限・検索ロジックは変更なし。キーボードと編集画面の移動にも同じ更新処理を使用。

優先順位は、入力頻度に比例する計算とDOM更新の削減→移動後の全体再生成の削減。どちらも移動処理に範囲を限定でき、HTML差し戻しで復旧できます。幾何キャッシュ・状態キャッシュは更新やスクロールの無効化負担があるため見送り、実測で大きな効果を確認した現在の構成を採用しました。

検証: `regression.json` は375px/1440px、50件/500件/密集/2件の72スナップショットで状態・全文・列件数・空状態・順序・寸法・移動ボタン境界が変更前後一致。二分探索と従来の全件探索をスクロール・マーカー・中点境界で7,200回照合。`gestures.json` はEscape、画面外、pointercancel、pointermoveなしの付箋/列移動、縦横の端スクロール、編集画面の移動先変更、capture喪失、合成touchのハンドル制限。`verification-file.json` は11項目の保存・編集・検索・キーボード移動/フォーカス・期限・別タブ同期・確認キャンセル・バックアップ・空ボード・破損データ復旧・Web Locks非対応時の警告。JavaScript構文検査、差分空白検査も通過。ブラウザpageerrorなし。

## 残る課題と復旧

検索中の付箋移動は列名に依存する検索結果・抜粋を維持するため全体再描画を継続し、性能は未計測。編集画面の列変更は実測時間未計測。保存のデバウンスと全状態のシリアライズ・書き込みが残り、保存時間は未改善で、10回のフレーム観測中央値では500件の付箋移動で6.1％、列移動で3.4％増加しました。追加の属性観測でも列は約10msの増加があり、ばらつきだけと断定せず残る課題とします。現行の即時表示と保存の新しさを維持するため保存周期を伸ばす改善は見送りました。少数データの表示は描画周期に支配され、処理CPU削減に比例して短縮しません。端末の背景負荷・GCによるばらつきは残ります。実機タッチ・Safari・Firefox・公開URLでの検証・実利用のp95は未実施です。

重大な順序不整合・表示欠落・保存不一致・再現する性能悪化が出た場合は、`performance/drag/before.html` を `peta-board.html` に戻して再度開き、主要操作と保存を確認します。保存データ形式は変更していません。差し戻し前に現在のHTMLを別名で保管してください。
"""
(root / "REPORT.md").write_text(report, encoding="utf-8")
print("version", sha)
for r in rows[:12]:
    print(" | ".join(r))

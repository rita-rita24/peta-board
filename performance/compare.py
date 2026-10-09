import csv
import json
import pathlib
import statistics

root = pathlib.Path(__file__).parent
before = json.loads((root / "before-file.json").read_text(encoding="utf-8"))
after = json.loads((root / "after-file.json").read_text(encoding="utf-8"))
modal_screens = {"settings", "help", "editor", "calendar", "reset-confirm"}
for data, name in [(before, "before-modals.json"), (after, "after-modals.json")]:
    supplemental = root / name
    if supplemental.exists() and not data.get("modalDefinition"):
        corrected = json.loads(supplemental.read_text(encoding="utf-8"))
        data["rows"] = [r for r in data["rows"] if r["screen"] not in modal_screens] + [
            r for r in corrected["rows"] if r["screen"] in modal_screens
        ]
search_path = root / "search.json"
if search_path.exists():
    focused = json.loads(search_path.read_text(encoding="utf-8"))
    for data, source in [
        (before, "performance/before.html"),
        (after, "peta-board.html"),
    ]:
        if focused["versions"][source] != data["version"]:
            raise ValueError("search source version mismatch")
        data["rows"] = [
            r for r in data["rows"] if r["screen"] not in {"search", "search-clear"}
        ] + [r for r in focused["rows"] if r["source"] == source]
empty_path = root / "empty-editor.json"
if empty_path.exists():
    extra = json.loads(empty_path.read_text(encoding="utf-8"))
    for data, source in [
        (before, "performance/before.html"),
        (after, "peta-board.html"),
    ]:
        if extra["versions"][source] != data["version"]:
            raise ValueError("empty editor source version mismatch")
        data["rows"] += [r for r in extra["rows"] if r["source"] == source]
labels = {
    "board": "ボード直接表示",
    "search": "検索結果",
    "search-clear": "検索解除",
    "editor": "付箋編集",
    "calendar": "期限カレンダー",
    "settings": "設定",
    "help": "ヘルプ",
    "reset-confirm": "初期化確認",
}
metric_names = {
    "content": "主要内容の表示",
    "interactive": "操作可能",
    "result": "正しい結果の取得",
}
rows = []
for screen, label in labels.items():
    for width in [1440, 375]:
        for count in [0, 50, 500]:
            for cache in ["cold", "warm"]:
                for metric, mlabel in metric_names.items():

                    def values(data):
                        return [
                            r[metric]
                            for r in data["rows"]
                            if r["screen"] == screen
                            and r["viewport"]["width"] == width
                            and r["count"] == count
                            and r["cache"] == cache
                            and metric in r
                        ]

                    b, a = values(before), values(after)
                    if not b and not a:
                        if (
                            metric != "result"
                            and screen in {"editor", "calendar"}
                            and count == 0
                        ):
                            rows.append(
                                [
                                    label,
                                    "peta-board.html（直接起動）",
                                    f"{width}×{900 if width == 1440 else 812}・0件・"
                                    + ("初回" if cache == "cold" else "再読み込み")
                                    + (
                                        "・追加した下書き"
                                        if count == 0
                                        and screen in {"editor", "calendar"}
                                        else ""
                                    )
                                    + ("・設定を閉じた後" if screen == "help" else ""),
                                    mlabel,
                                    "未計測",
                                    "未計測",
                                    "算出不可",
                                    "0/0",
                                    "既存付箋がないため対象操作なし。追加後の時間は未計測",
                                    "—",
                                    "—",
                                ]
                            )
                        continue
                    bm, am = statistics.median(b), statistics.median(a)
                    rate = (bm - am) / bm * 100
                    # Timing and vsync noise: make no improvement claim for overlapping observed ranges.
                    verdict = (
                        "改善"
                        if max(a) < min(b) and rate >= 5 and bm - am >= 5
                        else "悪化"
                        if min(a) > max(b) and rate <= -5 and am - bm >= 5
                        else "改善未確認"
                    )
                    rows.append(
                        [
                            label,
                            "peta-board.html（直接起動）",
                            f"{width}×{900 if width == 1440 else 812}・{count}件・"
                            + ("初回" if cache == "cold" else "再読み込み")
                            + (
                                "・追加した下書き"
                                if count == 0 and screen in {"editor", "calendar"}
                                else ""
                            )
                            + ("・設定を閉じた後" if screen == "help" else ""),
                            mlabel,
                            f"{bm:.1f}",
                            f"{am:.1f}",
                            f"{rate:.1f}%",
                            f"{len(b)}/{len(a)}",
                            verdict,
                            f"{min(b):.1f}–{max(b):.1f}",
                            f"{min(a):.1f}–{max(a):.1f}",
                        ]
                    )
for filename, mapping in [
    (
        "io.json",
        {
            "import-confirm": "JSON復元・読込後の確認",
            "import-result": "JSON復元・確定後の結果",
            "backup": "JSONバックアップ",
            "tab-sync": "別タブ更新",
        },
    ),
    (
        "errors.json",
        {
            "zero-columns": "0列のボード",
            "corrupt": "破損データの復旧",
            "no-locks": "保存停止（Web Locks非対応）",
            "read-failure": "保存データ読込失敗",
        },
    ),
]:
    path = root / filename
    if not path.exists():
        continue
    extra = json.loads(path.read_text(encoding="utf-8"))
    group = "screen" if filename == "io.json" else "kind"
    counts = [50, 500] if group == "screen" else [None]
    for screen, label in mapping.items():
        for count in counts:
            for metric, mlabel in metric_names.items():

                def values(source):
                    return [
                        r[metric]
                        for r in extra["rows"]
                        if r["source"] == source
                        and r[group] == screen
                        and (count is None or r["count"] == count)
                        and metric in r
                    ]

                b, a = values("performance/before.html"), values("peta-board.html")
                if not b and not a:
                    continue
                bm, am = statistics.median(b), statistics.median(a)
                rate = (bm - am) / bm * 100
                verdict = (
                    "改善"
                    if max(a) < min(b) and rate >= 5 and bm - am >= 5
                    else "悪化"
                    if min(a) > max(b) and rate <= -5 and am - bm >= 5
                    else "改善未確認"
                )
                condition = (
                    f"1440×900・{count}件・初回"
                    if count is not None
                    else "1440×900・初回・異常系／0列"
                )
                if screen == "backup":
                    verdict = "改善未確認（ブラウザー外のダウンロード完了待ちを含む）"
                rows.append(
                    [
                        label,
                        "peta-board.html（直接起動）",
                        condition,
                        mlabel,
                        f"{bm:.1f}",
                        f"{am:.1f}",
                        f"{rate:.1f}%",
                        f"{len(b)}/{len(a)}",
                        verdict,
                        f"{min(b):.1f}–{max(b):.1f}",
                        f"{min(a):.1f}–{max(a):.1f}",
                    ]
                )
stable_path = root / "stable.json"
if stable_path.exists():
    extra = json.loads(stable_path.read_text(encoding="utf-8"))
    for screen, label in [
        ("help-steady", "ヘルプ・単独表示"),
        ("board-steady-warm", "ボード・静定後の再読み込み"),
    ]:
        for width in [1440, 375]:
            for count in [0, 50, 500] if screen == "help-steady" else [500]:
                for metric, mlabel in metric_names.items():

                    def values(source):
                        return [
                            r[metric]
                            for r in extra["rows"]
                            if r["source"] == source
                            and r["screen"] == screen
                            and r["width"] == width
                            and r["count"] == count
                            and metric in r
                        ]

                    b, a = values("performance/before.html"), values("peta-board.html")
                    if not b:
                        continue
                    bm, am = statistics.median(b), statistics.median(a)
                    rate = (bm - am) / bm * 100
                    verdict = (
                        "改善"
                        if max(a) < min(b) and rate >= 5 and bm - am >= 5
                        else "悪化"
                        if min(a) > max(b) and rate <= -5 and am - bm >= 5
                        else "改善未確認"
                    )
                    condition = f"{width}×{900 if width == 1440 else 812}・{count}件・静定・交互5組"
                    rows.append(
                        [
                            label,
                            "peta-board.html（直接起動）",
                            condition,
                            mlabel,
                            f"{bm:.1f}",
                            f"{am:.1f}",
                            f"{rate:.1f}%",
                            f"{len(b)}/{len(a)}",
                            verdict,
                            f"{min(b):.1f}–{max(b):.1f}",
                            f"{min(a):.1f}–{max(a):.1f}",
                        ]
                    )
header = [
    "画面・操作",
    "URL",
    "計測条件",
    "指標",
    "変更前の中央値（ms）",
    "変更後の中央値（ms）",
    "時間の短縮率",
    "計測回数（前／後）",
    "判定",
    "前min–max（ms）",
    "後min–max（ms）",
]
for row in rows:
    if (
        row[0] == "ボード直接表示"
        and row[2] == "1440×900・500件・再読み込み"
        and row[8] == "悪化"
    ):
        row[8] = "連続手順では悪化。静定後の交互比較では悪化未確認"
    if row[0] == "ヘルプ" and row[3] == "操作可能" and float(row[6].rstrip("%")) < 0:
        row[8] = "改善未確認（描画フレームでの観測。単独表示の準備完了は別行）"
with (root / "results.csv").open("w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(header)
    w.writerows(rows)
md = [
    "# ローカルHTMLの画面別比較",
    "",
    f"変更前: {before['date']} / Chrome {before['browser']} / SHA-256 `{before['version']}`",
    f"変更後: {after['date']} / Chrome {after['browser']} / SHA-256 `{after['version']}`",
    "",
    "公開本番サイトの結果ではありません。ユーザー指定の対象はHTMLファイルです。",
    "",
    "| " + " | ".join(header) + " |",
    "| " + " | ".join(["---"] * len(header)) + " |",
]
md += ["| " + " | ".join(r) + " |" for r in rows]
(root / "results.md").write_text("\n".join(md) + "\n", encoding="utf-8")
for r in rows:
    if "1440" in r[2] and "500件・初回" in r[2]:
        print(" | ".join(r))

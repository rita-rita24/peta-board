import collections
import csv
import json
import pathlib
import random
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
        (before, "performance/round3/before.html"),
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
        (before, "performance/round3/before.html"),
        (after, "peta-board.html"),
    ]:
        if extra["versions"][source] != data["version"]:
            raise ValueError("empty editor source version mismatch")
        data["rows"] += [r for r in extra["rows"] if r["source"] == source]
empty_search = root / "empty-search.json"
if empty_search.exists():
    extra = json.loads(empty_search.read_text(encoding="utf-8"))
    for data, source in [
        (before, "performance/round3/before.html"),
        (after, "peta-board.html"),
    ]:
        assert extra["versions"][source] == data["version"]
        data["rows"] = [
            r
            for r in data["rows"]
            if not (r["count"] == 0 and r["screen"] in {"search", "search-clear"})
        ] + [r for r in extra["rows"] if r["source"] == source]
labels = {
    "confirmation": "設定再表示（初期化前）",
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

                b, a = (
                    values("performance/round3/before.html"),
                    values("peta-board.html"),
                )
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

                    b, a = (
                        values("performance/round3/before.html"),
                        values("peta-board.html"),
                    )
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
paired_path = root / "paired-final.json"
if paired_path.exists():
    data = json.loads(paired_path.read_text(encoding="utf-8"))
    assert data["versions"]["peta-board.html"] == after["version"]
    for screen, label in {
        "board": "ボード・交互比較",
        "search-title": "題名の検索・交互比較",
        "search": "検索・交互比較",
        "search-clear": "検索解除・交互比較",
        "horizontal-scroll": "末尾列への横スクロール",
        "vertical-scroll": "列末尾への縦スクロール",
    }.items():
        for width in [1440, 375]:
            for count in [50, 500]:
                for cache in ["cold", "warm"]:
                    for metric, mlabel in metric_names.items():

                        def vals(source):
                            return [
                                r[metric]
                                for r in data["rows"]
                                if r["source"] == source
                                and r["viewport"]["width"] == width
                                and r["count"] == count
                                and r["cache"] == cache
                                and r["screen"] == screen
                                and metric in r
                            ]

                        b, a = (
                            vals("performance/round3/before.html"),
                            vals("peta-board.html"),
                        )
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
                        # Same-run pairs reduce background-load drift. Bootstrap the ratio of medians,
                        # resampling pairs together, before applying a conservative practical-effect threshold.
                        rng = random.Random(20261009)
                        rates = []
                        for _ in range(10000):
                            indices = [rng.randrange(len(b)) for _ in b]
                            bmed = statistics.median([b[i] for i in indices])
                            amed = statistics.median([a[i] for i in indices])
                            rates.append((bmed - amed) / bmed * 100)
                        rates.sort()
                        lo, hi = rates[250], rates[9749]
                        positive = sum(y < x for x, y in zip(b, a)) / len(b)
                        verdict = (
                            "改善"
                            if lo > 0 and rate >= 5 and bm - am >= 5 and positive >= 0.8
                            else "悪化"
                            if hi < 0
                            and rate <= -5
                            and am - bm >= 5
                            and positive <= 0.2
                            else "改善未確認"
                        )
                        verdict += f"（交互ペアの95%区間 {lo:.1f}〜{hi:.1f}%・短縮 {round(positive * len(b))}/{len(b)}組）"
                        cond = (
                            f"{width}×{900 if width == 1440 else 812}・{count}件・"
                            + ("初回" if cache == "cold" else "再読み込み")
                            + f"・版を交互に{len(b)}組"
                        )
                        rows.append(
                            [
                                label,
                                "peta-board.html（直接起動）",
                                cond,
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
# Supplemental definitions are separate rows; native readiness is distinct from frame readiness.
for filename in [
    "phased.json",
    "io-phased.json",
    "after-clear-phased.json",
    "main-paired.json",
]:
    path = root / filename
    if not path.exists():
        continue
    d = json.loads(path.read_text(encoding="utf-8"))
    assert d["versions"]["peta-board.html"] == after["version"]
    assert d["versions"]["performance/round3/before.html"] == before["version"]
    groups = collections.defaultdict(dict)
    for r in d["rows"]:
        key = (
            r["screen"],
            r.get("viewport", {}).get("width", 1440),
            r["count"],
            r.get("cache", "cold"),
        )
        groups[key].setdefault(r["source"], []).append(r)
    for (screen, width, count, cache), g in groups.items():
        label = {
            **labels,
            "horizontal-scroll": "末尾列への横スクロール",
            "vertical-scroll": "列末尾への縦スクロール",
            "import-confirm": "JSON復元・読込後の確認",
            "import-result": "JSON復元・確定後の結果",
        }[screen]
        for metric, mlabel in metric_names.items():
            b = [r[metric] for r in g["performance/round3/before.html"] if metric in r]
            a = [r[metric] for r in g["peta-board.html"] if metric in r]
            if not b:
                continue
            bm, am = statistics.median(b), statistics.median(a)
            rate = (bm - am) / bm * 100
            rng = random.Random(20261009)
            rates = []
            for _ in range(10000):
                ix = [rng.randrange(len(b)) for _ in b]
                bmed = statistics.median([b[i] for i in ix])
                amed = statistics.median([a[i] for i in ix])
                rates.append((bmed - amed) / bmed * 100)
            rates.sort()
            lo, hi = rates[250], rates[9749]
            positive = sum(y < x for x, y in zip(b, a)) / len(b)
            verdict = (
                "改善"
                if lo > 0 and rate >= 5 and bm - am >= 5 and positive >= 0.8
                else "悪化"
                if hi < 0 and rate <= -5 and am - bm >= 5 and positive <= 0.2
                else "改善未確認"
            )
            verdict += f"（95%区間 {lo:.1f}〜{hi:.1f}%・短縮 {round(positive * len(b))}/{len(b)}組）"
            cond = (
                f"{width}×{900 if width == 1440 else 812}・{count}件・"
                + ("初回" if cache == "cold" else "再読み込み")
                + "・開始位相を揃えた追加10回"
            )
            if filename == "main-paired.json":
                cond = (
                    f"{width}×{900 if width == 1440 else 812}・{count}件・"
                    + ("初回" if cache == "cold" else "再読み込み")
                    + "・基本操作順で版を交互に10組"
                )
            if filename == "io-phased.json":
                cond += "・復元確定のみ位相調整・版ごとに順次計測"
            if filename == "after-clear-phased.json":
                cond += "・検索解除ボタン後に設定を再表示"
            if (
                metric == "interactive"
                and filename in {"phased.json", "after-clear-phased.json"}
                and "scroll" not in screen
            ):
                mlabel += "（イベント処理直後）"
            rows.append(
                [
                    label
                    + (
                        "・基本操作順交互比較"
                        if filename == "main-paired.json"
                        else "・検索解除後の追加比較"
                        if filename == "after-clear-phased.json"
                        else "・開始位相比較"
                    ),
                    "peta-board.html（直接起動）",
                    cond,
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

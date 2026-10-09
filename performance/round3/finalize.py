import csv
import datetime
import hashlib
import json
from pathlib import Path

p = Path(__file__).parent
h = hashlib.sha256(Path("peta-board.html").read_bytes()).hexdigest()
bh = hashlib.sha256((p / "before.html").read_bytes()).hexdigest()
manifest = {
    "date": datetime.datetime.now(datetime.UTC).isoformat(),
    "finalVersion": h,
    "beforeVersion": bh,
    "checks": {},
}
for f in [
    "before-file.json",
    "after-file.json",
    "paired-final.json",
    "phased.json",
    "main-paired.json",
    "empty-search.json",
    "io.json",
    "errors.json",
    "empty-editor.json",
    "parity.json",
    "verification-file.json",
    "modal-verification.json",
    "scroll-verification.json",
    "preserved-verification.json",
    "display.json",
    "pixel-differences.json",
]:
    d = json.loads((p / f).read_text(encoding="utf-8"))
    if isinstance(d, dict):
        if "versions" in d:
            for s, v in d["versions"].items():
                assert v == (bh if s == "performance/round3/before.html" else h), (
                    f + " version mismatch"
                )
        assert not d.get("errors", [])
    manifest["checks"][f] = {
        "sha256": hashlib.sha256((p / f).read_bytes()).hexdigest(),
        "date": d.get("date") if isinstance(d, dict) else None,
    }
assert json.loads((p / "after-file.json").read_text(encoding="utf-8"))["version"] == h
assert json.loads((p / "before-file.json").read_text(encoding="utf-8"))["version"] == bh
assert json.loads((p / "parity.json").read_text(encoding="utf-8"))["equal"]
d = json.loads((p / "display.json").read_text(encoding="utf-8"))
assert d["accessibilityEqual"]
assert len(d["results"]) == 90
assert all(r["geometryEqual"] for r in d["results"])
(p / "final-manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
)
with (p / "results.csv").open(newline="", encoding="utf-8") as csv_file:
    rows = list(csv.DictReader(csv_file))
print("final version", h, "comparison rows", len(rows))

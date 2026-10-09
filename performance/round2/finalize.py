import csv
import datetime
import hashlib
import json
from pathlib import Path

p = Path(__file__).parent
h = hashlib.sha256(Path("peta-board.html").read_bytes()).hexdigest()
manifest = {
    "date": datetime.datetime.now(datetime.UTC).isoformat(),
    "finalVersion": h,
    "checks": {},
}
files = [
    "before-file.json",
    "after-file.json",
    "paired-final.json",
    "phased.json",
    "io-phased.json",
    "empty-search.json",
    "io.json",
    "errors.json",
    "empty-editor.json",
    "parity.json",
    "verification-file.json",
    "modal-verification.json",
    "scroll-verification.json",
    "geometry-final.json",
    "preserved-verification.json",
    "after-clear-phased.json",
]
for f in files:
    d = json.loads((p / f).read_text(encoding="utf-8"))
    if isinstance(d, dict):
        if "versions" in d and "peta-board.html" in d["versions"]:
            assert d["versions"]["peta-board.html"] == h
        assert not d.get("errors", [])
    manifest["checks"][f] = {
        "sha256": hashlib.sha256((p / f).read_bytes()).hexdigest(),
        "date": d.get("date") if isinstance(d, dict) else None,
    }
assert all(
    r["differences"] == 0
    for r in json.loads((p / "geometry-final.json").read_text(encoding="utf-8"))
)
assert json.loads((p / "parity.json").read_text(encoding="utf-8"))["equal"]
(p / "final-manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
)
with (p / "results.csv").open(newline="", encoding="utf-8") as csv_file:
    rows = list(csv.DictReader(csv_file))
print("final version", h, "comparison rows", len(rows))

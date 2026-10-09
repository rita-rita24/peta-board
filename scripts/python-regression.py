import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

root = pathlib.Path.cwd()
runners = sorted((root / "performance").rglob("*.py"))
html_by_hash = {
    hashlib.sha256(path.read_bytes()).hexdigest(): path
    for path in (root / "performance").rglob("*.html")
}
records = []
previous_sources = json.loads(
    (root / "performance/followup/python-before-source.json").read_text(
        encoding="utf-8"
    )
)


def normalized(path):
    if path.suffix != ".json":
        return path.read_bytes()
    value = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(value, dict):
        value.pop("date", None)
    return json.dumps(value, sort_keys=True, ensure_ascii=False).encode("utf-8")


for runner in runners:
    relative = runner.relative_to(root)
    outputs = []
    for stage in ["before", "after"]:
        with tempfile.TemporaryDirectory(prefix="peta-python-") as directory:
            workspace = pathlib.Path(directory)
            archive = workspace / relative.parent
            archive.mkdir(parents=True)
            for path in runner.parent.iterdir():
                if path.is_file() and path.suffix in {
                    ".py",
                    ".json",
                    ".csv",
                    ".md",
                    ".html",
                }:
                    shutil.copy2(path, archive / path.name)
            copied = workspace / relative
            if stage == "before":
                copied.write_text(previous_sources[str(relative)], encoding="utf-8")
            evidence = copied.parent / (
                "commit-after-combined.json"
                if runner.name == "report.py"
                else "after-file.json"
            )
            version = json.loads(evidence.read_text(encoding="utf-8"))["version"]
            shutil.copy2(html_by_hash[version], workspace / "peta-board.html")
            output_names = (
                {"results.csv", "results.md"}
                if runner.name == "compare.py"
                else {"results.csv", "REPORT.md"}
                if runner.name == "report.py"
                else {"final-manifest.json"}
            )
            result = subprocess.run(
                [sys.executable, str(copied)],
                cwd=workspace,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(f"{relative} ({stage}): {result.stderr}")
            changed = {
                str(path.relative_to(workspace)): normalized(path)
                for path in archive.iterdir()
                if path.is_file() and path.name in output_names
            }
            outputs.append(changed)
    if outputs[0] != outputs[1]:
        raise AssertionError(f"Output mismatch: {relative}")
    records.append(
        {"runner": str(relative), "equal": True, "outputFiles": sorted(outputs[0])}
    )
    print(relative, "equal")

evidence_directory = root / os.environ.get("EVIDENCE_DIR", "performance/verification")
evidence_directory.mkdir(parents=True, exist_ok=True)
(evidence_directory / "python-regression.json").write_text(
    json.dumps(
        {
            "python": sys.version,
            "records": records,
            "definition": "Each historical runner executes before/after code in isolated copies using its matching archived HTML and evidence. Compare output bytes except JSON manifest top-level date. Original evidence untouched.",
        },
        indent=2,
        ensure_ascii=False,
    ),
    encoding="utf-8",
)

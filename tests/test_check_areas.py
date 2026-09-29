"""The quick tier's table still points at things that exist.

`e2e/areas.json` maps source globs to the browser specs a change to them
reaches, and `scripts/check.sh --quick` runs only those. A glob that no
longer matches a file, or a spec name that no longer names a spec, would
make the quick tier skip what it was meant to run, silently; so each is
checked here, against the tree as it is.
"""

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
TABLE = json.loads((ROOT / "e2e" / "areas.json").read_text(encoding="utf-8"))
SPECS = sorted(p.name[: -len(".spec.ts")] for p in (ROOT / "e2e" / "specs").glob("*.spec.ts"))
FILES = [
    str(p.relative_to(ROOT)).replace("\\", "/")
    for top in ("frontend/src", "server", "nexttex")
    for p in (ROOT / top).rglob("*")
    if p.is_file() and "__pycache__" not in p.parts
]


def regex(glob: str) -> re.Pattern:
    """The same reading of a glob as e2e/quick.mjs: * within a segment, ** any depth."""
    out, i = "", 0
    while i < len(glob):
        if glob.startswith("**", i):
            out, i = out + ".*", i + 2
        elif glob[i] == "*":
            out, i = out + "[^/]*", i + 1
        else:
            out, i = out + re.escape(glob[i]), i + 1
    return re.compile(f"^{out}$")


@pytest.mark.parametrize("area", TABLE["areas"], ids=lambda a: a["name"])
def test_every_source_glob_matches_a_file(area):
    for glob in area["sources"]:
        assert any(regex(glob).match(f) for f in FILES), f"{area['name']}: {glob} matches no file"


@pytest.mark.parametrize("area", TABLE["areas"], ids=lambda a: a["name"])
def test_every_spec_name_names_a_spec(area):
    for pattern in area["specs"]:
        assert any(regex(pattern).match(s) for s in SPECS), f"{area['name']}: {pattern} names no spec"


def test_the_always_set_exists():
    for name in TABLE["always"]:
        assert name in SPECS


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not on PATH")
def test_a_change_to_the_preview_runs_the_preview_specs_and_not_the_rest():
    done = subprocess.run(
        ["node", "e2e/quick.mjs"],
        cwd=ROOT, capture_output=True, text=True,
        env={"PATH": shutil.which("node").rsplit("/", 1)[0], "NEXTTEX_QUICK_FILES": "frontend/src/panes/Pdf.tsx"},
    )
    if done.returncode != 0 and "SyntaxError" in done.stderr:
        pytest.skip("this node is too old for the script")
    chosen = done.stdout.split()
    assert "specs/preview-swap.spec.ts" in chosen
    assert "specs/pdf-view.spec.ts" in chosen
    assert "specs/agent.spec.ts" not in chosen
    assert "ALL" not in chosen

"""A project-relative path is written with forward slashes on every platform.

The manifest, the history and the browser name files `chapters/one.tex`.
`str()` of a relative path on Windows says `chapters\\one.tex`, and on the
owner's laptop on 13 November 2026 the trash asked the history for the key
of `chapters\\05_...\\figures\\a.pdf`. The store knew no such path, so it
walked the tree for one, and the walk gave a fresh record to every figure
of a deleted chapter, which brought them back. `Project.relative` already
says `as_posix()`; this holds every other place that builds one.
"""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _offenders() -> list[str]:
    found = []
    for folder in ("nexttex", "server"):
        for source in sorted((ROOT / folder).rglob("*.py")):
            tree = ast.parse(source.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id == "str"
                    and node.args
                    and isinstance(node.args[0], ast.Call)
                    and isinstance(node.args[0].func, ast.Attribute)
                    and node.args[0].func.attr == "relative_to"
                ):
                    found.append(f"{source.relative_to(ROOT).as_posix()}:{node.lineno}")
    return found


def test_no_relative_path_is_spelled_by_str():
    assert _offenders() == []

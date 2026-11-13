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


def _is_relative_to_call(node) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "relative_to"
    )


def _offenders() -> list[str]:
    """`str(x.relative_to(root))`, and `str(rel)` where `rel` was assigned
    one in the same function: the second is how the file watcher handed
    the Windows laptop's folder renames on as `chapters\\04_beta`, which
    matched no record, so the folder's files were adopted afresh under its
    new name and the old ones were never moved (13 November 2026)."""
    found = []
    for folder in ("nexttex", "server"):
        for source in sorted((ROOT / folder).rglob("*.py")):
            tree = ast.parse(source.read_text(encoding="utf-8"))
            scopes = [n for n in ast.walk(tree)
                      if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Module))]
            for scope in scopes:
                relatives = {
                    target.id
                    for node in ast.walk(scope) if isinstance(node, ast.Assign)
                    and _is_relative_to_call(node.value)
                    for target in node.targets if isinstance(target, ast.Name)
                }
                for node in ast.walk(scope):
                    if not (
                        isinstance(node, ast.Call)
                        and isinstance(node.func, ast.Name)
                        and node.func.id == "str"
                        and node.args
                    ):
                        continue
                    arg = node.args[0]
                    if _is_relative_to_call(arg) or (
                        isinstance(arg, ast.Name) and arg.id in relatives
                    ):
                        found.append(f"{source.relative_to(ROOT).as_posix()}:{node.lineno}")
    return sorted(set(found))


def test_no_relative_path_is_spelled_by_str():
    assert _offenders() == []

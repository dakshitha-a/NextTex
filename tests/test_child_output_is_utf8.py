"""Every child process whose output is read as text is read as UTF-8.

`text=True` without an `encoding` decodes with the locale's code page,
which on Windows is cp1252: the laptop's `server.err.log` held repeated
UnicodeDecodeErrors from a subprocess reader thread, raised by a byte
cp1252 has no character for. The programs NextTex runs, git, TeX, pandoc,
poppler and the rest, write UTF-8, so each call says so, with
`errors="replace"` so a stray byte costs a character and not the call.
"""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CALLS = {"run", "Popen", "check_output", "check_call", "call"}


def offenders() -> list[str]:
    found = []
    for folder in ("nexttex", "server", "scripts"):
        for path in sorted((ROOT / folder).rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                func = node.func
                name = func.attr if isinstance(func, ast.Attribute) else (
                    func.id if isinstance(func, ast.Name) else "")
                if name not in CALLS:
                    continue
                words = {k.arg: k.value for k in node.keywords if k.arg}
                texty = any(
                    isinstance(words.get(key), ast.Constant) and words[key].value is True
                    for key in ("text", "universal_newlines")
                )
                if texty and ("encoding" not in words or "errors" not in words):
                    found.append(f"{path.relative_to(ROOT)}:{node.lineno}")
    return found


def test_no_child_is_read_in_the_locales_code_page():
    assert offenders() == []

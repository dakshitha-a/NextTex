"""The installer must run on a bare interpreter, and this is what says so.

It is started by the bootstrap before there is a virtual environment, on
whatever Python the machine already had.  A single `import` of anything from
`requirements.txt` at module level would break it on every fresh machine and
on none of the developer's own, which is the worst shape a bug can have.

`nexttex/install/steps.py` carries the constraint twice over, because the
running server imports it from *inside* the virtual environment: adding the
Claude CLI from the settings sheet has to be the same act, and the same
code, as installing it during the install.
"""

from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "nexttex" / "install"

# Modules of our own the installer may reach for, each of which is itself
# checked by this test or is standard library only.
OURS = {"nexttex", "paths", "tools", "ui", "survey", "plan", "steps", "service"}


def modules():
    return sorted(PACKAGE.glob("*.py")) + [
        ROOT / "nexttex" / "tools.py",
        ROOT / "nexttex" / "paths.py",
    ]


@pytest.mark.parametrize("path", modules(), ids=lambda p: p.name)
def test_nothing_outside_the_standard_library_is_imported_at_module_level(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        # Only module level.  An import inside a function is deferred and
        # therefore harmless: it runs on whichever interpreter got there.
        if getattr(node, "col_offset", 0) != 0:
            continue
        if isinstance(node, ast.ImportFrom):
            names = [(node.module or "").split(".")[0]] if node.level == 0 else []
        else:
            names = [alias.name.split(".")[0] for alias in node.names]
        for name in names:
            if not name or name in OURS:
                continue
            if name not in sys.stdlib_module_names:
                offenders.append(f"{path.name}: {name}")
    assert not offenders, "\n".join(offenders)


def test_the_installer_actually_imports_on_a_bare_interpreter():
    """The AST check above is a proxy; this is the thing itself.

    `-I` isolates the interpreter from PYTHONPATH and the user site
    directory, and `-S` skips site-packages, so nothing installed on this
    machine can accidentally satisfy an import.
    """
    for module in ("nexttex.install.ui", "nexttex.install.survey",
                   "nexttex.install.plan", "nexttex.install.steps",
                   "nexttex.install.service", "nexttex.install.__main__"):
        result = subprocess.run(
            [sys.executable, "-I", "-S", "-c",
             f"import sys; sys.path.insert(0, {str(ROOT)!r}); import {module}"],
            capture_output=True, text=True, timeout=60,
        )
        assert result.returncode == 0, f"{module}\n{result.stderr}"


def test_importing_steps_does_nothing(tmp_path):
    """No side effects at import time, on either interpreter that imports it."""
    result = subprocess.run(
        [sys.executable, "-I", "-S", "-c",
         f"import sys; sys.path.insert(0, {str(ROOT)!r});"
         "import nexttex.install.steps as s; print(s.CLAUDE_UNIX)"],
        capture_output=True, text=True, cwd=tmp_path, timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert "claude.ai" in result.stdout
    assert not list(tmp_path.iterdir()), "importing it wrote something"


def test_the_server_and_the_installer_agree_on_how_claude_is_installed():
    """One answer to "how does the Claude CLI get installed", not one per
    caller -- which is the same reason the rest of this rework exists."""
    sys.path.insert(0, str(ROOT))
    from nexttex import claude_auth
    from nexttex.install import steps

    source = Path(claude_auth.__file__).read_text(encoding="utf-8")
    assert "from .install.steps import" in source
    assert "claude_install_command" in source
    assert "claude.ai" in steps.claude_install_url("posix")
    # And the command is the platform's own, never a shell string.
    posix = steps.claude_install_command("posix", Path("/tmp/x.sh"))
    windows = steps.claude_install_command("windows", Path("C:/x.ps1"))
    assert posix[0] == "bash"
    assert windows[0] == "powershell" and "-File" in windows

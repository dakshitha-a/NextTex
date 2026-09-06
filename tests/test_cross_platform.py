"""What has to hold on a machine that is not this one.

NextTex is developed on Linux and released for three platforms, so the
things that would break elsewhere are the things nobody here will notice.
These are the ones that can be checked without the other machine.
"""

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Modules that do not exist on Windows.  Importing one at the top of a
# module means the whole server fails to start there rather than one
# feature being unavailable.
POSIX_ONLY = {"fcntl", "pty", "termios", "grp", "pwd", "resource", "tty"}


def python_sources() -> list[Path]:
    return [
        path
        for folder in ("nexttex", "server")
        for path in (ROOT / folder).rglob("*.py")
        if "vendor" not in path.parts
    ]


def test_no_posix_only_module_is_imported_at_module_level():
    """`import pty` at the top of claude_auth used to be enough to stop
    NextTex starting on Windows -- not the sign-in, the whole server."""
    offenders = []
    for path in python_sources():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            # Only module level: an import inside a function or a try/except
            # is a deliberate, guarded one.
            if not isinstance(node, (ast.Import, ast.ImportFrom)):
                continue
            if getattr(node, "col_offset", 0) != 0:
                continue
            names = (
                [alias.name.split(".")[0] for alias in node.names]
                if isinstance(node, ast.Import)
                else [(node.module or "").split(".")[0]]
            )
            for name in names:
                if name in POSIX_ONLY:
                    offenders.append(f"{path.relative_to(ROOT)}: {name}")
    assert not offenders, "\n".join(offenders)


def test_the_pseudo_terminal_login_says_so_rather_than_failing():
    from nexttex import claude_auth

    source = claude_auth.__doc__ or ""
    assert hasattr(claude_auth, "HAVE_PTY")
    # And the message names the two ways out, because a dead end on the
    # first screen of a new install is the worst place to have one.
    import inspect

    text = inspect.getsource(claude_auth.start_login)
    assert "OpenAI key" in text and "claude auth login" in text


def test_tex_is_looked_for_on_all_three_platforms():
    from nexttex.config import TEX_HINTS

    joined = " ".join(str(hint) for hint in TEX_HINTS)
    assert "x86_64-linux" in joined, "no Linux TinyTeX path"
    assert "universal-darwin" in joined, "no macOS TinyTeX path"
    assert "TeX/texbin" in joined, "no MacTeX path"
    assert "MiKTeX" in joined, "no Windows MiKTeX path"
    assert "texlive" in joined.lower()


def test_the_installers_exist_for_every_platform_the_readme_claims():
    assert (ROOT / "scripts" / "install.sh").exists()
    assert (ROOT / "scripts" / "install.ps1").exists()
    assert (ROOT / "scripts" / "update.sh").exists()
    assert (ROOT / "scripts" / "update.ps1").exists()


def test_the_unix_installer_refuses_windows_rather_than_half_running():
    text = (ROOT / "scripts" / "install.sh").read_text(encoding="utf-8")
    assert "install.ps1" in text, "does not point Windows users anywhere"
    assert "Darwin" in text and "Linux" in text


def test_the_unix_installer_looks_for_tex_where_macos_puts_it():
    text = (ROOT / "scripts" / "install.sh").read_text(encoding="utf-8")
    assert "universal-darwin" in text
    assert "/Library/TeX/texbin" in text


def test_the_unix_installer_can_start_on_login_on_both_platforms():
    text = (ROOT / "scripts" / "install.sh").read_text(encoding="utf-8")
    assert "LaunchAgents" in text, "no launchd unit for macOS"
    assert "systemd/user" in text, "no systemd unit for Linux"


def test_no_script_hardcodes_a_path_from_the_machine_it_was_written_on():
    """A stranger opening scripts/check.sh should not find somebody else's
    conda environment in it."""
    for name in ("check.sh", "install.sh", "update.sh", "install.ps1", "update.ps1"):
        text = (ROOT / "scripts" / name).read_text(encoding="utf-8")
        assert "miniconda" not in text, name
        assert "/home/user" not in text, name
        assert "/home/user" not in text, name


def test_nothing_private_is_committed_with_the_example_project():
    """`.nexttex/` holds a project's history, its trash, its agent
    transcript and the id of the Claude session that produced it.  It was
    committed once, along with the example project, and went out in a
    public push."""
    ignored = (ROOT / ".gitignore").read_text(encoding="utf-8")
    assert ".nexttex/" in ignored
    assert not (ROOT / "examples" / "minimal-article" / ".nexttex").exists()


def test_nothing_ships_with_the_authors_own_contact_details():
    """The vendored scholarly tools hard-coded the author's email address
    and a User-Agent naming their dissertation.  That was fine while this
    was one person's tooling; published, it made every user's literature
    searches identify as -- and give a contact address for -- somebody
    else."""
    import re

    leaks = []
    pattern = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
    for path in python_sources() + list((ROOT / "nexttex" / "vendor").rglob("*.py")):
        for match in pattern.findall(path.read_text(encoding="utf-8")):
            if match.endswith((".invalid", ".example", "@localhost")):
                continue          # deliberate placeholders
            leaks.append(f"{path.relative_to(ROOT)}: {match}")
    assert not leaks, "\n".join(leaks)


def test_the_scholarly_apis_are_told_who_is_calling_generically():
    """And the address, when there is one, is the user's own."""
    from nexttex.references import _load

    for name in ("lit_search", "bib_from_doi", "verify_bib"):
        module = _load(name)
        assert module.UA.startswith("nexttex-"), module.UA
        assert "thesis" not in module.UA, module.UA

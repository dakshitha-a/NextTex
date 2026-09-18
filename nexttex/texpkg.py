"""Installing the TeX package a failed build said was missing.

The commonest build failure on a TinyTeX install is a `.sty` that is not
there, and until this the drawer's row for it was the one instruction in
NextTex that sent somebody to a terminal: "run `tlmgr install <name>`".
This maps the file to its package, with tlmgr's own file search, and
installs it, so the row can carry a button instead.

Two rules the pip card in `plots.py` already follows are followed here.
The name that reaches the package manager is validated against a pattern
that admits a package name and nothing that could be an option, a URL or
a path.  And the browser asks the writer first: an install downloads from
a CTAN mirror and runs what it downloads, which is the same reason the
agent's `install_package` is fenced.

`NEXTTEX_TLMGR` names the binary, the seam `NEXTTEX_CLAUDE_BINARY` is for
the Claude CLI, so the browser tier can point it at `tests/fake_tlmgr.py`
and exercise the row without a mirror or a real install.
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
from pathlib import Path

#: A package name, and nothing else: no option, no URL, no path.
PACKAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

#: A file a document can be missing: a style, a class, a font definition,
#: a bibliography style.  The extension list is what the drawer's rule
#: recognises, and the name is the same shape as a package name.
MISSING_FILE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(sty|cls|def|fd|bst|clo|ldf|tex)$", re.I
)

#: How long the file search and the install may take.  The search asks a
#: mirror once; the install fetches and unpacks, which on a slow mirror is
#: minutes rather than seconds.
SEARCH_TIMEOUT = 30.0
INSTALL_TIMEOUT = 300.0

#: Where a package's files live in a TeX distribution.  The search answers
#: with every file whose path contains the name, and `tex/latex/` and
#: `tex/generic/` are where a `\usepackage` looks; a documentation or a
#: source tree with the same basename is not the package the writer needs.
TEX_TREES = ("tex/latex/", "tex/generic/", "bibtex/bst/", "tex/plain/")

#: Answers already given, per file.  The drawer re-renders on every build
#: and the row would otherwise ask the mirror each time it opened.
_KNOWN: dict[str, str] = {}

#: One install at a time.  tlmgr keeps a lock of its own and a second run
#: fails on it, which is a worse answer than waiting.
_INSTALLING = asyncio.Lock()


def manager_here() -> tuple[str, str]:
    """Which package manager this TeX has, and where.

    `("tlmgr", path)` for TeX Live and TinyTeX, `("mpm", path)` for MiKTeX,
    `("", "")` for neither.  The path is resolved rather than the bare
    name, for the reason `install_tex_extras` in the installer records:
    `shutil.which("tlmgr")` finds `tlmgr.bat` on Windows and `CreateProcess`
    will not run a bare name that is not an `.exe`.
    """
    named = os.environ.get("NEXTTEX_TLMGR", "").strip()
    if named:
        return "tlmgr", named
    for kind in ("tlmgr", "mpm"):
        found = shutil.which(kind)
        if found:
            return kind, str(Path(found))
    return "", ""


async def _run(argv: list[str], timeout: float) -> tuple[int | None, str]:
    """Run one command off the loop and return its exit code and output,
    stdout and stderr together, since tlmgr says the useful thing on
    either depending on the failure."""
    process = await asyncio.create_subprocess_exec(
        *argv,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        out, _ = await asyncio.wait_for(process.communicate(), timeout)
    except asyncio.TimeoutError:
        process.kill()
        raise
    return process.returncode, (out or b"").decode("utf-8", errors="replace")


def parse_search(output: str, file: str) -> str:
    """The package that provides `file`, out of `tlmgr search --file`.

    tlmgr answers a package name on a line of its own, followed by the
    matching paths indented under it.  The first package whose path ends
    in the file, under a tree a document reads from, is the answer; a
    package that merely contains the name somewhere is not.
    """
    wanted = "/" + file.lower()
    package = ""
    fallback = ""
    for raw in output.splitlines():
        line = raw.rstrip()
        if not line or line.startswith("tlmgr:"):
            continue
        if not line[0].isspace() and line.endswith(":"):
            package = line[:-1].strip()
            continue
        path = line.strip().lower()
        if not package or not path.endswith(wanted):
            continue
        if any(tree in path for tree in TEX_TREES):
            return package
        fallback = fallback or package
    return fallback


async def package_for_file(file: str) -> dict:
    """Which package provides a missing file, and which manager would
    install it: `{"file", "package", "manager"}`, with an empty package
    when nothing answers and an empty manager when this TeX has none."""
    if not MISSING_FILE.match(file):
        return {"file": file, "package": "", "manager": ""}
    kind, path = manager_here()
    if not kind:
        return {"file": file, "package": "", "manager": ""}
    if file in _KNOWN:
        return {"file": file, "package": _KNOWN[file], "manager": kind}
    if kind == "mpm":
        # MiKTeX names nearly every package after its main file, and its
        # own console installs on the fly by default, so a guess is what
        # the writer would type; it has not been run against a MiKTeX
        # here, and the tracker says so.
        package = Path(file).stem
    else:
        try:
            code, output = await _run(
                [path, "search", "--file", "--global", "/" + file], SEARCH_TIMEOUT
            )
        except (asyncio.TimeoutError, OSError):
            return {"file": file, "package": "", "manager": kind}
        package = parse_search(output, file) if code == 0 else ""
    if package and PACKAGE.match(package):
        _KNOWN[file] = package
    else:
        package = ""
    return {"file": file, "package": package, "manager": kind}


async def install(package: str) -> dict:
    """Install one package with the manager this TeX has.

    `{"ok": bool, "err": str}`, with the manager's own words on failure:
    a TinyTeX behind its mirror fails with "remote repository is newer
    than local", and the writer needs to read that rather than "failed".
    """
    if not PACKAGE.match(package):
        return {"ok": False, "err": f"{package!r} is not a package name."}
    kind, path = manager_here()
    if not kind:
        return {"ok": False, "err": "No TeX package manager was found on this computer."}
    argv = [path, "install", package] if kind == "tlmgr" else [path, f"--install={package}"]
    async with _INSTALLING:
        try:
            code, output = await _run(argv, INSTALL_TIMEOUT)
        except asyncio.TimeoutError:
            return {"ok": False, "err": "The install was still running after five minutes."}
        except OSError as error:
            return {"ok": False, "err": str(error)}
    if code == 0:
        return {"ok": True, "err": ""}
    return {"ok": False, "err": output.strip()[-2000:] or f"{kind} exited with {code}."}

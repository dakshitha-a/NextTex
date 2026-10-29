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
import subprocess
from pathlib import Path

from . import tools
from .install.steps import SELF_UPDATE, needs_self_update
from .proctree import end_tree

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
#: The most packages one install takes; a template names fewer than twenty.
MAX_AT_ONCE = 40

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
#: The package being installed now, "" when none is. A second project's
#: Install waited on the lock for up to five minutes and said nothing about
#: why (Q-020); the drawer asks this while it waits.
CURRENT = ""


#: The managers a TeX's own bin directory can hold, in the order asked:
#: TeX Live and TinyTeX's `tlmgr`, MiKTeX's `miktex` console, and the
#: `mpm` older MiKTeX installs carry instead of it.
KINDS = ("tlmgr", "miktex", "mpm")


def _manager_in(directory: Path | None) -> tuple[str, str]:
    if directory is None:
        return "", ""
    for kind in KINDS:
        found = shutil.which(kind, path=str(directory))
        if found:
            return kind, str(Path(found))
    return "", ""


def manager_here() -> tuple[str, str]:
    """Which package manager the TeX the builds run has, and where.

    `("tlmgr", path)` for TeX Live and TinyTeX, `("miktex", path)` or
    `("mpm", path)` for MiKTeX, `("", "")` for none.  Asked of the TeX
    the builds use first: the directory somebody named, then the one the
    installer recorded, then wherever `pdflatex` resolves, and only then
    of PATH at large.  Taking the first `tlmgr` on PATH was wrong on the
    owner's laptop on 24 September 2026, where MiKTeX was the chosen TeX
    and TinyTeX was still installed: the button would have put the package
    into TinyTeX, answered that it had, and the MiKTeX build would have
    failed as before.  The path is resolved rather than the bare name, for
    the reason `install_tex_extras` in the installer records:
    `shutil.which("tlmgr")` finds `tlmgr.bat` on Windows and
    `CreateProcess` will not run a bare name that is not an `.exe`.
    """
    named = os.environ.get("NEXTTEX_TLMGR", "").strip()
    if named:
        return "tlmgr", named
    engine = shutil.which("pdflatex")
    for directory in (
        tools.named_tex_dir(),
        tools.recorded_tex_dir(),
        Path(engine).parent if engine else None,
    ):
        kind, path = _manager_in(directory)
        if kind:
            return kind, path
    for kind in KINDS:
        found = shutil.which(kind)
        if found:
            return kind, str(Path(found))
    return "", ""


#: Files whose MiKTeX package is not named after them, which the stem
#: guess in `package_for_file` would get wrong: on the owner's laptop on
#: 29 October 2026 amsart.cls offered "amsart", which MiKTeX does not know.
MIKTEX_PACKAGE = {
    "amsart.cls": "amscls", "amsbook.cls": "amscls", "amsproc.cls": "amscls",
    "amsthm.sty": "amscls", "pifont.sty": "psnfss",
}
LIST_TIMEOUT = 10


def miktex_packages(path: str) -> tuple[set[str], set[str]] | None:
    """MiKTeX's packages: the ones it has, and every one it knows, from
    its own list, or `None` when the list does not answer.

    Asked of the package manager, not kpsewhich: MiKTeX's kpsewhich,
    asked for a file a package it lacks would provide, opens its
    "Package Installation" dialog on the desktop and waits there. On the
    owner's laptop on 29 October 2026 the template check of all 53 files
    never returned, so no template said what it needed. The list answers
    in under a second.
    """
    try:
        done = subprocess.run(
            [path, "packages", "list", "--template={id} {isInstalled}"],
            capture_output=True, text=True, timeout=LIST_TIMEOUT,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    have, known = set(), set()
    for line in done.stdout.splitlines():
        parts = line.split()
        if len(parts) == 2:
            known.add(parts[0])
            if parts[1] == "true":
                have.add(parts[0])
    return (have, known) if known else None


#: How MiKTeX says a package is there already, which ends its install.
ALREADY = re.compile(r"([A-Za-z0-9][A-Za-z0-9._+-]*): package is already installed")


def already_installed(output: str) -> list[str]:
    """The packages MiKTeX said it already has."""
    return ALREADY.findall(output)


def install_argv(kind: str, path: str, package: str | list[str]) -> list[str]:
    """The command that installs one package, or several in one run, with
    this kind of manager.  Each takes a list: tlmgr and `miktex packages
    install` as arguments, the older `mpm` as one `--install` apiece."""
    names = [package] if isinstance(package, str) else list(package)
    if kind == "miktex":
        return [path, "packages", "install", *names]
    if kind == "mpm":
        return [path, *(f"--install={name}" for name in names)]
    return [path, "install", *names]


async def _run(argv: list[str], timeout: float) -> tuple[int | None, str]:
    """Run one command off the loop and return its exit code and output,
    stdout and stderr together, since tlmgr says the useful thing on
    either depending on the failure.  A timeout ends the whole tree:
    `tlmgr.bat` on Windows is a shell running Perl, and killing the shell
    alone left the Perl holding tlmgr's lock."""
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
        pid = getattr(process, "pid", None)
        if pid:
            end_tree(pid, hard=True)
        try:
            process.kill()
        except ProcessLookupError:
            pass
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
    if kind in ("miktex", "mpm"):
        # MiKTeX names nearly every package after its main file, and has
        # no search from a file to its package that answers offline, so
        # the stem is what the writer would type, unless it is one of the
        # known exceptions. A stem MiKTeX's own list does not know gets
        # no button, rather than one that fails with "unknown package".
        package = MIKTEX_PACKAGE.get(file, Path(file).stem)
        if kind == "miktex":
            listed = await asyncio.to_thread(miktex_packages, path)
            if listed is not None and package not in listed[1]:
                package = ""
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


async def install(package: str | list[str]) -> dict:
    """Install one package, or a template's list of them in one run, with
    the manager this TeX has.

    A list is one call: the New project sheet installed a template's
    packages one tlmgr run apiece, each with its own full build after it,
    and the OUP template's seventeen were seventeen of each.

    `{"ok": bool, "err": str}`, with the manager's own words on failure:
    a TinyTeX behind its mirror fails with "remote repository is newer
    than local", and the writer needs to read that rather than "failed".

    A tlmgr older than its repository answers "tlmgr itself needs to be
    updated" and installs nothing, which is a normal state for TinyTeX.
    That one answer is met the way the installer's `install_tex_extras`
    meets it: `tlmgr update --self` once, inside the same lock, and the
    install again.  The search needs no such step, since tlmgr asks it
    only of `install` and `update`.
    """
    names = [package] if isinstance(package, str) else list(package)
    if not names or len(names) > MAX_AT_ONCE:
        return {"ok": False, "err": f"Between one and {MAX_AT_ONCE} packages at a time."}
    for name in names:
        if not PACKAGE.match(name):
            return {"ok": False, "err": f"{name!r} is not a package name."}
    kind, path = manager_here()
    if not kind:
        return {"ok": False, "err": "No TeX package manager was found on this computer."}
    argv = install_argv(kind, path, names)
    # Each package's own allowance, since one run now carries them all.
    timeout = INSTALL_TIMEOUT * len(names)
    global CURRENT
    async with _INSTALLING:
        CURRENT = ", ".join(names)
        try:
            code, output = await _run(argv, timeout)
            if code != 0 and kind == "tlmgr" and needs_self_update(output):
                code, output = await _run([path, *SELF_UPDATE], INSTALL_TIMEOUT)
                if code == 0:
                    code, output = await _run(argv, timeout)
            # MiKTeX refuses the whole list over one package it already
            # has, "everyshi: package is already installed", and installs
            # none (the owner's laptop, 29 October 2026). Each such name is
            # dropped and the rest asked again; a list that empties is done.
            left = list(names)
            while code != 0 and kind in ("miktex", "mpm"):
                there = [n for n in already_installed(output) if n in left]
                if not there:
                    break
                left = [n for n in left if n not in there]
                if not left:
                    code = 0
                    break
                code, output = await _run(install_argv(kind, path, left), timeout)
        except asyncio.TimeoutError:
            if len(names) == 1:
                return {"ok": False, "err": "The install was still running after five minutes."}
            return {"ok": False, "err": (f"The install of {len(names)} packages was still "
                                         f"running after {5 * len(names)} minutes.")}
        except OSError as error:
            return {"ok": False, "err": str(error)}
        finally:
            CURRENT = ""
    if code == 0:
        return {"ok": True, "err": ""}
    return {"ok": False, "err": output.strip()[-2000:] or f"{kind} exited with {code}."}

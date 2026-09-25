r"""A typeset PDF of what changed since a commit, by latexdiff.

A revised paper goes back to a journal with a PDF that marks what changed
since the submitted version. NextTex showed patches in the History and
Git drawers and never a typeset document with the changes marked, and
nothing ran `latexdiff` (Q-048). This does, when it is installed: the
document as it was at a commit, exported from git into a scratch folder,
against the document as it is, flattened so a chapter's `\input` is
compared too, and built with the document's own engine from the project's
root, so its figures are found where they are.

The result goes to `<build>/changes/`, which the build folder's rules
keep out of the tree, of git and of a project's copy.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from io import BytesIO
from pathlib import Path

from . import gitrepo, tools
from .childenv import without_secrets

#: How long latexdiff and the two engine runs may take, each. A long
#: thesis with many changes takes latexdiff a while.
TIMEOUT = 180


class ChangesError(RuntimeError):
    """Something the writer is told in a sentence."""


def binary() -> str:
    """latexdiff, from where the TeX the builds use keeps it, else PATH;
    "" when there is none. `NEXTTEX_LATEXDIFF` names one outright, which is
    how the tests point the server at a stand-in."""
    named = os.environ.get("NEXTTEX_LATEXDIFF", "").strip()
    if named:
        return named
    engine = shutil.which("pdflatex")
    for directory in (tools.named_tex_dir(), tools.recorded_tex_dir(),
                      Path(engine).parent if engine else None):
        if directory is None:
            continue
        for name in ("latexdiff", "latexdiff.exe", "latexdiff.bat"):
            candidate = Path(directory) / name
            if candidate.is_file():
                return str(candidate)
    found = shutil.which("latexdiff")
    return found or ""


def _export(root: Path, sha: str, into: Path) -> None:
    """The project's tracked files as they were at `sha`, into `into`.
    Every entry is checked before it is written: a name that climbs or is
    absolute, and anything that is not a plain file or folder, is left out."""
    if not gitrepo.SHA.fullmatch(sha or ""):
        raise ChangesError("that is not a commit")
    try:
        done = subprocess.run(
            ["git", "archive", "--format=tar", sha],
            cwd=root, capture_output=True, timeout=60, env=gitrepo._environment(),
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ChangesError(f"git could not export that commit: {error}")
    if done.returncode != 0:
        raise ChangesError(gitrepo.said_by(done.stderr.decode("utf-8", "replace"), "git could not export that commit"))
    with tarfile.open(fileobj=BytesIO(done.stdout)) as archive:
        for member in archive.getmembers():
            name = member.name
            if name.startswith("/") or ".." in Path(name).parts:
                continue
            if member.isdir():
                (into / name).mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target = into / name
                target.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source is not None:
                    target.write_bytes(source.read())


def marked_up(root: Path, document: str, sha: str, build_dir: Path, engine: str,
              search_env: dict[str, str]) -> Path:
    """Build the marked-up PDF of `document` since `sha` and return it."""
    tool = binary()
    if not tool:
        raise ChangesError("latexdiff is not installed")
    if not (root / document).is_file():
        raise ChangesError(f"{document} is not in the project")
    short = sha[:7]
    stem = Path(document).stem
    out = build_dir / "changes"
    out.mkdir(parents=True, exist_ok=True)
    job = f"{stem}-since-{short}"
    with tempfile.TemporaryDirectory(prefix="nexttex-changes-") as scratch:
        old_root = Path(scratch)
        _export(root, sha, old_root)
        old = old_root / document
        if not old.is_file():
            raise ChangesError(f"{document} did not exist at that commit")
        argv = [tool, "--flatten", str(old), str(root / document)]
        if tool.endswith(".py"):
            # The tests' stand-in, run by this interpreter.
            argv = [sys.executable, *argv]
        try:
            done = subprocess.run(argv, cwd=root, capture_output=True, timeout=TIMEOUT,
                                  env=without_secrets(os.environ))
        except subprocess.TimeoutExpired:
            raise ChangesError("latexdiff was still working after three minutes")
        except OSError as error:
            raise ChangesError(f"latexdiff could not run: {error}")
        if done.returncode != 0 or not done.stdout.strip():
            said = done.stderr.decode("utf-8", "replace").strip().splitlines()
            raise ChangesError(said[-1] if said else "latexdiff found nothing to compare")
    source = out / f"{job}.tex"
    source.write_bytes(done.stdout)
    # The bibliography as the last build made it, so the citations are
    # numbers rather than question marks without a BibTeX pass here.
    built = build_dir / f"{stem}.bbl"
    if built.is_file():
        shutil.copyfile(built, out / f"{job}.bbl")
    env = {**without_secrets(os.environ), **search_env}
    command = [engine or "pdflatex", "-interaction=nonstopmode",
               f"-output-directory={out}", f"-jobname={job}", str(source)]
    for _ in range(2):
        try:
            subprocess.run(command, cwd=root, capture_output=True, timeout=TIMEOUT, env=env)
        except subprocess.TimeoutExpired:
            raise ChangesError("the marked-up document was still building after three minutes")
        except OSError as error:
            raise ChangesError(f"{command[0]} could not run: {error}")
    pdf = out / f"{job}.pdf"
    if not pdf.is_file():
        # latexdiff's markup asks for `ulem` and `color`, which a small TeX
        # such as TinyTeX may not have: said by name, since the Build
        # drawer's Install is one press away.
        try:
            log = (out / f"{job}.log").read_text(encoding="utf-8", errors="replace")
        except OSError:
            log = ""
        missing = re.search(r"File `([^']+)\.sty' not found", log)
        if missing:
            raise ChangesError(
                f"the marked-up document needs the package {missing.group(1)}, which this "
                "TeX does not have; install it, then try again"
            )
        raise ChangesError("the marked-up document did not build; its log is in the build folder")
    return pdf

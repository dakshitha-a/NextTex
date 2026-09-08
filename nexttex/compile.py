"""Compiling LaTeX fast enough that the preview feels live.

A compile runs every time typing pauses, so the budget is about a second.
Three decisions get it there.

**Only rebuild what changed.** A document that uses `\\include` can be
compiled one chapter at a time with `\\includeonly`, which on a
seven-chapter dissertation halves the work. Whether that applies is
detected from the source, never assumed.

**Only run biber when citations changed.** Biber dominates a full build.
Reference resolution matters when the bibliography moves, not on every
keystroke, so the expensive path is triggered by what the edit touched.

**Never let two runs share a build directory.** A new keystroke kills the
run in flight -- the whole process group, because latexmk spawns children
that outlive it otherwise -- before starting the next.

The one non-obvious mechanism here is the stand-in main file. `\\includeonly`
has to sit in the preamble, so scoping a build to one chapter means either
editing the user's main file on every keystroke or compiling something else.
Editing it is not acceptable: the editor would see its own file change under
it, and every keystroke would dirty the git working tree. So the compiler
writes `.nexttex-preview.tex` beside the real main file -- beside it, because
`\\include` paths resolve relative to the main file's directory -- and runs
that under `-jobname=<main>` so the aux files, the PDF and the SyncTeX map
all keep their usual names and stay shared with a full build.
"""

from __future__ import annotations

import asyncio
import os
import re
import signal
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

from .latexlog import ParsedLog, parse as parse_log

#: The stand-in written beside a document when only part of it is being
#: built.  Named after the document rather than the project: a project can
#: have several documents building at once now -- a dissertation and its
#: supplementary information -- and one shared stand-in would have each
#: scoping build overwrite the other's, silently compiling the wrong body.
SHADOW_PREFIX = ".nexttex-preview"


def shadow_name(main: Path) -> str:
    return f"{SHADOW_PREFIX}-{main.stem}.tex"


#: What the stand-in was called when a project could only build one
#: document.  Kept solely so an upgrade can delete the file it left behind.
LEGACY_SHADOW = f"{SHADOW_PREFIX}.tex"

# TeX wraps its log at 79 columns by default, splitting messages and paths
# mid-word.  Raising the limit is what lets latexlog.py read whole lines
# instead of stitching fragments back together.
LOG_ENV = {
    "max_print_line": "1000",
    "error_line": "254",
    "half_error_line": "238",
}

INCLUDE_RE = re.compile(r"^[^%\n]*\\include\{([^}]*)\}", re.M)
INCLUDEONLY_RE = re.compile(r"^%?\s*\\includeonly\{[^}]*\}\s*$", re.M)
DOCUMENTCLASS_RE = re.compile(r"^[^%\n]*\\documentclass[^\n]*\n", re.M)

# Edits that make a one-pass build insufficient.  Citations and labels need
# the bibliography and the aux file to catch up; preamble changes can alter
# anything downstream.
# What forces the slow path is a change in the *set* of cross-reference
# targets or citation keys, not the mere presence of one.  Testing
# "does this file contain \\cite" puts every real chapter on the slow path
# forever, because every real chapter cites something.  A \\ref to a label
# that already exists resolves from the previous run's .aux on the fast
# path; only a new label or a new citation key needs biber and a second
# pass.
# Above this, a preview of the whole document stops feeling immediate and
# NextTex starts typesetting only the chapter being edited.
SCOPE_ABOVE_MS = 2000.0

CITE_KEYS = re.compile(r"\\(?:no|super|paren|text|auto)?cite[a-zA-Z]*\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}")
LABEL_KEYS = re.compile(r"\\label\s*\{([^}]*)\}")
PREAMBLE_CHANGE = re.compile(
    r"\\(?:usepackage|documentclass|newcommand|renewcommand|providecommand"
    r"|bibliography|addbibresource|printbibliography|include|input)\b"
)


def reference_fingerprint(text: str) -> tuple[frozenset[str], frozenset[str]]:
    """The citation keys and label names a file defines or refers to."""
    cites: set[str] = set()
    for group in CITE_KEYS.findall(text):
        cites.update(k.strip() for k in group.split(",") if k.strip())
    labels = {k.strip() for k in LABEL_KEYS.findall(text)}
    return frozenset(cites), frozenset(labels)


class Outcome(str, Enum):
    OK = "ok"
    ERRORS = "errors"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"
    NO_ENGINE = "no_engine"


@dataclass
class CompileResult:
    outcome: Outcome
    log: ParsedLog | None
    pdf: Path | None
    duration: float
    scope: str          # "full" or the chapter stem the build was limited to
    engine_pass: str    # "fast" (one pdflatex) or "full" (latexmk + biber)

    def as_dict(self) -> dict:
        return {
            "outcome": self.outcome.value,
            "durationMs": round(self.duration * 1000),
            "scope": self.scope,
            "enginePass": self.engine_pass,
            "pdf": str(self.pdf) if self.pdf else None,
            **(self.log.as_dict() if self.log else
               {"diagnostics": [], "errorCount": 0, "warningCount": 0, "rawTail": ""}),
        }


@dataclass
class ProjectPaths:
    root: Path
    main: Path
    build_dir: Path

    @property
    def jobname(self) -> str:
        return self.main.stem

    @property
    def pdf(self) -> Path:
        return self.build_dir / f"{self.jobname}.pdf"

    @property
    def log(self) -> Path:
        return self.build_dir / f"{self.jobname}.log"

    @property
    def shadow(self) -> Path:
        # Beside its own main file, not at the project root.  The module
        # docstring has always said the stand-in must sit beside the real
        # main file, because \include paths resolve relative to that file's
        # directory; that was only true by accident while every main file
        # was at the root.  Named after the document as well, because a
        # project may now be building more than one at a time and one shared
        # stand-in would have each scoping build compile the other's body.
        return self.main.parent / shadow_name(self.main)


def supports_partial(main_source: str) -> bool:
    """Can this document be compiled one chapter at a time?

    Only if it actually uses `\\include`.  `\\input` cannot be scoped this
    way, and guessing wrong produces a document missing its body.
    """
    return bool(INCLUDE_RE.search(main_source))


def included_targets(main_source: str) -> list[str]:
    return INCLUDE_RE.findall(main_source)


def chapter_for(path: Path, root: Path, targets: list[str]) -> str | None:
    """Which `\\include` target, if any, does this file belong to?"""
    try:
        rel = path.resolve().relative_to(root.resolve())
    except ValueError:
        return None
    stem = str(rel.with_suffix(""))
    # An exact match wins outright.
    for target in targets:
        if stem == target:
            return target
    # Otherwise the file may be a companion of an included one -- a
    # chapter's supporting information sitting beside it.  Match on the
    # containing directory, longest first, so a file under
    # chapters/02_theory/ is not attributed to chapters/01_introduction
    # merely because both live under chapters/.
    best: str | None = None
    for target in targets:
        directory = target.rsplit("/", 1)[0] if "/" in target else None
        if directory and stem.startswith(directory + "/"):
            if best is None or len(directory) > len(best.rsplit("/", 1)[0]):
                best = target
    return best


def write_shadow(paths: ProjectPaths, only: str | None) -> Path:
    """Write the stand-in main file, scoped to one chapter or to everything.

    Returns the file to hand the engine -- the real main file when no
    scoping is needed, so an ordinary full build touches nothing extra.
    """
    if only is None:
        return paths.main

    source = paths.main.read_text(encoding="utf-8", errors="replace")
    directive = f"\\includeonly{{{only}}}"
    if INCLUDEONLY_RE.search(source):
        source = INCLUDEONLY_RE.sub(lambda _m: directive, source, count=1)
    else:
        match = DOCUMENTCLASS_RE.search(source)
        if not match:
            # No \documentclass means this is not a compilable main file;
            # fall back rather than produce something broken.
            return paths.main
        source = source[: match.end()] + directive + "\n" + source[match.end():]

    paths.shadow.write_text(source, encoding="utf-8")
    return paths.shadow


class CompileScheduler:
    """Serialises builds for one project.

    Exactly one build runs at a time.  A request arriving mid-build cancels
    the one in flight rather than queueing behind it, because by the time a
    superseded build finished, its PDF would already be stale.
    """

    def __init__(self, paths: ProjectPaths, timeout: float = 120.0):
        self.paths = paths
        self.timeout = timeout
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self._generation = 0
        # Set when an edit touches citations, labels or the preamble; the
        # next build then takes the full path and clears it.
        self._needs_full = True   # the first build of a session always is
        # Bumped every time that flag is raised.  A build reads it before it
        # starts and only clears the flag if nothing raised it again while
        # the build was running -- otherwise an edit made during an eight
        # second bibliography pass had its own full rebuild cancelled by the
        # build that started before it, and the citation stayed [?].
        self._full_mark = 1
        # How long one pdflatex pass over the whole document takes here.
        # Scoping the preview to a single chapter saves about 70 ms on a
        # twenty-page document -- not worth showing the writer a fragment --
        # so it only starts once a whole-document pass stops being quick.
        self._full_fast_ms: float | None = None

    def note_edit(
        self, path: Path, text: str | None = None, previous: str | None = None
    ) -> None:
        """Record what an edit touched, so the next build picks the right path.

        `previous` is the file's contents before the edit.  Without it the
        only safe answer is "rebuild everything", so the caller should pass
        it whenever it can -- that is the difference between a one-second
        preview and a two-second one on every keystroke.
        """
        if path.suffix.lower() == ".bib":
            self._require_full()
            return
        if path.resolve() == self.paths.main.resolve():
            self._require_full()
            return
        if text is None:
            self._require_full()
            return
        if previous is None:
            # No baseline to compare against; assume the worst once.
            self._require_full()
            return
        if PREAMBLE_CHANGE.search(text) != PREAMBLE_CHANGE.search(previous):
            self._require_full()
            return
        if reference_fingerprint(text) != reference_fingerprint(previous):
            self._require_full()

    def _require_full(self) -> None:
        self._needs_full = True
        self._full_mark += 1

    async def cancel(self) -> None:
        """Stop the build in flight, including anything it spawned."""
        proc = self._process
        if proc is None or proc.returncode is not None:
            return
        try:
            # latexmk spawns pdflatex and biber; killing only the parent
            # leaves them writing into the build directory.
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            return
        try:
            await asyncio.wait_for(proc.wait(), timeout=3)
        except asyncio.TimeoutError:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass

    async def build(
        self, focus: Path | None = None, force_full: bool = False
    ) -> CompileResult:
        """Compile, scoped to `focus`'s chapter when that is possible."""
        self._generation += 1
        generation = self._generation
        await self.cancel()

        async with self._lock:
            if generation != self._generation:
                # Superseded while waiting for the lock.
                return CompileResult(Outcome.CANCELLED, None, None, 0.0, "full", "fast")
            return await self._run(focus, force_full)

    async def _run(self, focus: Path | None, force_full: bool) -> CompileResult:
        started = time.monotonic()
        self.paths.build_dir.mkdir(parents=True, exist_ok=True)

        main_source = self.paths.main.read_text(encoding="utf-8", errors="replace")
        scope = "full"
        only = None
        if (
            focus is not None
            and supports_partial(main_source)
            and not force_full
            and self._full_fast_ms is not None
            and self._full_fast_ms > SCOPE_ABOVE_MS
        ):
            target = chapter_for(focus, self.paths.root, included_targets(main_source))
            if target:
                only, scope = target, target

        source_file = write_shadow(self.paths, only)
        full_pass = force_full or self._needs_full
        mark = self._full_mark

        # \include writes one .aux per included file, mirrored under the
        # output directory; the engine will not create those directories.
        self._mirror_build_tree(main_source)

        argv = self.full_argv(source_file) if full_pass else self.fast_argv(source_file)
        env = {**os.environ, **LOG_ENV}
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                cwd=str(self.paths.root),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                env=env,
                # Its own process group, so cancel() can take the children too.
                start_new_session=True,
            )
        except FileNotFoundError:
            return CompileResult(
                Outcome.NO_ENGINE, None, None, time.monotonic() - started, scope,
                "full" if full_pass else "fast",
            )
        self._process = proc

        try:
            await asyncio.wait_for(proc.wait(), timeout=self.timeout)
        except asyncio.TimeoutError:
            await self.cancel()
            return CompileResult(
                Outcome.TIMEOUT, None, None, time.monotonic() - started, scope,
                "full" if full_pass else "fast",
            )
        finally:
            self._process = None

        if proc.returncode is not None and proc.returncode < 0:
            return CompileResult(
                Outcome.CANCELLED, None, None, time.monotonic() - started, scope,
                "full" if full_pass else "fast",
            )

        if full_pass and mark == self._full_mark:
            self._needs_full = False

        # Record whether the PDF on disk is the whole document or one scoped
        # chapter.  They are indistinguishable by timestamp, and a download
        # that silently handed over a nine-page fragment of a twenty-page
        # thesis would be worse than a slow one.
        self._note_pdf_scope(scope if scope != "full" else "")

        elapsed = (time.monotonic() - started) * 1000
        if scope == "full" and not full_pass:
            # Remember what a whole-document preview costs, so the decision
            # above is made from this document rather than from a guess.
            self._full_fast_ms = elapsed

        log = None
        if self.paths.log.exists():
            log = parse_log(
                self.paths.log.read_text(encoding="utf-8", errors="replace"),
                self.paths.root,
                self.paths.main,
            )
            self._remap_shadow(log)

        # A PDF from a previous good build is better than none: the preview
        # keeps showing the last thing that compiled rather than going blank.
        pdf = self.paths.pdf if self.paths.pdf.exists() else None
        outcome = Outcome.ERRORS if (log and log.errors) else Outcome.OK
        return CompileResult(
            outcome, log, pdf, time.monotonic() - started, scope,
            "full" if full_pass else "fast",
        )

    def full_argv(self, source_file: Path) -> list[str]:
        """latexmk with biber: citations, cross-references, the lot.

        latexmk accepts `-synctex=1` and then does not pass it on to the
        engine, so a full build produced a PDF carrying no synctex data and
        double-click navigation silently stopped working -- which is exactly
        what happens the moment a citation is added.  Handing the engine its
        own command line is the only reliable way to get it back.
        """
        return [
            "latexmk", "-pdf", "-interaction=nonstopmode", "-file-line-error",
            "-pdflatex=pdflatex -synctex=1 -interaction=nonstopmode "
            "-file-line-error %O %S",
            f"-jobname={self.paths.jobname}",
            f"-outdir={self.paths.build_dir}", str(source_file),
        ]

    def fast_argv(self, source_file: Path) -> list[str]:
        """One pdflatex pass: what an ordinary edit gets."""
        return [
            "pdflatex", "-interaction=nonstopmode", "-file-line-error",
            "-synctex=1", f"-jobname={self.paths.jobname}",
            f"-output-directory={self.paths.build_dir}", str(source_file),
        ]

    SCOPE_MARKER = ".nexttex-scope"

    @property
    def _scope_marker(self) -> Path:
        r"""Whether *this document's* PDF is whole, or an \includeonly slice.

        Namespaced by jobname.  Every other file in the build directory
        already is -- latexmk names them after the job -- but this one was
        not, so two documents sharing a build directory each read the
        other's answer, and the download route served a fragment believing
        it was the whole thing.
        """
        return self.paths.build_dir / f"{self.paths.jobname}{self.SCOPE_MARKER}"

    def _note_pdf_scope(self, scope: str) -> None:
        marker = self._scope_marker
        try:
            marker.write_text(scope, encoding="utf-8")
        except OSError:
            pass

    def pdf_is_complete(self) -> bool:
        """Was the PDF on disk produced by a build of the whole document?"""
        marker = self._scope_marker
        try:
            return marker.read_text(encoding="utf-8").strip() == ""
        except OSError:
            # No marker: an older build, or one made outside NextTex. Assume
            # the worst rather than serve a fragment.
            return False

    def _mirror_build_tree(self, main_source: str) -> None:
        for target in included_targets(main_source):
            parent = (self.paths.build_dir / target).parent
            parent.mkdir(parents=True, exist_ok=True)

    def _remap_shadow(self, log: ParsedLog) -> None:
        """Point diagnostics at the real main file, not the stand-in."""
        shadow = self.paths.shadow.resolve()
        for diagnostic in log.diagnostics:
            if diagnostic.file is not None and diagnostic.file.resolve() == shadow:
                diagnostic.file = self.paths.main

    def cleanup(self) -> None:
        self.paths.shadow.unlink(missing_ok=True)
        # The stand-in a single-document install left at the project root.
        # Harmless, but it sits in the writer's folder looking like theirs.
        (self.paths.root / LEGACY_SHADOW).unlink(missing_ok=True)

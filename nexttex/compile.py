"""Compiling LaTeX fast enough that the preview feels live.

A compile runs every time typing pauses, so the budget is about a second.
Three decisions get it there.

**Only rebuild what changed.** A document that uses `\\include` can be
compiled one chapter at a time with `\\includeonly`, which on a
seven-chapter dissertation halves the work. Whether that applies is
detected from the source, never assumed.

**Only run the bibliography when citations changed.** bibtex or biber,
whichever the document asks for, and latexmk's reruns after it, dominate a
full build. Reference resolution matters when the bibliography moves, not
on every keystroke, so the expensive path is triggered by what the edit
touched, and by a fast pass whose log says a key it could not resolve is
one the last full pass could.

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
from contextlib import asynccontextmanager
import os
import re
import signal
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Callable

from .deps import uncommented
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
    # Ask the engine not to read files outside the project.  Passed for the
    # engines that honour it, and *not* relied on, because the one this was
    # tested against does not.
    #
    # pdfTeX 3.141592653-2.6-1.40.29 (TeX Live 2026), kpathsea 6.4.2:
    # `kpsewhich --var-value=openin_any` reports the value back correctly, and
    # the engine then ignores it.  `\input{/etc/hostname}` put the file in the
    # PDF under "a", under "r" and under "p" alike, set through the
    # environment and through a `texmf.cnf` on `TEXMFCNF`; even "r", which
    # only forbids dotfiles, read a dotfile.  So this line is defence for
    # somebody else's installation and must not be described as a fence here.
    #
    # What *is* enforced everywhere tested is the other direction:
    # `openout_any` defaults to paranoid, so a document cannot write outside
    # the project.  That asymmetry is the whole shape of the remaining
    # problem, and it is written up in the tracker rather than papered over:
    # a document can read anything this user can read and write it into a
    # file *inside* the project, which on a shared project is then gossiped
    # to every peer.
    "openin_any": "p",
}

INCLUDE_RE = re.compile(r"\\include\{([^}]*)\}")
INCLUDEONLY_RE = re.compile(r"^%?\s*\\includeonly\{[^}]*\}\s*$", re.M)
DOCUMENTCLASS_RE = re.compile(r"\\documentclass[^\n]*\n")

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


#: The engines a document may ask for.  Everything downstream, the log
#: parser, synctex and the `.aux` files, is the same for all three; what
#: differs is the binary and which latexmk switch names it.
ENGINES = ("pdflatex", "xelatex", "lualatex")
DEFAULT_ENGINE = "pdflatex"
#: latexmk's mode switch and command option for each engine.  Checked
#: against latexmk 4.88's own help, where `-pdfxe` and `-pdflua` select
#: the engine and `-pdfxelatex=` and `-pdflualatex=` say how to run it.
LATEXMK_ENGINE = {
    "pdflatex": ("-pdf", "-pdflatex"),
    "xelatex": ("-pdfxe", "-pdfxelatex"),
    "lualatex": ("-pdflua", "-pdflualatex"),
}

#: `% !TeX program = xelatex`, the line every other editor honours, in its
#: TeXShop spelling `TS-program` as well.  Only the first lines of the main
#: file are read, so a mention deep in a comment does not count.
MAGIC_PROGRAM = re.compile(
    r"^\s*%\s*!\s*TeX\s+(?:TS-)?program\s*=\s*([A-Za-z]+)", re.I | re.M
)
MAGIC_LINES = 20


def engine_in(main_source: str) -> str:
    """The engine a `% !TeX program` line names, or "" when there is none
    or it names something NextTex does not run."""
    head = "\n".join(main_source.splitlines()[:MAGIC_LINES])
    found = MAGIC_PROGRAM.search(head)
    if not found:
        return ""
    name = found.group(1).lower()
    return name if name in ENGINES else ""


def engine_for(main_source: str, setting: str = "") -> str:
    """Which engine builds this document: the magic comment, then the
    project's `engine` setting, then pdflatex.

    The comment wins because it travels with the file: a paper whose
    venue hands out a font says so in its first line, and that line means
    the same thing in every editor the co-authors use.
    """
    return engine_in(main_source) or (
        setting if setting in ENGINES else DEFAULT_ENGINE
    )


@dataclass
class CompileResult:
    outcome: Outcome
    log: ParsedLog | None
    pdf: Path | None
    duration: float
    scope: str          # "full" or the chapter stem the build was limited to
    engine_pass: str    # "fast" (one engine run) or "full" (latexmk, which runs bibtex or biber as the document asks)
    engine: str = DEFAULT_ENGINE   # which of ENGINES ran, or was asked for and not found
    #: "off" when the project does not ask for shell escape, "asked" when
    #: it does and this machine has not allowed it, "on" when the flag
    #: was passed.  The drawer draws the question from "asked".
    shell_escape: str = "off"

    def as_dict(self) -> dict:
        return {
            "outcome": self.outcome.value,
            "durationMs": round(self.duration * 1000),
            "scope": self.scope,
            "enginePass": self.engine_pass,
            "engine": self.engine,
            "shellEscape": self.shell_escape,
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
    def workdir(self) -> Path:
        """Where the engine runs: the document's own directory.

        A document in a subfolder used to be compiled from the project
        root, so its `\\input`, `\\graphicspath` and `\\usepackage` of a
        local style resolved against the root, silently, and a root copy
        of a style shadowed the one beside the document.  Running from the
        document's directory is what `pdflatex x.tex` does by hand; the
        root stays reachable through `search_env`, so a root-relative path
        that worked before still works.
        """
        return self.main.parent

    def search_env(self) -> dict[str, str]:
        """TEXINPUTS, BIBINPUTS and BSTINPUTS naming the document's directory
        and then the project root, with the trailing separator that keeps
        the installation's own search path after them."""
        both = f"{self.workdir}{os.pathsep}{self.root}{os.pathsep}"
        return {"TEXINPUTS": both, "BIBINPUTS": both, "BSTINPUTS": both}

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
    return next(uncommented(INCLUDE_RE, main_source), None) is not None


def included_targets(main_source: str) -> list[str]:
    return [match.group(1) for match in uncommented(INCLUDE_RE, main_source)]


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
    #
    # A tie is not an answer. With `chapters/01_intro`, `chapters/02_theory`
    # and so on all sharing one directory, every helper file under
    # `chapters/` matched all of them equally and the loop returned
    # whichever came first, which is the first chapter. A fast build was
    # then scoped to a chapter the edited file has nothing to do with: the
    # writer's change was not in the pages that came back, and nothing said
    # why. Flat chapters are the ordinary layout, so this was the ordinary
    # case rather than an edge of one.
    #
    # `None` means "not scoped", which the caller already handles by
    # building the whole document. Slower, and right.
    best: str | None = None
    best_depth = -1
    tied = False
    for target in targets:
        directory = target.rsplit("/", 1)[0] if "/" in target else None
        if not directory or not stem.startswith(directory + "/"):
            continue
        depth = len(directory)
        if depth > best_depth:
            best, best_depth, tied = target, depth, False
        elif depth == best_depth:
            tied = True
    return None if tied else best


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
        match = next(uncommented(DOCUMENTCLASS_RE, source), None)
        if not match:
            # No \documentclass means this is not a compilable main file;
            # fall back rather than produce something broken.
            return paths.main
        source = source[: match.end()] + directive + "\n" + source[match.end():]

    paths.shadow.write_text(source, encoding="utf-8")
    return paths.shadow


class BuildQueue:
    """One build at a time across a project, the document on screen first.

    Each `CompileScheduler` already serialises itself and supersedes its own
    in-flight build. What it cannot know is that a project now has several,
    and that two of them running at once would put two `latexmk` processes in
    one build directory writing `.fdb_latexmk` and biber's temporary files
    over each other -- a class of bug that surfaces once a year and takes a
    day to find.

    So builds queue, and the visible tab jumps the queue. Wall-clock latency
    for the document somebody is actually looking at is the only latency that
    is felt, and going first serves that better than going in parallel does.

    No preemption: a running build is never abandoned for a newer one of a
    *different* document. Superseding a build of the *same* document is the
    scheduler's own business and still happens, before the queue is joined --
    see `ProjectSession.compile`, which cancels before it waits, because a
    request that queued first would otherwise be waiting for a slot held by
    the very build it means to replace.
    """

    def __init__(self, limit: int = 1) -> None:
        #: Raise to allow genuine parallelism. One is a deliberate default
        #: rather than a limitation of the design.
        self._limit = max(1, limit)
        self._active = 0
        self._waiting: list[tuple[int, int, asyncio.Future]] = []
        self._sequence = 0

    @property
    def active(self) -> int:
        return self._active

    @property
    def waiting(self) -> int:
        return len(self._waiting)

    async def _acquire(self, priority: bool) -> None:
        # `not self._waiting` matters: without it a new arrival would step in
        # front of a queue that has already formed, and a background document
        # under steady typing would never build at all.
        if self._active < self._limit and not self._waiting:
            self._active += 1
            return
        self._sequence += 1
        ticket: asyncio.Future = asyncio.get_running_loop().create_future()
        self._waiting.append((0 if priority else 1, self._sequence, ticket))
        # Priority first, then the order they arrived in.
        self._waiting.sort(key=lambda item: (item[0], item[1]))
        try:
            await ticket
        except asyncio.CancelledError:
            # Cancelled while waiting: drop the ticket. Cancelled *after* the
            # slot was handed over: give it straight back, or it is lost for
            # the life of the session.
            self._waiting = [item for item in self._waiting if item[2] is not ticket]
            if ticket.done() and not ticket.cancelled():
                self._release()
            raise

    def _release(self) -> None:
        self._active -= 1
        while self._waiting and self._active < self._limit:
            _, _, ticket = self._waiting.pop(0)
            if ticket.done():
                continue
            # Handed over rather than taken: the slot is counted here, not
            # when the woken task resumes, so nothing can slip in between.
            self._active += 1
            ticket.set_result(None)
            return

    @asynccontextmanager
    async def slot(self, *, priority: bool = False):
        await self._acquire(priority)
        try:
            yield
        finally:
            self._release()


class CompileScheduler:
    """Serialises builds for one project.

    Exactly one build runs at a time.  A request arriving mid-build cancels
    the one in flight rather than queueing behind it, because by the time a
    superseded build finished, its PDF would already be stale.
    """

    def __init__(self, paths: ProjectPaths, timeout: float = 120.0,
                 allow_rc: bool = False,
                 engine_setting: Callable[[], str] | None = None,
                 shell_escape: Callable[[], str] | None = None):
        self.paths = paths
        self.timeout = timeout
        # Whether latexmk may read a `latexmkrc` out of the project.  See
        # `full_argv`.  Off unless the install's settings turn it on.
        self.allow_rc = allow_rc
        # The project's `engine` key, asked for at each build rather than
        # copied at construction, so a change on the settings card reaches
        # the next build and not the next restart.  The main file's own
        # `% !TeX program` line wins over it; see `engine_for`.
        self.engine_setting = engine_setting or (lambda: "")
        # "off", "asked" or "on", asked at each build for the same reason
        # as the engine: the answer changes when the writer presses Allow,
        # and the build after that press is the one they are waiting for.
        # The flag itself is only ever passed on "on"; see `full_argv`.
        self.shell_escape = shell_escape or (lambda: "off")
        # The engine the last build ran.  A different one next time means
        # the `.aux` files in the build directory were written by the
        # other engine, and a fast pass over them can leave stale numbers.
        self._last_engine: str | None = None
        # The shell-escape state of the last build.  latexmk decides from
        # its own database whether the sources changed and skips the engine
        # when they did not; the flag alone is not a change it notices, so
        # the first build after Allow ran nothing and the program the
        # document named still had not run.  A change here forces a full
        # pass with `-g`, and the need for it outlives a build that was
        # cancelled on the way: Allow schedules a build and a keystroke a
        # moment later replaces it, and the replacement is the one that
        # has to carry the flag through.  An engine change needs no `-g`:
        # latexmk sees a different command and reruns on its own.
        self._last_escape: str | None = None
        self._rerun_pending = False
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
        # The citation and reference keys left undefined by the last full
        # pass.  A fast pass runs no bibtex, so a key it cannot resolve is
        # either one the bibliography does not hold, which a full pass
        # would leave undefined too, or one it does hold and the fast pass
        # simply could not reach: the difference between the two sets is
        # the second case, and it is what earns the next build a full
        # pass.  Comparing sets rather than asking "was anything
        # undefined" matters, because a genuinely misspelled key survives
        # every full pass and would otherwise make every keystroke a
        # latexmk run.
        self._unresolved_after_full: frozenset[str] | None = None

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
        generation = self._generation
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
        # From the real main file, never the stand-in: the stand-in is the
        # main file with its preamble rewritten, and the magic comment
        # sits above the preamble in the file the writer sees.
        engine = engine_for(main_source, self.engine_setting())
        if self._last_engine is not None and engine != self._last_engine:
            self._require_full()
        self._last_engine = engine
        escape = self.shell_escape()
        if self._last_escape is not None and escape != self._last_escape:
            self._rerun_pending = True
        self._last_escape = escape
        force_rerun = self._rerun_pending
        if force_rerun:
            self._require_full()
        full_pass = force_full or self._needs_full
        mark = self._full_mark

        # \include writes one .aux per included file, mirrored under the
        # output directory; the engine will not create those directories.
        self._mirror_build_tree(main_source)

        argv = (
            self.full_argv(source_file, engine, escape == "on", force=force_rerun)
            if full_pass
            else self.fast_argv(source_file, engine, escape == "on")
        )
        env = {**os.environ, **LOG_ENV, **self.paths.search_env()}
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                cwd=str(self.paths.workdir),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                env=env,
                # Its own process group, so cancel() can take the children too.
                start_new_session=True,
            )
        except FileNotFoundError:
            return CompileResult(
                Outcome.NO_ENGINE, None, None, time.monotonic() - started, scope,
                "full" if full_pass else "fast", engine, escape,
            )
        self._process = proc
        if generation != self._generation:
            # Superseded while this was starting up.  `cancel` reads
            # `_process`, and it was None for the whole of the setup above:
            # deciding the scope, writing the shadow file, mirroring the
            # build tree, spawning.  A build arriving in that window
            # cancelled nothing, and this one then ran to its two minute
            # timeout holding the lock the newer one was waiting on.
            await self.cancel()

        try:
            await asyncio.wait_for(proc.wait(), timeout=self.timeout)
        except asyncio.TimeoutError:
            await self.cancel()
            return CompileResult(
                Outcome.TIMEOUT, None, None, time.monotonic() - started, scope,
                "full" if full_pass else "fast", engine, escape,
            )
        finally:
            self._process = None

        if proc.returncode is not None and proc.returncode < 0:
            return CompileResult(
                Outcome.CANCELLED, None, None, time.monotonic() - started, scope,
                "full" if full_pass else "fast", engine, escape,
            )

        if full_pass and mark == self._full_mark:
            self._needs_full = False
        if force_rerun:
            # The engine ran to completion under the new state, so the
            # database latexmk keeps now agrees with it.
            self._rerun_pending = False

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

        # Multi-megabyte on a thesis and regex-heavy, and this is the path
        # that publishes the result to every subscriber, so parsing it inline
        # held the loop for as long as it took after every single build.
        log = await asyncio.to_thread(self._read_log)
        if log is not None:
            self._remap_shadow(log)
            self._note_unresolved(log, full_pass)

        # A PDF from a previous good build is better than none: the preview
        # keeps showing the last thing that compiled rather than going blank.
        pdf = self.paths.pdf if self.paths.pdf.exists() else None
        outcome = Outcome.ERRORS if (log and log.errors) else Outcome.OK
        return CompileResult(
            outcome, log, pdf, time.monotonic() - started, scope,
            "full" if full_pass else "fast", engine, escape,
        )

    def _note_unresolved(self, log: ParsedLog, full_pass: bool) -> None:
        """Decide from the log whether the next build must be a full one.

        The agent reported "built cleanly" with every citation a question
        mark, and it stayed that way across repeated builds: each was a
        fast pass, which runs no bibtex, and nothing read the log for the
        one fact that would have said so.
        """
        unresolved = frozenset(log.undefined_citations) | frozenset(
            log.undefined_references
        )
        if full_pass:
            self._unresolved_after_full = unresolved
            return
        if log.bibliography_stale:
            self._require_full()
            return
        if (
            self._unresolved_after_full is not None
            and unresolved != self._unresolved_after_full
        ):
            self._require_full()

    def _read_log(self) -> ParsedLog | None:
        """Read and parse the engine's log, off the loop.

        The existence check this replaces was a separate call, so a log that
        went away between the two raised out of the build.  Missing and
        unreadable are the same answer here: there is nothing to say about
        what the engine did.
        """
        try:
            text = self.paths.log.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None
        return parse_log(
            text, self.paths.root, self.paths.main, base=self.paths.workdir
        )

    def full_argv(
        self, source_file: Path, engine: str = DEFAULT_ENGINE,
        shell_escape: bool = False, force: bool = False,
    ) -> list[str]:
        """latexmk: citations through bibtex or biber, cross-references, the lot.

        latexmk accepts `-synctex=1` and then does not pass it on to the
        engine, so a full build produced a PDF carrying no synctex data and
        double-click navigation silently stopped working -- which is exactly
        what happens the moment a citation is added.  Handing the engine its
        own command line is the only reliable way to get it back.

        `-norc` is the other thing on this line worth explaining.  latexmk
        reads `latexmkrc` and then `.latexmkrc` out of the directory it is
        run in, and this is run in the document's own directory inside the
        project: that file is arbitrary Perl, executed by a build that the
        editor starts on its own a second and a half after somebody stops
        typing.  A project is not always the
        writer's own work -- cloned, from a template, from a collaborator --
        so the file arriving is not a strange thing to imagine.

        Turning it back on is a setting on the install rather than on the
        project, because a project carrying permission to run its own code
        is the same hole with an extra step.

        `-shell-escape` is the same question with a different answer.
        minted and pythontex genuinely need it, so a project may ask for
        it in `nexttex.toml`; but the flag is passed only when this
        machine has said yes to this project, which is the `shell_escape`
        callable's "on".  The engine's own line inside latexmk's option
        carries the flag too, because that is the line that runs it.
        """
        # latexmk names each engine twice: a mode switch that picks it
        # and an option that says how to run it.  The inner flags are the
        # same for all three engines.
        mode, command = LATEXMK_ENGINE[engine]
        flag = " -shell-escape" if shell_escape else ""
        argv = ["latexmk", mode, "-interaction=nonstopmode", "-file-line-error"]
        if shell_escape:
            argv.append("-shell-escape")
        if force:
            # Run the engine whether or not latexmk thinks the sources
            # changed; see `_last_escape`.
            argv.append("-g")
        if not self.allow_rc:
            argv.append("-norc")
        argv += [
            f"{command}={engine}{flag} -synctex=1 -interaction=nonstopmode "
            "-file-line-error %O %S",
            f"-jobname={self.paths.jobname}",
            f"-outdir={self.paths.build_dir}", str(source_file),
        ]
        return argv

    def fast_argv(
        self, source_file: Path, engine: str = DEFAULT_ENGINE,
        shell_escape: bool = False,
    ) -> list[str]:
        """One engine pass: what an ordinary edit gets."""
        return [
            engine, *(["-shell-escape"] if shell_escape else []),
            "-interaction=nonstopmode", "-file-line-error",
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

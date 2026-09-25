"""The passes of a full build, for a machine where latexmk cannot run.

latexmk is a Perl script. TeX Live and TinyTeX bring their own Perl; MiKTeX
does not, and on the owner's laptop on 24 September 2026 its latexmk died
with "The script engine could not be found. scriptEngine=perl". So on a
MiKTeX machine with no Perl, the full build runs this instead, as the one
process the scheduler starts, so its timeout and its cancel end it the way
they end latexmk.

What it decides is latexmk's usual: the engine; then biber when the run
wrote a `.bcf`, or bibtex when the `.aux` names a bibliography; then the
engine again while the log asks for a rerun; four engine runs at most.
The fast pass is one engine run already and never comes here.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

MAX_RUNS = 4
#: What a log says when the page it made is not the page it would make now.
RERUN = re.compile(
    r"Rerun to get|Label\(s\) may have changed|Please \(re\)run Biber|"
    r"Please rerun LaTeX|Rerun LaTeX|There were undefined references"
)
BIBDATA = re.compile(r"\\bibdata\{")


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def wants_bibliography(outdir: Path, job: str) -> str | None:
    """"biber", "bibtex", or None, from what the first run left."""
    if (outdir / f"{job}.bcf").exists():
        return "biber"
    if BIBDATA.search(_read(outdir / f"{job}.aux")):
        return "bibtex"
    return None


def wants_rerun(outdir: Path, job: str) -> bool:
    return bool(RERUN.search(_read(outdir / f"{job}.log")))


def build(engine_argv: list[str], outdir: Path, job: str, run) -> int:
    """Run the passes; `run(argv, cwd)` returns an exit code. Returns the
    last engine run's code, which is what latexmk's would reflect."""
    code = run(engine_argv, None)
    runs = 1
    tool = wants_bibliography(outdir, job)
    if tool == "biber":
        run(["biber", "--input-directory", str(outdir), "--output-directory", str(outdir), job], None)
    elif tool == "bibtex":
        # In the build directory, where the .aux is; BIBINPUTS, set by the
        # caller, finds the .bib beside the document.
        run(["bibtex", job], outdir)
    if tool:
        code = run(engine_argv, None)
        runs += 1
    while runs < MAX_RUNS and wants_rerun(outdir, job):
        code = run(engine_argv, None)
        runs += 1
    return code


def _run(argv: list[str], cwd: Path | None) -> int:
    # This is a Python of its own, without the server's rule that children
    # open no window (`nexttex/winproc.py`), so it says so for its own.
    flags = 0x08000000 if sys.platform == "win32" else 0
    try:
        return subprocess.run(
            argv, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags,
        ).returncode
    except FileNotFoundError:
        # No biber on this MiKTeX, say: the next engine run says what is
        # missing in the log, which is where NextTex reads it.
        return 127


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="nexttex.passes")
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--jobname", required=True)
    parser.add_argument("engine_argv", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    engine = [a for a in args.engine_argv if a != "--"]
    return build(engine, Path(args.outdir), args.jobname, _run)


if __name__ == "__main__":
    sys.exit(main())

"""The program a writer's script is run by, and the one file here that runs
in the child interpreter rather than in the server.

`python script_runner.py scripts/fig.py` behaves like `python scripts/fig.py`
with one addition: what the script draws is kept.  Every `pyplot.show()`
saves the open figures into the capture directory and closes them, so a
script written for a screen shows its plots in the pane instead of in a
window that will never open; every `savefig` is noted, so the pane can say
which files in the project a run wrote; and a figure still open at exit,
which is a script that forgot to save and never called show, or one that
crashed after drawing, is captured too.  Standard library only at import,
because it has to start whether or not matplotlib is installed, and it
imports nothing of NextTex: the script's own directory replaces this one at
the front of `sys.path`, so a project's `config.py` shadows nothing here and
nothing here shadows the project's.

Nothing is imported eagerly.  A script that never plots pays nothing for
this file being in front of it: matplotlib is patched from a `meta_path`
hook that fires when the script's own import finishes, and a `module://`
backend was not the answer, because the seeded `figure.py` calls
`matplotlib.use("Agg")` itself and would override it.  Patching `pyplot.show`
after the fact is the one thing that survives that.

Written by the runner, read by `plots.run`:

    <capture dir>/figure-1.png, figure-2.png, ...   what `show()` and exit saw
    <capture dir>/capture.json                       {"figures": [...], "saved": [...]}
"""

from __future__ import annotations

import importlib.abc
import json
import os
import runpy
import sys
import traceback
from pathlib import Path

CAPTURE_ENV = "NEXTTEX_CAPTURE_DIR"
DPI = 150


class _Capture:
    """What has been kept so far, and where it goes."""

    def __init__(self, directory: Path | None) -> None:
        self.directory = directory
        self.figures: list[str] = []
        self.saved: list[str] = []
        self.pyplot = None

    def enabled(self) -> bool:
        return self.directory is not None

    def snapshot(self) -> None:
        """Save every open figure, in order, and close it."""
        plt = self.pyplot
        if plt is None or self.directory is None:
            return
        self._capturing = True
        try:
            for number in list(plt.get_fignums()):
                figure = plt.figure(number)
                name = f"figure-{len(self.figures) + 1}.png"
                try:
                    figure.savefig(self.directory / name, dpi=DPI)
                except Exception:  # noqa: BLE001  a figure that cannot be drawn is not a run that failed
                    continue
                self.figures.append(name)
                plt.close(figure)
        finally:
            self._capturing = False

    def note_saved(self, target) -> None:
        # The snapshot above goes through the same patched savefig, and
        # its own files are not something the script wrote.
        if getattr(self, "_capturing", False):
            return
        if isinstance(target, (str, os.PathLike)):
            self.saved.append(os.path.abspath(os.fspath(target)))

    def write(self) -> None:
        if self.directory is None:
            return
        try:
            (self.directory / "capture.json").write_text(
                json.dumps({"figures": self.figures, "saved": self.saved}),
                encoding="utf-8",
            )
        except OSError:
            pass


CAPTURE = _Capture(None)


class _AfterImport(importlib.abc.MetaPathFinder):
    """Patch matplotlib the moment the script imports it, and not before.

    The spec comes from the finders behind this one, and its loader is
    wrapped so the patch runs the moment `exec_module` returns.  Importing
    the module from inside `find_spec` and answering None was the first
    attempt, and it patched a module the import machinery then loaded a
    second time and handed to the script unpatched.
    """

    def find_spec(self, name, path=None, target=None):
        if name not in ("matplotlib.pyplot", "matplotlib.figure"):
            return None
        for finder in sys.meta_path:
            if finder is self:
                continue
            find = getattr(finder, "find_spec", None)
            if find is None:
                continue
            spec = find(name, path, target)
            if spec is not None:
                break
        else:
            return None
        loader = spec.loader
        if loader is None or not hasattr(loader, "exec_module"):
            return spec
        original = loader.exec_module

        def exec_module(module):
            original(module)
            # pyplot imports figure on its way in, so both are patched here
            # whichever the script asked for first.
            if name == "matplotlib.pyplot":
                _patch_pyplot(module)
            _patch_figure(sys.modules.get("matplotlib.figure"))

        spec.loader = _Loader(loader, exec_module)
        return spec


class _Loader(importlib.abc.Loader):
    """The real loader with one method replaced."""

    def __init__(self, inner, exec_module) -> None:
        self._inner = inner
        self._exec = exec_module

    def create_module(self, spec):
        return self._inner.create_module(spec)

    def exec_module(self, module):
        self._exec(module)

    def __getattr__(self, name):
        return getattr(self._inner, name)


def _patch_pyplot(plt) -> None:
    CAPTURE.pyplot = plt
    original = plt.show

    def show(*args, **kwargs):
        CAPTURE.snapshot()
        # Under Agg this returns at once; kept so a script that reads its
        # return value sees what it would have.
        return original(*args, **kwargs)

    plt.show = show


def _patch_figure(module) -> None:
    if module is None or getattr(module, "_nexttex_patched", False):
        return
    module._nexttex_patched = True
    figure_class = module.Figure
    original = figure_class.savefig

    def savefig(self, fname, *args, **kwargs):
        result = original(self, fname, *args, **kwargs)
        CAPTURE.note_saved(fname)
        return result

    figure_class.savefig = savefig


def _at_end() -> None:
    """Figures the script left open: never saved, never shown.

    Also the crash-after-drawing case, since this runs on the way out of
    an uncaught exception too.  Called from `main` rather than registered
    with `atexit`: pyplot registers its own handler when it is imported,
    which is after this file started, so it would run first and close
    every figure before this looked.
    """
    if CAPTURE.pyplot is None and "matplotlib.pyplot" in sys.modules:
        CAPTURE.pyplot = sys.modules["matplotlib.pyplot"]
    CAPTURE.snapshot()
    CAPTURE.write()


def _print_traceback(error: BaseException) -> None:
    """The script's own frames, and none of this file's."""
    frames = traceback.extract_tb(error.__traceback__)
    here = os.path.abspath(__file__)
    kept = [frame for frame in frames if os.path.abspath(frame.filename) != here]
    # runpy's own frames sit between this file and the script.
    kept = [frame for frame in kept if "runpy" not in os.path.basename(frame.filename)]
    sys.stderr.write("Traceback (most recent call last):\n")
    sys.stderr.write("".join(traceback.format_list(kept)))
    sys.stderr.write("".join(traceback.format_exception_only(type(error), error)))
    sys.stderr.flush()


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        sys.stderr.write("usage: script_runner.py SCRIPT\n")
        return 2
    script = os.path.abspath(argv[1])
    directory = os.environ.get(CAPTURE_ENV)
    if directory:
        CAPTURE.directory = Path(directory)
        try:
            CAPTURE.directory.mkdir(parents=True, exist_ok=True)
        except OSError:
            CAPTURE.directory = None
    # Exactly what `python scripts/fig.py` gives: the script's directory
    # first on the path, in place of this file's, and its own argv.
    sys.path[0] = os.path.dirname(script)
    sys.argv = [script]
    if CAPTURE.enabled():
        sys.meta_path.insert(0, _AfterImport())
    try:
        runpy.run_path(script, run_name="__main__")
    except SystemExit as stop:
        code = stop.code
        if code is None:
            return 0
        if isinstance(code, int):
            return code
        sys.stderr.write(f"{code}\n")
        return 1
    except BaseException as error:  # noqa: BLE001  it is the script's, and it is reported whole
        _print_traceback(error)
        return 1
    finally:
        if CAPTURE.enabled():
            _at_end()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

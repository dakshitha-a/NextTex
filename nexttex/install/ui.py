"""Everything the installer puts on the screen, and the one place it starts
a child process.

The second half of that sentence is the point.  The PowerShell installer
called pip, uv, winget and npm without checking `$LASTEXITCODE` after any of
them, so a failed dependency install walked on to "Ready" and the person was
told everything had worked.  That was not twelve missing checks, it was
twelve call sites; here there is one, `run`, and it cannot forget.

Nothing in this module imports anything outside the standard library.  The
installer runs on whatever interpreter the bootstrap found, before there is
a virtual environment.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

# The braille spinner, and the plain one for a console that cannot print it.
# Which one is used is decided by probing the stream's own encoding rather
# than by asking what platform this is: a Windows terminal set to UTF-8 gets
# the good one, and a Linux terminal under LANG=C does not get a traceback.
FANCY_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
PLAIN_FRAMES = "|/-\\"


@dataclass
class Result:
    """What happened when a child process ran."""

    ok: bool
    code: int
    seconds: float
    output: list[str] = field(default_factory=list)

    @property
    def tail(self) -> list[str]:
        return self.output[-30:]


def _supports(stream, text: str) -> bool:
    encoding = getattr(stream, "encoding", None) or "ascii"
    try:
        text.encode(encoding)
    except (UnicodeEncodeError, LookupError):
        return False
    return True


def _enable_vt(stream) -> bool:
    r"""Turn on escape-sequence handling for a Windows console.

    Without it `\x1b[2K` is four visible characters rather than a cleared
    line, so the progress display would scribble over itself.  A console
    that refuses gets no escapes at all: the caller falls back to spaces.
    """
    if os.name != "nt":
        return True
    try:
        import ctypes

        handle = ctypes.windll.kernel32.GetStdHandle(-11)
        mode = ctypes.c_ulong()
        if not ctypes.windll.kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            return False
        return bool(
            ctypes.windll.kernel32.SetConsoleMode(handle, mode.value | 0x0004)
        )
    except Exception:
        return False


class Console:
    """The screen, and what it can and cannot do.

    `animate` is the whole difference between the two output modes.  When it
    is false -- a pipe, a Dockerfile, CI, or `--plain` -- nothing is ever
    redrawn and no carriage return is emitted.  That is not only tidiness:
    `_STEPS` in server/main.py reads the update script's output line by line
    out of a pipe and matches substrings in it to name the step the in-app
    update footer is showing, and a spinner in that stream would arrive as
    one enormous line.
    """

    def __init__(self, stream=None, plain: bool = False, log: Path | None = None):
        self.stream = stream if stream is not None else sys.stdout
        try:
            isatty = bool(self.stream.isatty())
        except Exception:
            isatty = False
        self.animate = isatty and not plain and not os.environ.get("CI")
        self.unicode = _supports(self.stream, FANCY_FRAMES + "✓✗─")
        self.frames = FANCY_FRAMES if self.unicode else PLAIN_FRAMES
        self.escapes = self.animate and _enable_vt(self.stream)
        self.colour = self.escapes
        self.tick = "✓" if self.unicode else "ok"
        self.cross = "✗" if self.unicode else "!!"
        self.bullet = "·" if self.unicode else "-"
        self.dash = "─" if self.unicode else "-"
        self.log = log
        self._log_handle = None

    # -- plain output -------------------------------------------------------

    def write(self, text: str = "") -> None:
        self.stream.write(text + "\n")
        self.stream.flush()

    def bold(self, text: str) -> str:
        return f"\033[1m{text}\033[0m" if self.colour else text

    def red(self, text: str) -> str:
        return f"\033[31m{text}\033[0m" if self.colour else text

    def dim(self, text: str) -> str:
        return f"\033[2m{text}\033[0m" if self.colour else text

    def say(self, text: str) -> None:
        self.write("")
        self.write("  " + self.bold(text))

    def note(self, text: str = "") -> None:
        self.write(("    " + text).rstrip())

    def paragraph(self, text: str, lead: str = "") -> None:
        """Prose, wrapped to the window rather than to a guess about it.

        Hand-broken lines are wrong on every terminal except the one they
        were written in: too long in a narrow window, and a ragged column
        down the left of a wide one.
        """
        import textwrap

        room = max(24, min(self.width - 2, 78) - 4 - len(lead))
        for line in textwrap.wrap(text, room) or [""]:
            self.note(lead + line)

    def rule(self, title: str = "") -> None:
        width = min(self.width, 74)
        if title:
            self.write("")
            self.write("  " + self.bold(title))
        self.write("  " + self.dash * (width - 2))

    @property
    def width(self) -> int:
        try:
            return max(40, shutil.get_terminal_size((80, 24)).columns)
        except Exception:
            return 80

    # -- the log ------------------------------------------------------------

    def log_line(self, text: str) -> None:
        """Append to the install log, which is what a bug report needs.

        Never a carriage return and never an escape sequence: the log is
        read afterwards in a text editor, not watched.
        """
        if self.log is None:
            return
        try:
            if self._log_handle is None:
                self.log.parent.mkdir(parents=True, exist_ok=True)
                self._log_handle = self.log.open(
                    "a", encoding="utf-8", errors="replace"
                )
            self._log_handle.write(text.rstrip("\r\n") + "\n")
            self._log_handle.flush()
        except OSError:
            self.log = None

    # -- running things -----------------------------------------------------

    def run(
        self,
        label: str,
        argv: list,
        *,
        cwd=None,
        env: dict | None = None,
        counter: str = "",
        shell_input: str | None = None,
    ) -> Result:
        prefix = f"  {counter} " if counter else "  "
        self.log_line("$ " + " ".join(str(a) for a in argv))
        started = time.monotonic()
        lines: deque = deque(maxlen=200)
        kept: list = []

        if not self.animate:
            # Byte-compatible with what `step`/`done_step` printed in the
            # shell installer, and with what update.sh prints, because
            # something downstream reads these lines.
            self.write(f"{prefix}{label} ...")

        try:
            process = subprocess.Popen(
                [str(a) for a in argv],
                cwd=str(cwd) if cwd else None,
                env=env,
                stdin=subprocess.PIPE if shell_input is not None else subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                # Not optional.  tlmgr and the TinyTeX installer emit bytes
                # that are not UTF-8 on a Windows console, and a
                # UnicodeDecodeError raised in the reader thread below would
                # kill the progress display in the middle of a step.
                errors="replace",
            )
        except OSError as error:
            self._settle(prefix, label, 0.0, ok=False, detail=str(error))
            self.log_line(f"! {error}")
            return Result(False, 127, 0.0, [str(error)])

        def reader() -> None:
            for line in process.stdout:
                line = line.rstrip("\n")
                lines.append(line)
                kept.append(line)
                self.log_line(line)
                if not self.animate:
                    self.write("      " + line)

        thread = threading.Thread(target=reader, daemon=True)
        thread.start()
        if shell_input is not None and process.stdin is not None:
            try:
                process.stdin.write(shell_input)
                process.stdin.close()
            except OSError:
                pass

        step = 0
        try:
            while process.poll() is None:
                if self.animate:
                    self._draw(
                        prefix,
                        label,
                        started,
                        self.frames[step % len(self.frames)],
                        lines[-1] if lines else "",
                    )
                    step += 1
                time.sleep(0.1)
        except KeyboardInterrupt:
            process.terminate()
            self._clear()
            raise
        finally:
            if self.animate:
                self._clear()
        thread.join(timeout=2)
        seconds = time.monotonic() - started
        ok = process.returncode == 0
        self._settle(prefix, label, seconds, ok=ok)
        return Result(ok, process.returncode or 0, seconds, kept)

    def _draw(self, prefix: str, label: str, started: float, frame: str,
              tail: str) -> None:
        elapsed = _clock(time.monotonic() - started)
        head = f"{prefix}{frame} {label}  ({elapsed})  "
        room = self.width - len(head) - 1
        if room > 8 and tail:
            head += tail[:room]
        if self.escapes:
            self.stream.write("\r\033[2K" + head)
        else:
            self.stream.write("\r" + head.ljust(self.width - 1))
        self.stream.flush()

    def _clear(self) -> None:
        if self.escapes:
            self.stream.write("\r\033[2K")
        else:
            self.stream.write("\r" + " " * (self.width - 1) + "\r")
        self.stream.flush()

    def _settle(self, prefix: str, label: str, seconds: float, *, ok: bool,
                detail: str = "") -> None:
        took = f"  ({_clock(seconds)})" if seconds >= 1 else ""
        if self.animate:
            mark = self.tick if ok else self.red(self.cross)
            self.write(f"{prefix}{mark} {label}{took}")
        else:
            self.write(f"{prefix}{label}{took}" + ("" if ok else "  FAILED"))
        if detail:
            self.note(detail)

    def skipped(self, label: str, why: str = "", counter: str = "") -> None:
        prefix = f"  {counter} " if counter else "  "
        self.write(f"{prefix}{self.bullet} {label}" + (f" -- {why}" if why else ""))

    def done(self, label: str, counter: str = "") -> None:
        prefix = f"  {counter} " if counter else "  "
        mark = self.tick if self.animate else ""
        self.write(f"{prefix}{mark} {label}".replace("  ", "  ", 1))

    def failed(self, result: Result, advice: str = "") -> None:
        """What a failing step leaves on the screen.

        The captured output, not a summary of it: whatever pip actually said
        is the only thing that explains why pip stopped.
        """
        self.write("")
        width = min(self.width, 74)
        self.note(self.dash * 4 + " the last lines of its output "
                  + self.dash * max(4, width - 38))
        for line in result.tail:
            self.note("  " + line[: width - 6])
        self.note(self.dash * max(8, width - 4))
        self.write("")
        if advice:
            for line in advice.splitlines():
                self.paragraph(line) if len(line) > 60 else self.note(line)
        if self.log is not None:
            self.note(f"All of it: {self.log}")
        self.paragraph("Run the installer again once that is sorted. It picks "
                       "up where it left off and touches nothing you have made.")

    # -- asking -------------------------------------------------------------

    def ask(self, prompt: str, default: str = "") -> str:
        """One line of input, or the default when there is nobody there.

        Reading from stdin, which the bootstrap has already pointed at
        /dev/tty when the script arrived through a pipe: under `curl | sh`
        stdin *is* the installer and is exhausted by now, so a bare input()
        would see EOF at the first question.
        """
        if not self.animate:
            return default
        try:
            self.stream.write(prompt)
            self.stream.flush()
            reply = input()
        except (EOFError, KeyboardInterrupt):
            self.write("")
            return default
        return reply.strip() or default


def _clock(seconds: float) -> str:
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    return f"{seconds // 60}m {seconds % 60:02d}s"

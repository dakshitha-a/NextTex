"""Running a project's scripts from the source pane, and remembering what
each one last did.

A script run from the editor is the same run the agent's plot tool makes,
through `plots.run`, with two things around it: the run is announced on
the event stream so the pane in every window follows it, and its result
is kept under `.nexttex/runs/` so the pane can show the last run when the
script is opened again tomorrow.  The agent's own runs go through here as
well, so a figure the agent drew is in the pane too.

One run per script at a time.  A second run of the same script cancels
the first, which `plots.run` turns into a kill of the process group, and
the pane sees a `script_start` for the new run and a single `script_done`.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import shutil
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

from . import plots

#: Scripts running at once, across every project on this server. One run
#: per script was the only limit, so a model asked to draw twenty figures
#: could start twenty interpreters (Q-007). A rerun of a script that is
#: running replaces it and is not counted twice.
AT_ONCE = 3
_EVERYWHERE: set[asyncio.Task] = set()

RUNS = "runs"
RESULT = "result.json"

#: What a captured figure may be called.  The same rule `plots.captured`
#: applies when it reads the runner's manifest, so a name that reaches the
#: route has passed it twice.
FIGURE_NAME = plots.FIGURE_NAME


def slug(relative: str) -> str:
    """A directory name for a script's runs: readable, and unique.

    The path with its separators folded, plus a short hash of the whole,
    because `a/b.py` and `a_b.py` must not share a directory and a name
    the writer can read in `.nexttex/runs/` is worth keeping.
    """
    digest = hashlib.sha1(relative.encode("utf-8")).hexdigest()[:8]
    flat = re.sub(r"[^A-Za-z0-9._-]+", "_", relative.replace("/", "__"))
    return f"{flat[:60]}-{digest}"


#: How output is batched on its way to the event stream: at most one
#: frame per stream per this many seconds, or sooner once this many
#: characters have gathered.  The reader stops handing chunks over at the
#: 64 kB clip per stream, so a run publishes at most 128 kB in all; the
#: timer bounds the frame rate for a script printing a line at a time, so
#: ten thousand short lines in a second are ten or twenty frames and not
#: ten thousand, which is what would fill a subscriber's queue.
OUTPUT_EVERY = 0.1
OUTPUT_BATCH = 4 * 1024


class _Output:
    """What a run has printed so far, and the batching of its announcement."""

    def __init__(
        self,
        publish: Callable[[dict], Awaitable[None]],
        relative: str,
        run_id: int,
        live: dict,
    ) -> None:
        self.publish = publish
        self.relative = relative
        self.run_id = run_id
        #: The whole of it so far, shared with `last()` so a window that
        #: opens the script mid-run sees what has been printed.
        self.live = live
        self.pending: dict[str, list[str]] = {"out": [], "err": []}
        self.size = 0
        self.timer: asyncio.TimerHandle | None = None
        self.tasks: list[asyncio.Task] = []

    def __call__(self, stream: str, text: str) -> None:
        self.live[stream] += text
        self.pending[stream].append(text)
        self.size += len(text)
        if self.size >= OUTPUT_BATCH:
            self.flush()
        elif self.timer is None:
            self.timer = asyncio.get_running_loop().call_later(OUTPUT_EVERY, self.flush)

    def flush(self) -> None:
        if self.timer is not None:
            self.timer.cancel()
            self.timer = None
        for stream in ("out", "err"):
            text = "".join(self.pending[stream])
            if not text:
                continue
            # Tasks made in order run in order on one loop, so the frames
            # stay in the order the output arrived.
            self.tasks.append(asyncio.ensure_future(self.publish({
                "type": "script_output", "script": self.relative,
                "run": self.run_id, "stream": stream, "text": text,
            })))
        self.pending = {"out": [], "err": []}
        self.size = 0

    async def close(self) -> None:
        """Send what is left, and wait for it to have gone, so no output
        frame trails the run's own done frame."""
        self.flush()
        if self.tasks:
            await asyncio.gather(*self.tasks, return_exceptions=True)
        self.tasks = []


class ScriptRuns:
    """The runs of one project's scripts."""

    def __init__(
        self,
        root: Path,
        state_dir: Path,
        publish: Callable[[dict], Awaitable[None]],
        before_run: Callable[[], Any] | None = None,
    ) -> None:
        self.root = root
        self.state_dir = state_dir
        self.publish = publish
        #: Called before every run: the session flushes its shared
        #: documents, since the disk trails the editor by the debounce and
        #: the script the writer just edited has to be the one that runs.
        self.before_run = before_run
        self._running: dict[str, asyncio.Task] = {}
        self._run_ids: dict[str, int] = {}
        #: What each run in flight has printed so far.
        self._live: dict[str, dict] = {}

    def directory(self, relative: str) -> Path:
        return self.state_dir / RUNS / slug(relative)

    def running(self, relative: str) -> bool:
        task = self._running.get(relative)
        return task is not None and not task.done()

    async def run(self, relative: str, by: str = "writer") -> dict:
        """Run one script, announce it, keep its result, and answer it."""
        previous = self._running.get(relative)
        replacing = previous is not None and not previous.done()
        busy = sum(1 for task in _EVERYWHERE if not task.done())
        if not replacing and busy >= AT_ONCE:
            # Not started, and said in the strip where the run's outcome
            # goes; the answer is a result so the agent reads it too.
            return {
                "script": relative, "by": by, "ok": False, "code": -1,
                "out": "", "err": f"Not run: {busy} scripts are running. Try again when one has finished.",
                "busy": busy, "figures": [], "saved": [], "stopped": False,
            }
        if replacing:
            previous.cancel()
            try:
                await previous
            except (asyncio.CancelledError, Exception):  # noqa: BLE001  the old run's failure is not this run's
                pass
        task = asyncio.ensure_future(self._run(relative, by))
        self._running[relative] = task
        _EVERYWHERE.add(task)
        try:
            return await task
        finally:
            _EVERYWHERE.discard(task)
            if self._running.get(relative) is task:
                self._running.pop(relative, None)

    async def _run(self, relative: str, by: str) -> dict:
        if self.before_run is not None:
            self.before_run()
        run_id = self._run_ids.get(relative, 0) + 1
        self._run_ids[relative] = run_id
        directory = self.directory(relative)
        # Each run starts clean, so a figure from last time cannot be
        # mistaken for one from this time.
        shutil.rmtree(directory, ignore_errors=True)
        directory.mkdir(parents=True, exist_ok=True)
        started = time.time()
        await self.publish({
            "type": "script_start", "script": relative, "run": run_id, "by": by,
        })
        live = {"run": run_id, "out": "", "err": ""}
        self._live[relative] = live
        output = _Output(self.publish, relative, run_id, live)
        try:
            try:
                result = await plots.run(
                    self.root, self.state_dir, self.root / relative,
                    capture=directory, on_output=output,
                )
            finally:
                # Before the done frame on either branch, so nothing printed
                # arrives after the run has been announced as over.
                await output.close()
                if self._live.get(relative) is live:
                    self._live.pop(relative, None)
        except asyncio.CancelledError:
            await self.publish({
                "type": "script_done", "script": relative, "run": run_id, "by": by,
                "ok": False, "code": -1, "out": live["out"], "err": "Stopped.",
                "stopped": True, "figures": [], "saved": [],
                "duration_ms": int((time.time() - started) * 1000),
            })
            raise
        result = {
            **result,
            "script": relative, "run": run_id, "by": by, "started": started,
            "stopped": False,
        }
        try:
            (directory / RESULT).write_text(json.dumps(result), encoding="utf-8")
        except OSError:
            pass
        await self.publish({"type": "script_done", **result})
        return result

    def snapshot(self) -> dict:
        """Which scripts are running, as the event stream's first frames
        say it: a stream that dropped during a run came back with the tab
        saying Running for ever, since `script_done` went out while it was
        away and nothing else lowers the flag (Q-034)."""
        return {
            "type": "script_state",
            "running": sorted(path for path in self._running if self.running(path)),
        }

    async def stop(self, relative: str) -> bool:
        """End the run in flight, if there is one.  True if there was."""
        task = self._running.get(relative)
        if task is None or task.done():
            return False
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        return True

    def last(self, relative: str) -> dict | None:
        """What the script did the last time it ran here, or None."""
        try:
            data = json.loads(
                (self.directory(relative) / RESULT).read_text(encoding="utf-8")
            )
        except (OSError, ValueError):
            data = None
        if data is not None and not isinstance(data, dict):
            data = None
        if data is None:
            if not self.running(relative):
                return None
            data = {"script": relative}
        answer = {**data, "running": self.running(relative)}
        # What the run in flight has printed so far, nested rather than in
        # place of `out`, so a previous run's whole result still comes
        # through beside it and the browser can tell the two apart.
        live = self._live.get(relative)
        if answer["running"] and live is not None:
            answer["live"] = dict(live)
        return answer

    def figure(self, relative: str, name: str) -> Path | None:
        """A captured figure of the last run, or None."""
        if not FIGURE_NAME.match(name):
            return None
        target = self.directory(relative) / name
        return target if target.is_file() else None

    async def close(self) -> None:
        for relative in list(self._running):
            await self.stop(relative)

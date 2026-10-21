"""The install's own record of how it is doing, kept while it runs.

The journal holds warnings and tracebacks and nothing else, which answers
"what broke" and never "what was slow", "what was the browser seeing" or
"was it getting worse". This is the rest: one JSON object per line in
`diagnostics.log` in the state directory, rotated at five megabytes and
kept to five files, so a week of use is there for a review and a year of it
cannot fill the disk.

What it holds, by `kind`:

- `start` and `stopped`: each server's life, the stop with the reason
  `lifeline` was given, so an update restart and a crash read differently.
- `log`: every warning and worse any logger raised, with its traceback.
- `exception`: what nothing caught, on the loop, a thread, or the process.
- `lag`: a second in which the event loop was held for more than a quarter
  of one, with the requests that were in flight.
- `sample`: each minute, memory, file descriptors, threads, child
  processes, CPU and load, and whatever gauges the app registered.
- `routes`: each five minutes, per route template, the count, the failures
  and the 50th and 95th percentile and the longest time.
- `request`: a single request that failed with a 5xx or was slow.
- `build`, `turn`, `socket`, `sync-slow`, `client`: a finished build, a
  finished agent turn, an editing socket's end, a slow editing message,
  and what the browser reported.

Nothing is written until `install` is called, which `server/run.py` does
and the tests do only where they mean to, so importing the app writes
nothing. Every string passes through `report.redact` first, the same pass
a bug report gets, so the token and the home directory never land here.
"""

from __future__ import annotations

import asyncio
import json
import logging
import logging.handlers
import os
import sys
import threading
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from . import report

FILE = "diagnostics.log"
MAX_BYTES = 5 * 1024 * 1024
#: Rotated files kept beside the live one: five in all.
BACKUPS = 4

#: How often the loop is asked to wake, and how late it may be before that
#: is worth a line.
LAG_EVERY = 1.0
LAG_NOTE = 0.25
SAMPLE_EVERY = 60.0
ROUTES_EVERY = 300.0

#: A request slower than this gets its own line.
SLOW_REQUEST = 2.0
#: Routes that wait on a build, a model, the network or a large copy, and
#: are slow by design; they get a line only past this.
SLOW_BY_DESIGN = 60.0
LONG_ROUTES = (
    "/compile", "/agent/ask", "/scripts/run", "/library/", "/tex/install",
    "/claude/install", "/claude/login", "/api/update", "/history/export",
    "/download", "/submit", "/context/distill", "/bib/fix", "/equation",
    "/git/", "/upload", "/collab/", "/api/host", "/previews", "/duplicate",
    "/relocate", "/api/projects/create", "/open", "/export",
)
#: Answers a route gives by design, which are not failures: the PDF route
#: answers 503 while a build is rewriting the file, and the page keeps the
#: one it has. The first review counted it as a server error.
EXPECTED = {("GET", "/api/projects/{project_id}/pdf", 503)}
#: An editing message that held the loop for this long.
SLOW_MESSAGE = 0.25
#: Durations kept per route per window; past this every other one is kept,
#: which keeps the percentiles honest and the memory bounded.
KEEP_PER_ROUTE = 4000

_logger = logging.getLogger("nexttex.diag")
_logger.propagate = False
_logger.setLevel(logging.INFO)

_secrets: list[str] = []
_home = ""
_hooks: dict[str, Any] = {}
_copy: logging.Handler | None = None
_file: logging.Handler | None = None

#: Name to callable, read at each sample: `server/main.py` registers the
#: open sessions, the event-stream watchers and the like.
gauges: dict[str, Callable[[], Any]] = {}

#: Requests being answered now, id to (scope, started), so a lag line can
#: say what was running when the loop stalled.
inflight: dict[int, tuple[dict, float]] = {}

_routes: dict[str, dict] = {}
_routes_since = time.monotonic()


def active() -> bool:
    return _file is not None


def _clean(value: Any) -> Any:
    if isinstance(value, str):
        return report.redact(value, _secrets, _home)
    if isinstance(value, dict):
        return {str(key): _clean(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(item) for item in value]
    if isinstance(value, float):
        return round(value, 3)
    if value is None or isinstance(value, (bool, int)):
        return value
    return _clean(str(value))


def event(kind: str, **fields: Any) -> None:
    """One line, or nothing when the log is not installed. Never raises: a
    record of trouble that causes trouble is worse than none."""
    if _file is None:
        return
    try:
        record = {"at": datetime.now().isoformat(timespec="milliseconds"),
                  "kind": kind, **_clean(fields)}
        _logger.info(json.dumps(record, ensure_ascii=False))
    except Exception:
        pass


def trace_of(error: BaseException | None) -> str:
    if error is None:
        return ""
    return "".join(traceback.format_exception(type(error), error, error.__traceback__))[-6000:]


class _Copy(logging.Handler):
    """Every warning and worse, from any logger, into the file as well."""

    def emit(self, record: logging.LogRecord) -> None:
        if record.name.startswith("nexttex.diag"):
            return
        trace = ""
        if record.exc_info and record.exc_info[1] is not None:
            trace = trace_of(record.exc_info[1])
        try:
            message = record.getMessage()
        except Exception:
            message = str(record.msg)
        event("log", level=record.levelname, logger=record.name,
              message=message[:4000], trace=trace)


def install(state: Path, secrets=(), home: str | None = None) -> Path:
    """Start writing. Returns the file. Calling it again moves the file.

    Call it after the root logger's own stderr handler is in place: this
    adds a handler there too, and `logging.basicConfig` does nothing to a
    root logger that has one, so the journal would lose every warning."""
    global _secrets, _home, _copy, _file
    uninstall()
    state.mkdir(parents=True, exist_ok=True)
    path = state / FILE
    handler = logging.handlers.RotatingFileHandler(
        path, maxBytes=MAX_BYTES, backupCount=BACKUPS, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(message)s"))
    _logger.addHandler(handler)
    _file = handler
    _secrets = [s for s in secrets if isinstance(s, str) and s]
    _home = home if home is not None else str(Path.home())

    _copy = _Copy(level=logging.WARNING)
    logging.getLogger().addHandler(_copy)
    # uvicorn's own loggers do not propagate to the root, and its
    # "Exception in ASGI application" is the traceback most worth having.
    logging.getLogger("uvicorn").addHandler(_copy)

    _hooks["sys"] = sys.excepthook
    _hooks["thread"] = threading.excepthook
    _hooks["unraisable"] = sys.unraisablehook

    def on_process(kind, error, tb):
        event("exception", where="process", error=f"{kind.__name__}: {error}",
              trace="".join(traceback.format_exception(kind, error, tb))[-6000:])
        _hooks["sys"](kind, error, tb)

    def on_thread(args):
        if args.exc_type is not SystemExit:
            event("exception", where=f"thread {getattr(args.thread, 'name', '?')}",
                  error=f"{args.exc_type.__name__}: {args.exc_value}",
                  trace=trace_of(args.exc_value))
        _hooks["thread"](args)

    def on_unraisable(args):
        event("exception", where="unraisable", error=f"{args.exc_type.__name__}: {args.exc_value}",
              message=str(args.err_msg or ""), trace=trace_of(args.exc_value))
        _hooks["unraisable"](args)

    sys.excepthook = on_process
    threading.excepthook = on_thread
    sys.unraisablehook = on_unraisable
    return path


def uninstall() -> None:
    """Stop writing and put every hook back; for the tests, and for a
    second `install`."""
    global _copy, _file
    if _file is not None:
        _logger.removeHandler(_file)
        _file.close()
        _file = None
    if _copy is not None:
        logging.getLogger().removeHandler(_copy)
        logging.getLogger("uvicorn").removeHandler(_copy)
        _copy = None
    if "sys" in _hooks:
        sys.excepthook = _hooks.pop("sys")
    if "thread" in _hooks:
        threading.excepthook = _hooks.pop("thread")
    if "unraisable" in _hooks:
        sys.unraisablehook = _hooks.pop("unraisable")
    _routes.clear()
    inflight.clear()


# ---------------------------------------------------------------------------
# Requests


def _load() -> list[float]:
    try:
        return [round(x, 2) for x in os.getloadavg()]
    except OSError:
        return []


def _long(route: str) -> bool:
    return any(part in route for part in LONG_ROUTES)


def route_of(scope: dict) -> str:
    """The route's template, `/api/projects/{project_id}/file`, never the
    path itself, which carries ids and file names; and for what no route
    matched, the first segment."""
    route = scope.get("route")
    template = getattr(route, "path", None)
    if template:
        return template
    path = str(scope.get("path") or "")
    if path.startswith("/assets/"):
        return "/assets/*"
    return "/" + path.strip("/").split("/", 1)[0] + ("/*" if path.count("/") > 1 else "")


def request_done(method: str, route: str, status: int, seconds: float) -> None:
    """Count one answered request, and say so at once if it failed or was
    slow past what its route allows."""
    if not active():
        return
    key = f"{method} {route}"
    stats = _routes.get(key)
    if stats is None:
        stats = _routes[key] = {"times": [], "n": 0, "errors": 0, "max": 0.0, "skip": 1}
    stats["n"] += 1
    stats["max"] = max(stats["max"], seconds)
    failed = status >= 500 and (method, route, status) not in EXPECTED
    if failed:
        stats["errors"] += 1
    if len(stats["times"]) >= KEEP_PER_ROUTE:
        stats["times"] = stats["times"][::2]
        stats["skip"] *= 2
    if stats["n"] % stats["skip"] == 0:
        stats["times"].append(seconds)
    limit = SLOW_BY_DESIGN if _long(route) else SLOW_REQUEST
    if failed or seconds > limit:
        event("request", method=method, route=route, status=status,
              ms=round(seconds * 1000))


def _percentile(ordered: list[float], fraction: float) -> float:
    if not ordered:
        return 0.0
    index = min(len(ordered) - 1, max(0, round(fraction * (len(ordered) - 1))))
    return ordered[index]


def flush_routes() -> None:
    """One `routes` line for the window just ended, then a fresh window."""
    global _routes_since
    now = time.monotonic()
    if _routes:
        summary = {}
        for key, stats in sorted(_routes.items()):
            ordered = sorted(stats["times"])
            summary[key] = {
                "n": stats["n"], "errors": stats["errors"],
                "p50": round(_percentile(ordered, 0.5) * 1000),
                "p95": round(_percentile(ordered, 0.95) * 1000),
                "max": round(stats["max"] * 1000),
            }
        event("routes", window_s=round(now - _routes_since), routes=summary)
    _routes.clear()
    _routes_since = now


# ---------------------------------------------------------------------------
# The process


def _proc_status() -> dict:
    found: dict = {}
    try:
        text = Path("/proc/self/status").read_text()
    except OSError:
        return found
    for line in text.splitlines():
        name, _, value = line.partition(":")
        if name in ("VmRSS", "VmHWM"):
            found[name] = int(value.split()[0]) // 1024
    return found


def _children() -> int | None:
    try:
        total = 0
        for task in Path("/proc/self/task").iterdir():
            total += len((task / "children").read_text().split())
        return total
    except OSError:
        return None


def resources(cpu_before: tuple[float, float] | None = None) -> dict:
    """What the process holds now. Linux reads `/proc`; elsewhere what the
    standard library can say."""
    found: dict = {}
    status = _proc_status()
    if status:
        found["rss_mb"] = status.get("VmRSS")
        found["peak_mb"] = status.get("VmHWM")
    else:
        try:
            import resource
            peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            found["peak_mb"] = peak // (1024 * 1024 if sys.platform == "darwin" else 1024)
        except Exception:
            pass
    try:
        found["fds"] = len(os.listdir("/proc/self/fd"))
    except OSError:
        pass
    found["threads"] = threading.active_count()
    children = _children()
    if children is not None:
        found["children"] = children
    try:
        found["load"] = [round(x, 2) for x in os.getloadavg()]
    except (OSError, AttributeError):
        pass
    if cpu_before is not None:
        used, at = cpu_before
        times = os.times()
        elapsed = time.monotonic() - at
        if elapsed > 0:
            found["cpu_pct"] = round(100 * (times.user + times.system - used) / elapsed, 1)
    for name, read in list(gauges.items()):
        try:
            found[name] = read()
        except Exception as error:
            found[name] = f"unreadable: {type(error).__name__}"
    return found


def _cpu_now() -> tuple[float, float]:
    times = os.times()
    return times.user + times.system, time.monotonic()


def _in_flight(now: float) -> list[str]:
    return sorted(
        f"{scope.get('method', '')} {route_of(scope)} {round((now - started) * 1000)}ms"
        for scope, started in list(inflight.values())
    )[:10]


def _on_loop_exception(loop: asyncio.AbstractEventLoop, context: dict) -> None:
    error = context.get("exception")
    event("exception", where="event loop", message=str(context.get("message") or ""),
          error=f"{type(error).__name__}: {error}" if error else "",
          trace=trace_of(error))
    previous = _hooks.get("loop")
    if previous is not None:
        previous(loop, context)
    else:
        loop.default_exception_handler(context)


async def watch() -> None:
    """The sampler: loop lag every second, resources every minute, the
    route summary every five. Runs for the life of the server."""
    loop = asyncio.get_running_loop()
    _hooks["loop"] = loop.get_exception_handler()
    loop.set_exception_handler(_on_loop_exception)
    cpu = _cpu_now()
    last_sample = last_routes = time.monotonic()
    worst = 0.0
    try:
        while True:
            asked = time.monotonic()
            await asyncio.sleep(LAG_EVERY)
            now = time.monotonic()
            lag = now - asked - LAG_EVERY
            worst = max(worst, lag)
            if lag > LAG_NOTE:
                # The host's load beside it: a stall with nothing in flight
                # on a machine running a hundred other things is the
                # machine's, which the first review could only infer.
                event("lag", ms=round(lag * 1000), inflight=_in_flight(now),
                      load=_load())
            if now - last_sample >= SAMPLE_EVERY:
                event("sample", worst_lag_ms=round(worst * 1000), **resources(cpu))
                cpu, last_sample, worst = _cpu_now(), now, 0.0
            if now - last_routes >= ROUTES_EVERY:
                flush_routes()
                last_routes = now
    finally:
        flush_routes()
        loop.set_exception_handler(_hooks.pop("loop", None))

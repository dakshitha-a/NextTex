"""Start NextTex, on one address or two.

uvicorn binds a single socket per server object, so "reachable at localhost
*and* over Tailscale" means two servers sharing one event loop.  They serve
the same application object, so there is one registry, one set of open
projects and one agent per project no matter which address the browser
came in on.

Loopback is served as plain HTTP: nothing leaves the machine, and a
self-signed certificate on localhost costs the user a browser warning for
no gain.  Anything reachable from another machine is served over TLS.
"""

from __future__ import annotations

# First, before anything slow is imported: the clock the start's own timing
# is read against. See `StartClock`.
import time

_RAN_AT = time.monotonic()

# Second, before anything of NextTex's is imported: whether this is a new
# version that keeps failing to start after an update, and if so going back
# to the one it left. A new version that cannot import its own modules is
# the case this is for, so it runs ahead of them. See `server/comeback.py`.
if __name__ == "__main__":
    import sys as _sys

    try:  # started as `python server/run.py`, the way every launcher does
        from comeback import at_start as _went_back, serving as _serving
    except ImportError:  # or as `python -m server.run`
        from server.comeback import at_start as _went_back, serving as _serving

    if _serving(_sys.argv[1:]) and _went_back(_sys.argv[1:]):
        raise SystemExit(3)

import argparse
import asyncio
import atexit
import signal
import logging
import os
import socket
import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from nexttex import lifeline
from nexttex.config import Settings, ensure_tex_on_path, missing_tools, required_missing


def _process_age() -> float | None:
    """Seconds since this process was created, or None where that cannot be
    asked: the interpreter's own start and the imports it makes before this
    file runs, which on a machine whose antivirus reads the whole virtual
    environment is most of the wait."""
    try:
        if sys.platform == "win32":
            import ctypes
            from ctypes import wintypes

            created, exited, kernel, user = (wintypes.FILETIME() for _ in range(4))
            handle = ctypes.windll.kernel32.GetCurrentProcess()
            if not ctypes.windll.kernel32.GetProcessTimes(
                handle, ctypes.byref(created), ctypes.byref(exited),
                ctypes.byref(kernel), ctypes.byref(user),
            ):
                return None
            ticks = (created.dwHighDateTime << 32) | created.dwLowDateTime
            # FILETIME counts 100 ns intervals from 1601; the epoch is
            # 11644473600 s later.
            return max(0.0, time.time() - (ticks / 1e7 - 11644473600))
        with open("/proc/self/stat", encoding="ascii") as stat:
            fields = stat.read().rsplit(")", 1)[1].split()
        with open("/proc/uptime", encoding="ascii") as uptime:
            up = float(uptime.read().split()[0])
        return max(0.0, up - int(fields[19]) / os.sysconf("SC_CLK_TCK"))
    except (OSError, ValueError, IndexError, AttributeError):
        return None


class StartClock:
    """How long each part of a start took, said once in the log.

    A logon-started server on the Windows laptop took five minutes to
    answer on 23 September 2026 where the same build from the desktop
    shortcut took twenty-five seconds, and nothing said where the time
    went: a cold disk, an antivirus reading a 400 MB virtual environment
    and a freshly installed MiKTeX were all plausible and none was
    measured. This is the measurement, one line in server.log per start.
    """

    def __init__(self, ran_at: float, age: float | None) -> None:
        self.last = ran_at
        self.before = age - (time.monotonic() - ran_at) if age is not None else None
        self.steps: list[tuple[str, float]] = []

    def mark(self, name: str) -> None:
        now = time.monotonic()
        self.steps.append((name, now - self.last))
        self.last = now

    def line(self) -> str:
        parts = []
        total = sum(seconds for _, seconds in self.steps)
        if self.before is not None:
            parts.append(f"the interpreter {self.before:.1f} s before this file ran")
            total += self.before
        parts += [f"{name} {seconds:.1f} s" for name, seconds in self.steps]
        stamp = time.strftime("%Y-%m-%d %H:%M:%S")
        return f"{stamp} Answering after {total:.1f} s: " + ", ".join(parts) + "."


CLOCK = StartClock(_RAN_AT, _process_age())
CLOCK.mark("imports")


class _Server(uvicorn.Server):
    """uvicorn's server, marking the end when it is asked to stop.

    uvicorn catches SIGTERM and SIGINT, shuts down, and then raises the
    signal again, so neither `main`'s `finally` nor an exit hook runs for
    the most ordinary stop there is, a service manager's. Marked here, at
    the moment the signal arrives, or every stop and every restart of the
    unit would be reported at the next start as a server that ended
    without a word."""

    def handle_exit(self, sig, frame) -> None:
        try:
            name = signal.Signals(sig).name
        except (ValueError, TypeError):
            name = str(sig)
        lifeline.stopped(f"asked to stop ({name})")
        super().handle_exit(sig, frame)


def tailscale_address() -> str | None:
    """This machine's tailnet address, if Tailscale is up."""
    import json
    import subprocess

    try:
        out = subprocess.run(
            ["tailscale", "status", "--json"],
            capture_output=True, text=True, timeout=5,
        ).stdout
        status = json.loads(out)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    addresses = (status.get("Self") or {}).get("TailscaleIPs") or []
    for address in addresses:
        if ":" not in address:      # IPv4 first; it is what people type
            return address
    return addresses[0] if addresses else None


def in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((host, port))
        except OSError:
            return True
    return False


async def serve(settings: Settings) -> None:
    # uvicorn is kept quiet -- an access log line per keystroke is noise --
    # but that left NextTex's own warnings with nowhere to go, and the app
    # was silent through failures the writer could see on screen: a wedged
    # agent turn, a build task that died, a subscriber dropped.  Warnings
    # and worse now carry a timestamp and the name of what went wrong.
    logging.basicConfig(
        level=logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        # With the date.  The launchers append this output to a log that
        # spans every run the install has made, and a bug report quotes the
        # end of that log; a time with no day cannot be placed against the
        # update that preceded it.
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    servers: list[uvicorn.Server] = []
    urls: list[str] = []

    if settings.localhost:
    # `proxy_headers` defaults to *on* in uvicorn, trusting 127.0.0.1, which
    # on a loopback listener means every client.  So `X-Forwarded-For` was
    # rewriting `request.client.host`, and nexttex/auth.py's rate limiter
    # keys its buckets on exactly that: a guesser could reset their own
    # doubling delay on every attempt by inventing a header.  auth.py says
    # in its own comment that the address is the socket's; this is what
    # makes that true.  NextTex has no proxy in front of it by design, so
    # there is nothing to lose by refusing the header outright.
        config = uvicorn.Config(
            "server.main:app", host="127.0.0.1", port=settings.port,
            log_level="warning", access_log=False, proxy_headers=False,
        )
        servers.append(_Server(config))
        urls.append(f"http://127.0.0.1:{settings.port}")

    remote = settings.lan_host or (tailscale_address() if settings.tailscale else "")
    if remote:
        if not (settings.certfile and Path(settings.certfile).is_file()):
            print(
                "  no certificate, so the tailnet address is not being served.\n"
                "  Run scripts/gen_cert.sh, or the installer again:\n"
                "    " + (r"scripts\install.ps1" if os.name == "nt"
                          else "scripts/install.sh"),
                file=sys.stderr,
            )
        else:
            config = uvicorn.Config(
                "server.main:app", host=remote, port=settings.port,
                ssl_certfile=settings.certfile, ssl_keyfile=settings.keyfile,
                log_level="warning", access_log=False, proxy_headers=False,
            )
            servers.append(_Server(config))
            urls.append(f"https://{remote}:{settings.port}")

    if not servers:
        print("Nothing to listen on. Set localhost or tailscale in the config.",
              file=sys.stderr)
        raise SystemExit(2)

    print("\nNextTex")
    for line in banner(urls, settings.token, sys.stdout.isatty()):
        print(line)
    print()

    async def keep_beating() -> None:
        """The heartbeat, every minute while serving; see nexttex/lifeline.py."""
        life = lifeline.current
        while life is not None and not any(server.should_exit for server in servers):
            life.beat()
            await asyncio.sleep(lifeline.EVERY)

    async def say_when_answering() -> None:
        while not all(server.started for server in servers):
            if any(server.should_exit for server in servers):
                return
            await asyncio.sleep(0.05)
        CLOCK.mark("listening")
        print(CLOCK.line())

    # One loop, both sockets.  If either fails to bind, the whole thing
    # stops: a half-started server that silently drops the address the user
    # actually types is worse than not starting.
    beating = asyncio.ensure_future(keep_beating())
    try:
        await asyncio.gather(
            *(server.serve() for server in servers), say_when_answering(),
        )
    finally:
        beating.cancel()


def banner(urls: list[str], token: str, to_terminal: bool) -> list[str]:
    """What a starting server says about where it is.

    The token goes to a terminal and nowhere else.  A service's stdout is
    server.log on macOS and Windows and the journal on Linux, and the
    token printed there sat in clear for the life of the log, which the
    bug report then had to redact.  A person at a terminal still gets the
    link; a log gets the address and the command that prints the link on
    request.
    """
    if to_terminal:
        return [f"  {url}/?token={token}" for url in urls]
    return [
        f"  {url}/  (run server/run.py --print-url for the link with its token)"
        for url in urls
    ]


def _log_to_state() -> None:
    """Point file descriptors 1 and 2 at the state directory's logs.

    At the descriptor rather than by swapping `sys.stdout`, so children
    inherit it, and appended rather than replaced, so a server that dies
    on startup leaves its last words beside the previous run's.  `-u` on
    the command line is what keeps the file current while it runs.
    """
    from nexttex.paths import state_home

    state = state_home()
    state.mkdir(parents=True, exist_ok=True)
    for name, fd in (("server.log", 1), ("server.err.log", 2)):
        handle = os.open(str(state / name), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        os.dup2(handle, fd)
        os.close(handle)
    # Python's own objects still point at the old descriptors' buffers;
    # give them the new ones, line buffered.
    sys.stdout = os.fdopen(1, "w", buffering=1, encoding="utf-8", errors="replace", closefd=False)
    sys.stderr = os.fdopen(2, "w", buffering=1, encoding="utf-8", errors="replace", closefd=False)


def _print_version() -> None:
    """The version, the commit this install is on, and the one its
    interface was built from.  `nexttex/version.py` has the text and the
    reason there are three lines; `python -m nexttex.version` prints the
    same from a bare interpreter."""
    from nexttex.version import describe

    for line in describe():
        print(line)


def _set_password(settings: Settings) -> None:
    """Choose the password from the machine itself.

    The way back in when it has been forgotten, and the way to set one on a
    headless install.  Every existing session is dropped, because a password
    being changed at a terminal is exactly the moment the browsers holding
    the old one should stop being trusted.
    """
    import getpass
    from nexttex import auth

    try:
        first = getpass.getpass("New password: ")
        second = getpass.getpass("Again: ")
    except (EOFError, KeyboardInterrupt):
        print()
        raise SystemExit(1)

    if first != second:
        print("Those do not match.", file=sys.stderr)
        raise SystemExit(1)
    if len(first) < 8:
        print("Use at least eight characters.", file=sys.stderr)
        raise SystemExit(1)

    settings.password_hash, settings.password_salt = auth.hash_password(first)
    signed_out = len(settings.sessions)
    settings.sessions = []
    settings.save()
    print("Password set." + (f" {signed_out} signed-in browser(s) were signed out."
                             if signed_out else ""))
    # A running server read its settings at startup and is still checking
    # against the old password.  Saying so here is the difference between a
    # recovery path that works and one that looks like it did nothing.
    print("Restart NextTex for it to take effect.")


def _open_when_up(port: int, url: str, timeout: float = 30.0) -> None:
    """Open the browser once the server answers, or not at all.

    Opening it immediately shows a connection error on a cold start, and
    opening it on a fixed delay is a guess about how long an interpreter and
    a configuration take on somebody else's machine.  Waiting for the port
    is neither.
    """
    import time

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if in_use("127.0.0.1", port):
            webbrowser.open(url)
            return
        time.sleep(0.25)


def _keep_a_lifeline() -> None:
    """Start the heartbeat, say what the last server left, and listen for
    the ends Windows announces.

    A Windows server has been found gone in the morning twice with nothing
    anywhere to say why. What the previous one left is said first, so
    server.log places its end to within a minute; the console handler
    writes the event Windows sends a console process before ending it, a
    closed window, a logoff or a shutdown, to server.err.log while it still
    can. A process that is simply reaped sees nothing, and the next start
    says so.
    """
    from nexttex.paths import state_home
    from nexttex.version import VERSION

    state = state_home()
    said = lifeline.previous(state)
    if said:
        print(said)
    lifeline.current = lifeline.Lifeline(state, VERSION)
    lifeline.current.beat()
    atexit.register(lifeline.stopped, "exited")
    if sys.platform == "win32":
        _hear_windows()


#: What Windows calls the events a console process is told of before it
#: is ended; see SetConsoleCtrlHandler.
_CONSOLE_EVENTS = {
    0: "Ctrl-C", 1: "Ctrl-Break", 2: "the console window was closed",
    5: "the user logged off", 6: "the machine is shutting down",
}
_HANDLER = None


def _hear_windows() -> None:
    import ctypes

    global _HANDLER

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_uint)
    def handler(event: int) -> bool:
        what = _CONSOLE_EVENTS.get(event, f"console event {event}")
        stamp = time.strftime("%Y-%m-%d %H:%M:%S")
        try:
            print(f"{stamp} Windows said: {what}", file=sys.stderr, flush=True)
        except Exception:
            pass
        lifeline.stopped(f"Windows said: {what}")
        return False   # and let Windows go on to end the process

    _HANDLER = handler   # kept, or the callback is collected under Windows
    try:
        ctypes.windll.kernel32.SetConsoleCtrlHandler(handler, True)
    except (AttributeError, OSError):
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description="Run NextTex.")
    parser.add_argument("--port", type=int, help="override the configured port")
    parser.add_argument("--print-url", action="store_true",
                        help="print the sign-in URL and exit")
    parser.add_argument("--open", action="store_true",
                        help="open NextTex in a browser, starting it first "
                             "if it is not already running")
    parser.add_argument("--version", action="store_true",
                        help="print the version and the commit this install is on, "
                             "and exit")
    # What a bug report asks for.  `python -m nexttex.report` is the same
    # text from a bare interpreter, for the install whose virtual
    # environment is the thing that broke; this file imports uvicorn before
    # it reads its arguments, so it cannot answer then.
    parser.add_argument("--report", action="store_true",
                        help="print a diagnostics report for a bug report "
                             "and exit")
    parser.add_argument("--set-password", action="store_true",
                        help="set the password browsers sign in with, and exit")
    # The one way to name an instance that survives every launcher.  The
    # unit and the plist carry NEXTTEX_INSTANCE in their environment; a
    # Windows scheduled task, a Startup shortcut and a desktop shortcut on
    # any platform carry a command line and nothing else, so a named
    # instance started from one of those came up as the default one, on
    # the default port, with the default state directory.
    parser.add_argument("--instance", default="",
                        help="which named instance this is; the same as "
                             "setting NEXTTEX_INSTANCE")
    # What the Windows launchers pass.  A scheduled task and a Startup
    # shortcut are a command line with nowhere for the output to go: the
    # task's server wrote to no file at all, and the shortcut's only to a
    # minimised console window that logging in closes with the rest.  The
    # unit and the plist redirect for their servers; on Windows the server
    # does it for itself, at the file descriptor, so what latexmk and the
    # agent print lands in the same file.
    parser.add_argument("--log-to-state", action="store_true",
                        help="append stdout and stderr to server.log and "
                             "server.err.log in the state directory")
    arguments = parser.parse_args()

    if arguments.instance:
        # Before Settings.load(), which is the first thing to ask where the
        # state directory is.
        os.environ["NEXTTEX_INSTANCE"] = arguments.instance
    if arguments.log_to_state:
        _log_to_state()
        # Started by a launcher, which on Windows is `pythonw.exe` with no
        # console: every child is told to make no console window either.
        from nexttex.winproc import quiet_children

        quiet_children()

    if arguments.version:
        _print_version()
        return
    if arguments.report:
        # Before Settings.load() for the same reason --version is: a report
        # about a machine must not be the first thing to write a config
        # file on it.
        from nexttex import report

        sys.stdout.write(report.compose(
            root=Path(__file__).resolve().parent.parent,
            source="server/run.py --report",
        ))
        return

    settings = Settings.load()
    CLOCK.mark("settings")
    if arguments.port:
        settings.port = arguments.port

    if arguments.set_password:
        _set_password(settings)
        return

    if arguments.print_url:
        # Every address it answers on.  Printing only localhost would hide
        # the one URL a headless user can actually open.
        if settings.localhost:
            print(f"http://127.0.0.1:{settings.port}/?token={settings.token}")
        remote = settings.lan_host or (
            tailscale_address() if settings.tailscale else "")
        if remote:
            print(f"https://{remote}:{settings.port}/?token={settings.token}")
        return

    if arguments.open:
        # What the desktop shortcut runs, and it has to work from both
        # states: the server already up because it starts at login, or
        # nothing running at all because that was declined or has died.
        # Already up means open the browser and get out of the way, since
        # binding the port again would only fail.  Otherwise the browser is
        # opened once the port answers and this process goes on to be the
        # server, which is why the shortcut's window is worth keeping.
        url = f"http://127.0.0.1:{settings.port}/?token={settings.token}"
        if in_use("127.0.0.1", settings.port):
            webbrowser.open(url)
            return
        threading.Thread(target=_open_when_up, args=(settings.port, url),
                         daemon=True).start()

    ensure_tex_on_path()
    for item in required_missing():
        print(f"  missing: {item}", file=sys.stderr)
    for item in missing_tools():
        print(f"  note: {item}")
    CLOCK.mark("finding TeX")

    for host in filter(None, [
        "127.0.0.1" if settings.localhost else None,
        settings.lan_host or (tailscale_address() if settings.tailscale else None),
    ]):
        if in_use(host, settings.port):
            print(f"Port {settings.port} is already in use on {host}. "
                  f"Stop the other NextTex, or set a different port.",
                  file=sys.stderr)
            raise SystemExit(1)
    CLOCK.mark("the port")

    # Imported here rather than by uvicorn inside `serve`, so its cost is a
    # step of its own; uvicorn then finds it already in `sys.modules`.
    import server.main  # noqa: F401

    CLOCK.mark("the app")

    _keep_a_lifeline()

    try:
        asyncio.run(serve(settings))
    except KeyboardInterrupt:
        lifeline.stopped("interrupted from the keyboard")
    finally:
        lifeline.stopped("exited")


if __name__ == "__main__":
    main()

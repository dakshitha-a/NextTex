"""What a finished install has to look like, asked of a real one.

Run by `.github/workflows/install.yml` on the runner the install just
happened on, with whatever Python the runner has: nothing here imports
anything outside the standard library, because the interpreter that ran the
bootstrap is the only one guaranteed to exist.

Not collected by pytest, on purpose.  The unit tier under `tests/` asserts
what the installer *would* run, with the child processes replaced; this
asserts what it *did*, against the files, the service manager and the port
the README promises.  The two answer different questions and the second one
needs a machine that was clean five minutes ago.

    verify_install.py installed --root DIR [--instance NAME] [--head SHA]
    verify_install.py again     --root DIR [--instance NAME]
    verify_install.py gone      --root DIR [--instance NAME] --port N

`installed` is the README's claims, one by one.  `again` is the same install
run a second time: the log has one more block, nothing else has changed.
`gone` is the README's uninstall section, checked after somebody ran it.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

HOME = Path.home()
PLATFORM = {"linux": "linux", "darwin": "macos", "win32": "windows"}[sys.platform]


def state_home(instance: str) -> Path:
    base = os.environ.get("XDG_DATA_HOME") or str(HOME / ".local" / "share")
    return Path(base) / (f"nexttex-{instance}" if instance else "nexttex")


def venv_python(root: Path) -> Path:
    if PLATFORM == "windows":
        return root / ".venv" / "Scripts" / "python.exe"
    return root / ".venv" / "bin" / "python"


def unit_name(instance: str) -> str:
    return f"nexttex-{instance}" if instance else "nexttex"


def service_file(instance: str) -> Path | None:
    if PLATFORM == "linux":
        config = os.environ.get("XDG_CONFIG_HOME") or str(HOME / ".config")
        return Path(config) / "systemd" / "user" / f"{unit_name(instance)}.service"
    if PLATFORM == "macos":
        label = "com.nexttex.server" + (f"-{instance}" if instance else "")
        return HOME / "Library" / "LaunchAgents" / f"{label}.plist"
    return None


def startup_shortcut(instance: str) -> Path:
    startup = HOME / "AppData" / "Roaming" / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
    return startup / f"{unit_name(instance)}.lnk"


def scheduled_task_exists(name: str) -> bool:
    done = subprocess.run(["schtasks", "/query", "/tn", name], capture_output=True, text=True)
    return done.returncode == 0


def run(argv, cwd=None, env=None, timeout=120) -> subprocess.CompletedProcess:
    return subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True,
                          timeout=timeout, errors="replace")


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, bool, str]] = []

    def check(self, label: str, ok: bool, detail: str = "") -> bool:
        self.rows.append((label, bool(ok), detail))
        mark = "ok  " if ok else "FAIL"
        print(f"  {mark} {label}" + (f"  ({detail})" if detail else ""), flush=True)
        return bool(ok)

    def note(self, label: str, detail: str) -> None:
        self.rows.append((label, True, detail))
        print(f"  note {label}  ({detail})", flush=True)

    def finish(self, title: str) -> int:
        failed = [row for row in self.rows if not row[1]]
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as handle:
                handle.write(f"### {title}\n\n| | check | detail |\n|---|---|---|\n")
                for label, ok, detail in self.rows:
                    handle.write(f"| {'✅' if ok else '❌'} | {label} | {detail} |\n")
                handle.write("\n")
        print(f"\n{title}: {len(self.rows) - len(failed)} of {len(self.rows)} checks passed")
        return 1 if failed else 0


# ---------------------------------------------------------------------------


def print_url(root: Path, instance: str) -> tuple[str, int, str, str]:
    """(url, port, token, output) from `run.py --print-url`."""
    env = dict(os.environ)
    env["NEXTTEX_INSTANCE"] = instance
    done = run([str(venv_python(root)), str(root / "server" / "run.py"), "--print-url"],
               cwd=root, env=env)
    out = done.stdout + done.stderr
    found = re.search(r"(https?://[^\s/]+:(\d+))/\?token=([A-Za-z0-9_\-]+)", out)
    if not found:
        return "", 0, "", out
    return found.group(1), int(found.group(2)), found.group(3), out


def ask(base: str, path: str, token: str, method: str = "GET", timeout: float = 5.0):
    request = urllib.request.Request(base + path, method=method,
                                     headers={"X-NextTex-Token": token})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, json.loads(response.read().decode("utf-8") or "null")


def listening(port: int) -> bool:
    with socket.socket() as probe:
        probe.settimeout(1.0)
        try:
            probe.connect(("127.0.0.1", port))
            return True
        except OSError:
            return False


def wait_listening(port: int, seconds: float) -> bool:
    import time
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if listening(port):
            return True
        time.sleep(0.5)
    return False


def start_server(root: Path, instance: str) -> subprocess.Popen:
    """Start the server the way the README's "run it in the foreground"
    line does, for an install that was asked not to start at login."""
    env = dict(os.environ)
    env["NEXTTEX_INSTANCE"] = instance
    env["PYTHONUNBUFFERED"] = "1"
    return subprocess.Popen([str(venv_python(root)), str(root / "server" / "run.py")],
                            cwd=root, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, errors="replace")


def stop_server(process: subprocess.Popen | None) -> str:
    if process is None:
        return ""
    process.terminate()
    try:
        out, _ = process.communicate(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        out, _ = process.communicate()
    return out or ""


def head_of(root: Path) -> str:
    done = run(["git", "rev-parse", "HEAD"], cwd=root)
    return done.stdout.strip()


def log_blocks(instance: str) -> int:
    log = state_home(instance) / "install.log"
    if not log.exists():
        return 0
    return log.read_text(encoding="utf-8", errors="replace").count("installing the checkout at")


# ---------------------------------------------------------------------------


def cmd_installed(args) -> int:
    root = Path(args.root).resolve()
    instance = args.instance
    report = Report()
    print(f"\nverifying the install at {root}" + (f" (instance {instance})" if instance else ""))

    python = venv_python(root)
    report.check("the virtual environment exists", python.exists(), str(python))
    imported = run([str(python), "-c", "import fastapi, uvicorn, nexttex, server"], cwd=root)
    report.check("its interpreter can import the app", imported.returncode == 0,
                 imported.stderr.strip().splitlines()[-1] if imported.returncode else "")

    dist = root / "frontend" / "dist"
    report.check("the interface is in place", (dist / "index.html").exists(), str(dist))
    stamp = dist / "BUILD_SHA"
    head = head_of(root)
    if args.head:
        report.check("the checkout is on the expected commit", head == args.head, f"{head[:7]} vs {args.head[:7]}")
    if stamp.exists():
        built = stamp.read_text(encoding="utf-8").strip()
        report.check("the downloaded interface belongs to this commit", built == head, f"downloaded {built[:7]}")
    else:
        # Not a failure: `fetch-interface` fell back to a local build, which
        # is what happens when the asset for a commit is not published yet.
        report.note("the interface was built here rather than downloaded", "no BUILD_SHA")

    log = state_home(instance) / "install.log"
    report.check("install.log was written", log.exists(), str(log))
    if log.exists():
        text = log.read_text(encoding="utf-8", errors="replace")
        for step in ("Python", "TeX", "Writing agent", "Interface", "Listening", "At login", "Desktop"):
            report.check(f"install.log names the step: {step}", re.search(rf"\[\d/\d\] {step}", text) is not None)
        report.check("install.log says Ready", "Ready" in text)
        report.check("install.log names itself at the end", str(log) in text or "Log of everything above" in text)

    config = state_home(instance) / "config.json"
    report.check("config.json was written", config.exists(), str(config))

    url, port, token, out = print_url(root, instance)
    report.check("run.py --print-url prints an address with a token", bool(url), out.strip().splitlines()[-1] if not url else url)
    report.check("--print-url does not warn about a mismatched interface", "These differ" not in out)
    if instance:
        report.check("a named instance is not on the default port", port != 8450, str(port))

    started = None
    if url and not args.service:
        # Nothing was asked to start it, so this does, the way the README's
        # foreground line does; the checks below are about the install and
        # not about the service manager.
        started = start_server(root, instance)
    if url:
        up = wait_listening(port, 30)
        report.check("something is listening on the port", up,
                     str(port) if args.service else f"{port}, started here")
        if not up and started is not None:
            report.note("the server said", stop_server(started).strip()[-800:])
            started = None
        if up:
            try:
                status, body = ask(url, "/api/instance", token)
                report.check("/api/instance answers", status == 200)
                report.check("it reports the instance it was installed as", body.get("instance", "") == instance, body.get("instance", ""))
                # The route reports the short form.
                reported = str(body.get("head", ""))
                report.check("head is the checkout's commit", bool(reported) and head.startswith(reported), reported)
                report.check("diskHead agrees with head", body.get("diskHead") == body.get("head"))
                report.note("supervised", str(body.get("supervised")))
                report.check("the server's root is this install", Path(body.get("root", "")).resolve() == root, body.get("root", ""))
            except Exception as error:  # noqa: BLE001
                report.check("/api/instance answers", False, f"{type(error).__name__}: {error}")
            try:
                status, body = ask(url, "/api/instance", "not-the-token")
                report.check("a wrong token is refused", False, f"answered {status}")
            except urllib.error.HTTPError as error:
                report.check("a wrong token is refused", error.code in (401, 403), str(error.code))
            except Exception as error:  # noqa: BLE001
                report.check("a wrong token is refused", False, str(error))

    if started is not None:
        out = stop_server(started)
        report.check("it stopped when asked", started.returncode is not None, f"exit {started.returncode}")
        if "Traceback" in out:
            report.check("it printed no traceback", False, out.strip()[-800:])

    if args.service:
        if PLATFORM == "windows":
            task = scheduled_task_exists(unit_name(instance))
            link = startup_shortcut(instance)
            report.check("a login task or a Startup shortcut exists", task or link.exists(),
                         "scheduled task" if task else str(link))
        else:
            path = service_file(instance)
            report.check("the service file is at the documented path", path is not None and path.exists(), str(path))
            if PLATFORM == "linux":
                active = run(["systemctl", "--user", "is-active", unit_name(instance)])
                report.note("systemctl --user is-active", (active.stdout + active.stderr).strip())
                enabled = run(["systemctl", "--user", "is-enabled", unit_name(instance)])
                report.note("systemctl --user is-enabled", (enabled.stdout + enabled.stderr).strip())
            else:
                listed = run(["launchctl", "list"])
                label = "com.nexttex.server" + (f"-{instance}" if instance else "")
                report.check("launchctl lists the agent", label in listed.stdout, label)

    if args.shortcut:
        if PLATFORM == "windows":
            desktop = run(["powershell", "-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"]).stdout.strip()
            link = Path(desktop) / (f"NextTex ({instance}).lnk" if instance else "NextTex.lnk")
            report.check("the desktop shortcut exists", link.exists(), str(link))
        else:
            desktop = HOME / "Desktop"
            if desktop.is_dir():
                name = f"NextTex ({instance})" if instance else "NextTex"
                suffix = ".command" if PLATFORM == "macos" else ".desktop"
                link = desktop / (name + suffix)
                report.check("the desktop shortcut exists", link.exists(), str(link))
                if link.exists():
                    report.check("it is executable", os.access(link, os.X_OK))
            else:
                report.note("no desktop directory here", "the shortcut step is skipped, as documented")

    if args.record:
        Path(args.record).write_text(json.dumps({"url": url, "port": port, "token": token, "head": head}), encoding="utf-8")
    return report.finish("installed" + (f" ({instance})" if instance else ""))


def cmd_again(args) -> int:
    root = Path(args.root).resolve()
    instance = args.instance
    report = Report()
    print(f"\nverifying the second run at {root}")
    blocks = log_blocks(instance)
    report.check("install.log holds exactly two blocks, appended", blocks == 2, str(blocks))
    url, port, token, out = print_url(root, instance)
    if args.record and Path(args.record).exists():
        before = json.loads(Path(args.record).read_text(encoding="utf-8"))
        report.check("the address is unchanged", url == before["url"] and token == before["token"], url)
    if url and args.service:
        up = wait_listening(port, 30)
        report.check("the server still answers", up)
    return report.finish("again" + (f" ({instance})" if instance else ""))


def cmd_gone(args) -> int:
    root = Path(args.root).resolve()
    instance = args.instance
    report = Report()
    print(f"\nverifying the uninstall of {root}")
    report.check("the install directory is gone", not root.exists(), str(root))
    report.check("the state directory is gone", not state_home(instance).exists(), str(state_home(instance)))
    path = service_file(instance)
    if path is not None:
        report.check("the service file is gone", not path.exists(), str(path))
    if PLATFORM == "linux":
        active = run(["systemctl", "--user", "is-active", unit_name(instance)])
        report.check("the unit is not active", active.stdout.strip() != "active", active.stdout.strip())
    if PLATFORM == "macos":
        listed = run(["launchctl", "list"])
        label = "com.nexttex.server" + (f"-{instance}" if instance else "")
        report.check("launchctl no longer lists the agent", label not in listed.stdout, label)
    if PLATFORM == "windows":
        report.check("the scheduled task is gone", not scheduled_task_exists(unit_name(instance)))
        report.check("the Startup shortcut is gone", not startup_shortcut(instance).exists())
    if args.port:
        import time
        time.sleep(2)
        report.check("nothing is listening on the port any more", not listening(args.port), str(args.port))
    return report.finish("gone" + (f" ({instance})" if instance else ""))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("installed", "again", "gone"):
        p = sub.add_parser(name)
        p.add_argument("--root", required=True)
        p.add_argument("--instance", default="")
        p.add_argument("--record", default="")
        if name == "installed":
            p.add_argument("--head", default="")
            p.add_argument("--service", action="store_true")
            p.add_argument("--shortcut", action="store_true")
        if name == "again":
            p.add_argument("--service", action="store_true")
        if name == "gone":
            p.add_argument("--port", type=int, default=0)
    args = parser.parse_args(argv)
    return {"installed": cmd_installed, "again": cmd_again, "gone": cmd_gone}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())

"""The work itself: the venv, the packages, TeX, the agent, the interface,
the configuration.

Two things about this module are load-bearing and easy to undo by accident.

**It imports nothing outside the standard library, and does nothing at
import time.**  It is imported twice from two different interpreters: by the
installer, running on whatever bare Python the bootstrap found, before there
is a virtual environment; and by the running server, from inside that
virtual environment, because installing the Claude CLI from the settings
sheet has to be the same act as installing it during the install.  A single
`import requests` here would break the first of those on every machine.

**Nothing is fetched by piping a URL into a shell.**  Every download is done
here, with urllib, into a file, and then the file is run.  That is not
fussiness: `irm ... | iex` is exactly how both bundled installers crashed on
a real Windows machine, because `Invoke-WebRequest.Content` hands back a
byte array rather than a string whenever the response is not a content type
PowerShell recognises as text -- and the TinyTeX URL is a batch file, which
`Invoke-Expression` could never have run in any encoding.  Downloading to a
file and running the file has neither problem, on any platform, and it means
the progress bar can show a real percentage.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

from .ui import Console, Result

UV_INSTALLER = "https://astral.sh/uv/install.sh"
TINYTEX_UNIX = "https://yihui.org/tinytex/install-bin-unix.sh"
TINYTEX_WINDOWS = "https://yihui.org/tinytex/install-bin-windows.bat"
CLAUDE_UNIX = "https://claude.ai/install.sh"
CLAUDE_WINDOWS = "https://claude.ai/install.ps1"


def venv_python(root: Path, platform: str) -> Path:
    if platform == "windows":
        return root / ".venv" / "Scripts" / "python.exe"
    return root / ".venv" / "bin" / "python"


# ---------------------------------------------------------------------------
# Downloading


def fetch(url: str, dest: Path, on_progress=None) -> str:
    """Download one URL to one file.  Returns "" on success, or the error.

    No console, so the server can call it too: adding the Claude CLI from the
    settings sheet fetches exactly this URL, with exactly this code.
    """
    try:
        request = urllib.request.Request(
            url, headers={"User-Agent": "nexttex-install"}
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            total = int(response.headers.get("Content-Length") or 0)
            got = 0
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open("wb") as handle:
                while True:
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    handle.write(chunk)
                    got += len(chunk)
                    if on_progress is not None:
                        on_progress(got, total)
    except (urllib.error.URLError, OSError, ValueError) as error:
        return f"{url}: {error}"
    return ""


def download(console: Console, label: str, url: str, dest: Path,
             counter: str = "") -> Result:
    """Fetch one file, with a real percentage when the server gives a length.

    A percentage is only shown where a genuine total exists.  Everywhere else
    -- pip resolving, tlmgr, npm -- the step shows elapsed time and the
    child's own last line, because a made-up percentage is worse than none.
    """
    import time

    prefix = f"  {counter} " if counter else "  "
    started = time.monotonic()
    console.log_line(f"> {url}")
    if not console.animate:
        console.write(f"{prefix}{label} ...")

    def progress(got: int, total: int) -> None:
        if console.animate:
            _bar(console, prefix, label, started, got, total)

    error = fetch(url, dest, progress)
    if console.animate:
        console._clear()
    console._settle(prefix, label, time.monotonic() - started, ok=not error)
    if error:
        console.log_line("! " + error)
        return Result(False, 1, time.monotonic() - started, [error])
    return Result(True, 0, time.monotonic() - started, [])


def _bar(console: Console, prefix: str, label: str, started: float,
         got: int, total: int) -> None:
    import time

    from .ui import _clock

    elapsed = _clock(time.monotonic() - started)
    if total:
        share = got / total
        width = 20
        filled = int(share * width)
        bar = "#" * filled + "-" * (width - filled)
        tail = f"{bar}  {int(share * 100):3d}%"
    else:
        tail = f"{got // 1024} KB"
    head = f"{prefix}{label}  ({elapsed})  {tail}"
    if console.escapes:
        console.stream.write("\r\033[2K" + head[: console.width - 1])
    else:
        console.stream.write("\r" + head[: console.width - 1].ljust(console.width - 1))
    console.stream.flush()


# ---------------------------------------------------------------------------
# Python


def ensure_uv(console: Console, root: Path, platform: str, existing: str = "",
              counter: str = "") -> str:
    """uv, when it can be had, installed into the checkout rather than onto
    the system.

    It brings its own CPython, which steps straight over the single most
    common way a first install used to fail: Debian and Ubuntu ship python3
    without ensurepip, so `python3 -m venv` fails on a fresh machine and the
    error names a package nobody would guess.

    Into `.uv/` and never onto PATH, because an installer that quietly adds a
    tool to your PATH is not one you can uninstall by deleting a folder.
    """
    if existing:
        return existing
    local = root / ".uv" / ("uv.exe" if platform == "windows" else "uv")
    if local.exists():
        return str(local)
    if platform == "windows":
        return ""
    with tempfile.TemporaryDirectory() as work:
        script = Path(work) / "uv-install.sh"
        got = download(console, "Downloading uv", UV_INSTALLER, script, counter)
        if not got.ok:
            return ""
        env = dict(os.environ)
        env["UV_INSTALL_DIR"] = str(root / ".uv")
        env["UV_NO_MODIFY_PATH"] = "1"
        result = console.run("Installing uv", ["sh", str(script)], env=env,
                             counter=counter)
        if not result.ok:
            return ""
    return str(local) if local.exists() else ""


def make_venv(console: Console, root: Path, platform: str, python: str,
              uv: str, counter: str = "") -> Result:
    if venv_python(root, platform).exists():
        return Result(True, 0, 0.0, [])
    if uv:
        result = console.run("Creating the virtual environment",
                             [uv, "venv", "--python", "3.13", str(root / ".venv")],
                             cwd=root, counter=counter)
        if result.ok:
            return result
        return console.run("Creating the virtual environment",
                           [uv, "venv", str(root / ".venv")], cwd=root,
                           counter=counter)
    return console.run("Creating the virtual environment",
                       [python, "-m", "venv", str(root / ".venv")], cwd=root,
                       counter=counter)


def install_dependencies(console: Console, root: Path, platform: str, uv: str,
                         counter: str = "") -> Result:
    """The longest step of the install, and the one that used to be silent.

    Not `--quiet`, deliberately.  The tool's own output is the only honest
    progress there is: it names each package as it goes, and when something
    stalls on a slow mirror that line is exactly what you want to see.  The
    spinner goes beside it, not over the top of it.
    """
    env = dict(os.environ)
    env["VIRTUAL_ENV"] = str(root / ".venv")
    if uv:
        return console.run(
            "Installing the Python dependencies",
            [uv, "pip", "install", "-r", str(root / "requirements.txt")],
            cwd=root, env=env, counter=counter,
        )
    python = venv_python(root, platform)
    console.run("Updating pip", [str(python), "-m", "pip", "install", "--quiet",
                                 "--upgrade", "pip"], cwd=root, counter="")
    return console.run(
        "Installing the Python dependencies",
        [str(python), "-m", "pip", "install", "-r", str(root / "requirements.txt")],
        cwd=root, counter=counter,
    )


def install_iroh(console: Console, root: Path, platform: str, uv: str) -> Result:
    """Sharing a project needs iroh, which publishes wheels for Linux, Windows
    and Apple-silicon Macs and no source distribution at all.

    Allowed to fail: everything else in NextTex works without it, and the
    share card says so rather than offering a button that cannot work.
    """
    env = dict(os.environ)
    env["VIRTUAL_ENV"] = str(root / ".venv")
    if uv:
        argv = [uv, "pip", "install", "--quiet", "iroh"]
    else:
        argv = [str(venv_python(root, platform)), "-m", "pip", "install",
                "--quiet", "iroh"]
    return console.run("Installing iroh, for sharing a project", argv,
                       cwd=root, env=env)


# ---------------------------------------------------------------------------
# TeX


def install_tex(console: Console, root: Path, platform: str, choice: str,
                counter: str = "") -> Result:
    if choice == "miktex":
        return console.run(
            "Installing MiKTeX",
            ["winget", "install", "--id", "MiKTeX.MiKTeX", "--silent",
             "--accept-package-agreements", "--accept-source-agreements"],
            cwd=root, counter=counter,
        )
    with tempfile.TemporaryDirectory() as work:
        if platform == "windows":
            script = Path(work) / "install-tinytex.bat"
            got = download(console, "Downloading TinyTeX", TINYTEX_WINDOWS,
                           script, counter)
            if not got.ok:
                return got
            # cmd.exe explicitly, never shell=True: this is a batch file, and
            # nothing else on the machine can read one.
            return console.run("Installing TinyTeX",
                               ["cmd.exe", "/c", str(script)], cwd=root,
                               counter=counter)
        script = Path(work) / "install-tinytex.sh"
        got = download(console, "Downloading TinyTeX", TINYTEX_UNIX, script,
                       counter)
        if not got.ok:
            return got
        return console.run("Installing TinyTeX", ["sh", str(script)], cwd=root,
                           counter=counter)


def install_tex_extras(console: Console, root: Path, missing: list,
                       counter: str = "") -> Result:
    """latexmk, biber, synctex, chktex, texcount.

    The same five on every platform, for the same reason: a project that uses
    biber or chktex must not fail on its first build.
    """
    return console.run("Adding " + ", ".join(missing),
                       ["tlmgr", "install", *missing], cwd=root, counter=counter)


# ---------------------------------------------------------------------------
# The writing agent


def claude_install_command(platform: str, script: Path) -> list:
    """How the Claude CLI is installed, once, for both callers.

    The installer runs this, and so does the settings sheet when somebody
    who opted out changes their mind.  Keeping it in one function is the
    same reason the rest of this rework exists: two copies of an install
    step is how the two copies end up different.
    """
    if platform == "windows":
        return ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", str(script)]
    return ["bash", str(script)]


def claude_install_url(platform: str) -> str:
    return CLAUDE_WINDOWS if platform == "windows" else CLAUDE_UNIX


def claude_script_name(platform: str) -> str:
    return "claude-install.ps1" if platform == "windows" else "claude-install.sh"


def install_claude_cli(console: Console, platform: str, counter: str = "") -> Result:
    """Fetch the vendor's installer and run it.

    Called by the installer, and by `POST /api/claude/install` when somebody
    adds an agent later from the settings sheet.  Both go through here so
    there is one answer to "how does the Claude CLI get installed".
    """
    with tempfile.TemporaryDirectory() as work:
        script = Path(work) / claude_script_name(platform)
        got = download(console, "Downloading the Claude CLI installer",
                       claude_install_url(platform), script, counter)
        if not got.ok:
            return got
        return console.run("Installing the Claude CLI",
                           claude_install_command(platform, script),
                           counter=counter)


# ---------------------------------------------------------------------------
# The interface


def fetch_interface(console: Console, root: Path, platform: str,
                    counter: str = "") -> Result:
    """Downloaded, not built.

    Every machine used to need Node 20+ for the sole purpose of producing an
    artefact that is identical for everyone: there is no `base`, no `define`
    and no VITE_ variable anywhere in the source, so the build CI does is the
    build you would have done.

    The word "interface" has to survive in whatever this prints.  `_STEPS` in
    server/main.py matches on it to name the step the in-app update footer is
    showing.
    """
    if platform == "windows":
        argv = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", str(root / "scripts" / "fetch-interface.ps1")]
    else:
        argv = [str(root / "scripts" / "fetch-interface.sh")]
    return console.run("Downloading the interface", argv, cwd=root, counter=counter)


def build_interface(console: Console, root: Path, counter: str = "") -> Result:
    frontend = root / "frontend"
    npm = shutil.which("npm") or "npm"
    result = console.run("Installing the interface's own dependencies",
                         [npm, "ci", "--no-audit", "--no-fund"], cwd=frontend,
                         counter=counter)
    if not result.ok:
        return result
    return console.run("Building the interface", [npm, "run", "build"],
                       cwd=frontend, counter=counter)


# ---------------------------------------------------------------------------
# Configuration


CONFIG_SCRIPT = r'''
import sys
sys.path.insert(0, sys.argv[1])
from nexttex.config import Settings

root, bind, cert, key, provider, instance = sys.argv[1:7]
settings = Settings.load()
# A second install cannot share the first's port.  Only chosen on a first
# install: an existing config keeps whatever it was set to.
if instance and settings.port == 8450:
    settings.port = 8451
settings.localhost = True
settings.tailscale = bind != "localhost"
settings.certfile = cert
settings.keyfile = key
# Written for the first time here.  Neither installer used to set it at all,
# so config kept its default of "claude" whatever was chosen -- an install
# that had opted out still claimed an agent that was not on the machine.
if provider:
    settings.provider = provider
    if provider != "openai":
        settings.openai_key = ""
settings.save()
print("listening: localhost" + (" and tailscale" if settings.tailscale else ""))
print("agent: " + settings.provider)
'''


def write_config(console: Console, root: Path, platform: str, *, bind: str,
                 cert: str, key: str, provider: str, instance: str,
                 python: str = "", counter: str = "") -> Result:
    env = dict(os.environ)
    env["NEXTTEX_INSTANCE"] = instance
    return console.run(
        "Writing the configuration",
        [python or str(venv_python(root, platform)), "-c", CONFIG_SCRIPT,
         str(root), bind, cert, key, provider, instance],
        cwd=root, env=env, counter=counter,
    )


def generate_certificate(console: Console, root: Path, instance: str,
                         counter: str = "") -> Result:
    env = dict(os.environ)
    env["NEXTTEX_INSTANCE"] = instance
    return console.run("Making a TLS certificate for the tailnet address",
                       [str(root / "scripts" / "gen_cert.sh")], cwd=root,
                       env=env, counter=counter)

"""The installer.

Run as `python -m nexttex.install` by `scripts/install.sh` and
`scripts/install.ps1`, which do only what cannot be done in Python: guard
the platform, check for git, ask where to put the checkout, clone it, and
find an interpreter to run this with.  Everything after that is here, once,
for all three platforms.

The shape is five phases and questions happen in exactly one of them:

    where  ->  survey  ->  plan  ->  work  ->  ready

`where` is the bootstrap's, because before the clone there is no checkout
and nothing to survey.  `survey` asks nothing and prints everything,
including the things NextTex will not install for you, with the command for
each.  `plan` prices the whole job and takes one confirmation.  `work` is
unattended.  That order is the answer to the complaint that produced this
file: you should not have to start an install to find out what it is going
to do.

Nothing in this package imports anything outside the standard library.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

from ..paths import state_home
from . import service as service_mod
from . import steps
from .plan import build_plan
from .survey import (FETCHED, NOT_NEEDED, PRESENT, TEX_EXTRAS, YOURS,
                     survey, tex_tool, this_platform)
from .ui import Console


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m nexttex.install",
        description="Install NextTex.",
    )
    parser.add_argument("--yes", "-y", action="store_true",
                        help="take the defaults and ask nothing")
    parser.add_argument("--plain", action="store_true",
                        help="no animation, one line per step")
    parser.add_argument("--dir", default="",
                        help="accepted and ignored: the bootstrap already used it")
    parser.add_argument("--tex", choices=["tinytex", "miktex", "none"], default="")
    parser.add_argument("--agent", choices=["claude", "openai", "none"], default="")
    parser.add_argument("--bind", choices=["localhost", "both"], default="")
    parser.add_argument("--service", dest="service", action="store_const",
                        const="yes", default="")
    parser.add_argument("--no-service", dest="service", action="store_const",
                        const="no")
    parser.add_argument("--instance", default=os.environ.get("NEXTTEX_INSTANCE", ""))
    parser.add_argument("--root", default="", help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def is_interactive(args) -> bool:
    """Whether there is anybody to ask.

    Unattended when `--yes`, when either end of the terminal is a pipe, or
    when CI is set.  The plan is printed either way -- that is what stops
    `--yes` from being a silent 200 MB download, which is what it used to be.
    """
    if args.yes or args.plain:
        return False
    if os.environ.get("CI"):
        return False
    try:
        return bool(sys.stdin.isatty() and sys.stdout.isatty())
    except Exception:
        return False


def main(argv=None) -> int:
    args = parse_args(argv)
    root = Path(args.root or os.getcwd()).resolve()
    platform = this_platform()
    interactive = is_interactive(args)

    if args.instance:
        os.environ["NEXTTEX_INSTANCE"] = args.instance
    state = state_home()
    console = Console(plain=not interactive, log=state / "install.log")

    console.write("")
    console.write("  " + console.bold("NextTex"))
    console.note(f"installing the checkout at {root}")

    _tidy_stray_state(console, platform)

    result = survey(platform, root)
    show_survey(console, result)

    answers = {}
    for key in ("tex", "agent", "bind", "service"):
        value = getattr(args, key)
        if value:
            answers[key] = value
    plan = build_plan(result, interactive=interactive, answers=answers)

    if not confirm(console, plan, interactive):
        console.write("")
        console.note("Nothing was installed.")
        return 1

    return execute(console, plan, root, platform, args.instance)


# ---------------------------------------------------------------------------
# The survey on screen


GROUP_TITLES = [
    (PRESENT, "Found"),
    (FETCHED, "NextTex will fetch these"),
    (YOURS, "You will have to install these yourself"),
    (NOT_NEEDED, "Not needed here"),
]


NAME_WIDTH = 16
RIGHT_WIDTH = 13


def show_survey(console: Console, result) -> None:
    """The four groups, wrapped to the terminal rather than off the edge of it.

    Wrapping is not a nicety here.  Several of these explanations are a full
    sentence, and at a column of 34 they ran to a hundred characters -- so
    the first screen of the first thing anybody runs was a wall of wrapped
    stumps in an eighty-column terminal.
    """
    import textwrap

    width = min(console.width - 2, 78)
    indent = " " * (6 + NAME_WIDTH + RIGHT_WIDTH)
    body = max(24, width - len(indent))

    console.rule("What is on this machine")
    for kind, title in GROUP_TITLES:
        findings = result.of_kind(kind)
        if not findings:
            continue
        console.write("")
        console.note(console.bold(title))
        for finding in findings:
            right = finding.version or finding.size or ""
            head = f"  {finding.name:<{NAME_WIDTH}}{right:<{RIGHT_WIDTH}}"
            # What goes in the wide column, in order of what is worth saying.
            # Where it is, for something already here; why it matters, for
            # something that is not.  A thing that is missing and does not
            # matter gets no install command: an instruction under "not
            # needed here" is one nobody asked for.
            said = [finding.why] if finding.why else []
            if finding.where:
                said.append(finding.where)
            if finding.command and finding.kind == YOURS:
                said.append(finding.command)
            if not said:
                console.note(head.rstrip())
                continue
            first = True
            for paragraph in said:
                # A command is never wrapped: it is meant to be copied.
                pieces = ([paragraph] if paragraph == finding.command
                          else textwrap.wrap(paragraph, body) or [""])
                if paragraph == finding.command:
                    # Never wrapped, and pulled left rather than off the edge
                    # when the window is narrow: a copy-paste line has to
                    # arrive in one piece whatever size the terminal is.
                    room = max(6, min(len(indent) + 2, width - len(paragraph)))
                    console.write(" " * room + paragraph)
                    continue
                for piece in pieces:
                    if first:
                        console.note((head + piece).rstrip())
                        first = False
                    else:
                        console.write(indent + piece)
    if result.offline:
        console.write("")
        console.note(console.red("Cannot reach: " + ", ".join(result.offline)))
        console.note("  The downloads below will fail. Check your connection first.")


# ---------------------------------------------------------------------------
# The plan on screen, and the one confirmation


def show_plan(console: Console, plan) -> None:
    import textwrap

    megabytes = plan.megabytes
    console.rule("The plan")
    console.write("")
    if megabytes:
        console.note(f"about {megabytes} MB, roughly {plan.minutes} minutes"
                     " on a fast connection")
    else:
        console.note("nothing to download")
    console.write("")
    width = min(console.width - 2, 78)
    indent = " " * (4 + 3 + 15)
    for index, item in enumerate(plan.items, 1):
        head = f"    {index}  {item.title:<15}"
        lines = textwrap.wrap(item.summary, max(24, width - len(indent))) or [""]
        console.write(head + lines[0])
        for line in lines[1:]:
            console.write(indent + line)
    console.write("")
    if plan.choice("tex") in ("tinytex", "miktex"):
        console.paragraph("Nothing outside this directory is written except "
                          "TeX, in its own folder in your home directory.")
    else:
        console.paragraph("Nothing outside this directory is written.")


def confirm(console: Console, plan, interactive: bool) -> bool:
    show_plan(console, plan)
    if not interactive:
        console.write("")
        console.note("Proceeding without asking.")
        return True
    while True:
        console.write("")
        reply = console.ask(
            "  Press return to go ahead, a number to change it, or q to stop. > ",
            "",
        ).strip().lower()
        if reply in ("", "y", "yes"):
            return True
        if reply in ("q", "quit", "n", "no"):
            return False
        if reply.isdigit() and 1 <= int(reply) <= len(plan.items):
            change(console, plan, plan.items[int(reply) - 1])
            show_plan(console, plan)
            continue
        console.note("  Not one of the choices.")


def change(console: Console, plan, item) -> None:
    console.write("")
    console.note(console.bold(item.title))
    if item.fixed:
        console.write("")
        console.paragraph(item.fixed, lead="  ")
        console.paragraph("There is nothing to decide here.", lead="  ")
        return
    if item.explain:
        console.write("")
        console.paragraph(" ".join(item.explain.split()), lead="  ")
    console.write("")
    for line in item.prompt().splitlines():
        console.note("  " + line)
    console.write("")
    reply = console.ask(f"  Choose [{item.default_index()}]: ",
                        str(item.default_index())).strip()
    if reply.isdigit() and 1 <= int(reply) <= len(item.options):
        item.choice = item.options[int(reply) - 1].value


# ---------------------------------------------------------------------------
# Doing it


def execute(console: Console, plan, root: Path, platform: str,
            instance: str) -> int:
    total = len(plan.items)
    result = plan.survey
    notes: list = []
    console.rule("")

    def counter(n: int) -> str:
        return f"[{n}/{total}]"

    # 1 -- Python -----------------------------------------------------------
    console.write("")
    console.note(console.bold(f"{counter(1)} Python"))
    uv = result.uv
    if not uv and not result.has_ensurepip:
        uv = steps.ensure_uv(console, root, platform, result.uv)
        if not uv:
            console.note("could not install uv; trying this Python's own venv")
    venv = steps.make_venv(console, root, platform, sys.executable, uv)
    if not venv.ok:
        console.failed(venv, _venv_advice(platform))
        return 1
    deps = steps.install_dependencies(console, root, platform, uv)
    if not deps.ok:
        console.failed(deps, "The Python dependencies did not install, so NextTex "
                             "cannot start.")
        return 1
    iroh = steps.install_iroh(console, root, platform, uv)
    if not iroh.ok:
        notes.append("no iroh build for this platform, so a project cannot be "
                     "shared with another person; everything else works")

    # 2 -- TeX --------------------------------------------------------------
    console.write("")
    console.note(console.bold(f"{counter(2)} TeX"))
    tex_choice = plan.choice("tex")
    if tex_choice == "present":
        console.skipped("already here", result.tex_dir)
    elif tex_choice == "none":
        console.skipped("skipped", "NextTex will start but cannot typeset")
        notes.append("no TeX, so builds will fail until one is installed. "
                     "Run this installer again once there is.")
    else:
        tex = steps.install_tex(console, root, platform, tex_choice)
        if not tex.ok:
            console.failed(tex, "TeX did not install. Everything else is fine; "
                                "run the installer again to retry just this.")
            notes.append("TeX did not install, so builds will fail")

    # Whatever happened above, TeX's own directory goes on PATH before
    # anything asks what is installed.  This used to run only where TinyTeX
    # had just been installed, which is the one case where it was least
    # needed: a machine that already had TeX skipped it, `shutil.which`
    # then found no tlmgr, and the install said "no tlmgr, so latexmk,
    # biber, synctex, chktex and texcount are still missing" with tlmgr and
    # latexmk both present in a directory it had just printed on screen.
    # It exited successfully, which is the worst version of that.
    _add_tex_to_path()

    # Asked again, not read off the survey.  The survey ran before TinyTeX
    # existed, so on a fresh machine it said there was no tlmgr and no way
    # to add anything with it, which was true then and false now.  Trusting
    # that stale answer left every new install without latexmk, biber,
    # synctex, chktex or texcount: a NextTex that starts, opens a project,
    # and fails on its first full build.
    missing = _missing_tex_extras(result.tex_dir)
    tlmgr = tex_tool("tlmgr", result.tex_dir)
    if missing and tlmgr:
        extras = steps.install_tex_extras(console, root, missing, tlmgr)
        if not extras.ok:
            notes.append("tlmgr could not add " + ", ".join(missing)
                         + "; NextTex says which at startup")
    elif missing:
        notes.append("no tlmgr, so " + ", ".join(missing) + " are still "
                     "missing; a project that uses them will not build")

    # 3 -- the writing agent -------------------------------------------------
    console.write("")
    console.note(console.bold(f"{counter(3)} Writing agent"))
    agent = plan.choice("agent")
    if agent == "claude" and result.claude:
        console.skipped("the Claude CLI is already here",
                        "you sign in from the browser, not here")
    elif agent == "claude":
        installed = steps.install_claude_cli(console, platform)
        if not installed.ok:
            console.failed(installed,
                           "The Claude CLI did not install. Nothing else is "
                           "affected: choose OpenAI or no agent on the first "
                           "screen, or add Claude later from the settings sheet.")
            notes.append("the Claude CLI did not install; you can add it later "
                         "from Settings -> Change without reinstalling")
            agent = "none"
    elif agent == "openai":
        console.skipped("nothing to install", "paste your API key on the first screen")
    else:
        console.skipped("none", "everything except the agent works exactly the same")

    # 4 -- the interface -----------------------------------------------------
    console.write("")
    console.note(console.bold(f"{counter(4)} Interface"))
    fetched = steps.fetch_interface(console, root, platform)
    if not fetched.ok:
        if result.node_major >= 20:
            console.note("building it here instead")
            built = steps.build_interface(console, root)
            if not built.ok:
                console.failed(built, "Could not download or build the interface.")
                return 1
        elif result.interface_present:
            console.note("keeping the interface already built")
            notes.append("could not download the interface for this commit; the "
                         "one already here is being used")
        else:
            console.failed(fetched,
                           "Could not download the interface, and there is no "
                           "Node here to build one. Check your connection, or "
                           "install Node 20+ from https://nodejs.org and run "
                           "this again.")
            return 1

    # 5 -- how it listens ----------------------------------------------------
    console.write("")
    console.note(console.bold(f"{counter(5)} Listening"))
    bind = plan.choice("bind")
    cert = key = ""
    if bind != "localhost":
        made = steps.generate_certificate(console, root, instance)
        if made.ok:
            cert = str(state_home() / "cert.pem")
            key = str(state_home() / "key.pem")
        else:
            console.note("the certificate step did not finish; falling back to "
                         "localhost only")
            bind = "localhost"
    wrote = steps.write_config(console, root, platform, bind=bind, cert=cert,
                               key=key, provider=agent, instance=instance)
    if not wrote.ok:
        console.failed(wrote, "The configuration could not be written.")
        return 1
    for line in wrote.output:
        console.note("  " + line)

    # 6 -- starting at login --------------------------------------------------
    console.write("")
    console.note(console.bold(f"{counter(6)} At login"))
    if plan.choice("service") == "yes":
        install_service(console, root, platform, instance, result, notes)
    else:
        console.skipped("not set up", _start_yourself(root, platform))

    ready(console, root, platform, instance, notes, agent)
    return 0


def install_service(console: Console, root: Path, platform: str, instance: str,
                    result, notes: list) -> None:
    home = Path.home()
    state = state_home()
    if platform == "windows":
        registered = console.run("Registering the login task",
                                 service_mod.register_task_argv(root, instance),
                                 cwd=root)
        if not registered.ok:
            notes.append("could not arrange a login start; start it yourself "
                         "with: " + _start_yourself(root, platform))
        return
    if result.service == "launchd":
        path = service_mod.plist_path(home, instance)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(service_mod.launchd_plist(root, home, state, instance),
                        encoding="utf-8")
        console.note(f"  launch agent written to {path}")
        console.run("Loading it", ["launchctl", "unload", str(path)])
        loaded = console.run("Starting NextTex", ["launchctl", "load", str(path)])
        if not loaded.ok:
            notes.append(f"could not load the launch agent; try: launchctl load {path}")
        return
    if result.service == "systemd":
        path = service_mod.unit_path(home, instance,
                                     os.environ.get("XDG_CONFIG_HOME", ""))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(service_mod.systemd_unit(root, home, state, instance),
                        encoding="utf-8")
        console.note(f"  unit written to {path}")
        console.run("Reloading systemd", ["systemctl", "--user", "daemon-reload"])
        name = service_mod.unit_name(instance)
        started = console.run("Starting NextTex",
                              ["systemctl", "--user", "enable", "--now", name])
        if not started.ok:
            notes.append(f"could not start the unit; try: systemctl --user start {name}")
            return
        linger = console.run("Keeping it running after you log out",
                             ["loginctl", "enable-linger", os.environ.get("USER", "")])
        if not linger.ok:
            notes.append("run 'sudo loginctl enable-linger "
                         f"{os.environ.get('USER', '')}' to keep it running "
                         "after you log out")
        return
    console.skipped("no service manager here", _start_yourself(root, platform))


def ready(console: Console, root: Path, platform: str, instance: str,
          notes: list, agent: str) -> None:
    console.rule("Ready")
    env = dict(os.environ)
    env["NEXTTEX_INSTANCE"] = instance
    python = steps.venv_python(root, platform)
    url = console.run("Working out the address",
                      [str(python), str(root / "server" / "run.py"), "--print-url"],
                      cwd=root, env=env)
    console.write("")
    for line in url.output:
        console.note(line.strip())
    console.write("")
    console.paragraph("That link contains your access token. Anyone with it "
                      "can read and edit your projects, so treat it like a "
                      "password.")
    if agent == "none":
        console.write("")
        console.paragraph("No agent installed. You can add one later from "
                          "Settings -> Change, without reinstalling.")
    if notes:
        console.write("")
        console.note(console.bold("Not everything was perfect:"))
        for note in notes:
            console.paragraph(note, lead="  ")
    if console.log is not None:
        console.write("")
        console.note(f"Log of everything above: {console.log}")
    console.write("")


# ---------------------------------------------------------------------------
# Small things


def _venv_advice(platform: str) -> str:
    if platform == "windows":
        return "Could not create the virtual environment."
    return ("Could not create the virtual environment. On Debian or Ubuntu:\n"
            "      sudo apt install python3-venv\n"
            "    then run this again.")


def _start_yourself(root: Path, platform: str) -> str:
    if platform == "windows":
        return r".venv\Scripts\python.exe server\run.py"
    return ".venv/bin/python server/run.py"




def _missing_tex_extras(tex_dir=None) -> list:
    """Which of the five a project needs are still missing, asked now.

    A project that uses biber or chktex must not fail on its first build,
    and the answer changes the moment TinyTeX finishes installing.

    `tex_dir` is consulted as well as PATH, through the same `tex_tool` the
    survey uses.  A bare `shutil.which` here reported `latexmk` missing on
    a machine that had it, because TinyTeX's bin directory is not on PATH
    by default.
    """
    return [name for name in TEX_EXTRAS if not tex_tool(name, tex_dir)]


def _add_tex_to_path() -> None:
    from ..tools import TEX_HINTS

    for hint in TEX_HINTS:
        if hint.is_dir():
            current = os.environ.get("PATH", "").split(os.pathsep)
            if str(hint) not in current:
                os.environ["PATH"] = os.pathsep.join([str(hint), *current])


def _tidy_stray_state(console: Console, platform: str) -> None:
    """Remove the empty directory the old Windows installer left behind.

    It made `%LOCALAPPDATA%\\nexttex` and never used it -- config actually
    lands in `~\\.local\\share\\nexttex`, which is what `state_home()` says on
    every platform.  Only removed when it is empty, so a machine that
    somehow does keep something there loses nothing.
    """
    if platform != "windows":
        return
    stray = os.environ.get("LOCALAPPDATA")
    if not stray:
        return
    path = Path(stray) / "nexttex"
    if path.is_dir() and not any(path.iterdir()):
        try:
            path.rmdir()
        except OSError:
            pass


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n  Stopped. Nothing else was installed.")
        sys.exit(130)

"""What has to hold on a machine that is not this one.

NextTex is developed on Linux and released for three platforms, so the
things that would break elsewhere are the things nobody here will notice.
These are the ones that can be checked without the other machine.
"""

import ast
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

# Modules that do not exist on Windows.  Importing one at the top of a
# module means the whole server fails to start there rather than one
# feature being unavailable.
POSIX_ONLY = {"fcntl", "pty", "termios", "grp", "pwd", "resource", "tty"}

# Whose machine this was written on.  Split so the test file itself does
# not contain the string it is looking for.
USER = "dakshi" + "tha"


def python_sources() -> list[Path]:
    return [
        path
        for folder in ("nexttex", "server")
        for path in (ROOT / folder).rglob("*.py")
        if "vendor" not in path.parts
    ]


def test_no_posix_only_module_is_imported_at_module_level():
    """`import pty` at the top of claude_auth used to be enough to stop
    NextTex starting on Windows -- not the sign-in, the whole server."""
    offenders = []
    for path in python_sources():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            # Only module level: an import inside a function or a try/except
            # is a deliberate, guarded one.
            if not isinstance(node, (ast.Import, ast.ImportFrom)):
                continue
            if getattr(node, "col_offset", 0) != 0:
                continue
            names = (
                [alias.name.split(".")[0] for alias in node.names]
                if isinstance(node, ast.Import)
                else [(node.module or "").split(".")[0]]
            )
            for name in names:
                if name in POSIX_ONLY:
                    offenders.append(f"{path.relative_to(ROOT)}: {name}")
    assert not offenders, "\n".join(offenders)


def test_the_pseudo_terminal_login_says_so_rather_than_failing():
    from nexttex import claude_auth

    source = claude_auth.__doc__ or ""
    assert hasattr(claude_auth, "HAVE_PTY")
    # And the message names the two ways out, because a dead end on the
    # first screen of a new install is the worst place to have one.
    import inspect

    text = inspect.getsource(claude_auth.start_login)
    assert "OpenAI key" in text and "claude auth login" in text


def test_tex_is_looked_for_on_all_three_platforms():
    from nexttex.config import TEX_HINTS

    # Separators normalised, because `Path("/Library/TeX/texbin")` renders
    # itself with backslashes on Windows and this is an assertion about the
    # list, not about the platform reading it.
    joined = " ".join(str(hint).replace("\\", "/") for hint in TEX_HINTS)
    assert "x86_64-linux" in joined, "no Linux TinyTeX path"
    assert "universal-darwin" in joined, "no macOS TinyTeX path"
    assert "TeX/texbin" in joined, "no MacTeX path"
    assert "MiKTeX" in joined, "no Windows MiKTeX path"
    assert "texlive" in joined.lower()


def test_the_installers_exist_for_every_platform_the_readme_claims():
    assert (ROOT / "scripts" / "install.sh").exists()
    assert (ROOT / "scripts" / "install.ps1").exists()
    assert (ROOT / "scripts" / "update.sh").exists()
    assert (ROOT / "scripts" / "update.ps1").exists()


def test_the_unix_installer_refuses_windows_rather_than_half_running():
    text = (ROOT / "scripts" / "install.sh").read_text(encoding="utf-8")
    assert "install.ps1" in text, "does not point Windows users anywhere"
    assert "Darwin" in text and "Linux" in text


def test_the_installer_looks_for_tex_where_macos_puts_it():
    """This used to grep install.sh for the path.

    The knowledge lives in `nexttex/tools.py` now, in one place rather than
    three -- it was in the two shell scripts and in config.py, and the three
    had already drifted apart.  Asserting on the real list is also an
    assertion a bug could fail: the grep version would have passed for every
    single defect this rework fixed.
    """
    from nexttex.tools import TEX_HINTS

    joined = " ".join(str(hint).replace("\\", "/") for hint in TEX_HINTS)
    assert "universal-darwin" in joined
    assert "TeX/texbin" in joined
    assert "TinyTeX/bin/windows" in joined


def test_the_installer_can_start_on_login_on_every_platform():
    from nexttex.install import service

    root, home, state = Path("/opt/nexttex"), Path("/home/ada"), Path("/state")
    assert "WantedBy=default.target" in service.systemd_unit(root, home, state, "")
    assert "<key>RunAtLoad</key>" in service.launchd_plist(root, home, state, "")
    assert "register-task.ps1" in " ".join(service.register_task_argv(root, ""))
    assert (ROOT / "scripts" / "register-task.ps1").is_file()


def test_the_words_the_update_footer_matches_on_survive():
    """`_STEPS` in server/main.py reads the update script's output line by
    line and matches substrings in it to name the step being watched.  Both
    update scripts carry a comment saying so; this is the assertion.

    Every phase the footer names is checked on both platforms except
    "Done" -- only update.sh prints it, and both it and "Restarting" map to
    the same label, so the Windows footer says "Finishing" either way.
    """
    from server.main import _STEPS

    for script in ("update.sh", "update.ps1"):
        text = (ROOT / "scripts" / script).read_text(encoding="utf-8")
        for needle, _label in _STEPS:
            if needle == "Done" and script.endswith(".ps1"):
                continue
            assert needle in text, f"{script} no longer prints {needle!r}"


def test_the_installer_still_says_the_word_the_footer_watches_for():
    """The interface step is the one the footer names by that word, and the
    installer downloads the interface too, through the same wrapper."""
    from nexttex.install import steps
    import inspect

    assert "interface" in inspect.getsource(steps.fetch_interface)


def test_the_installer_is_posix_shell_because_the_readme_pipes_it_into_sh():
    """`curl ... | sh` never reads the shebang: whatever `sh` is executes the
    text, and on Debian and Ubuntu that is dash.  `set -o pipefail` on line
    seven meant the documented install command died before printing a word,
    on the most common Linux there is."""
    text = (ROOT / "scripts" / "install.sh").read_text(encoding="utf-8")
    # Comments stripped: the file explains at length why pipefail is not
    # here, and the explanation must not trip the check it explains.
    code = "\n".join(line for line in text.splitlines()
                     if not line.lstrip().startswith("#"))
    assert "pipefail" not in code
    assert "[[" not in code, "a bash conditional in a script run by dash"
    shell = shutil.which("dash") or shutil.which("sh")
    if shell is None or os.name == "nt":                 # pragma: no cover
        # Git for Windows ships a dash, and also converts LF to CRLF on
        # checkout, so the file it would be handed there has carriage
        # returns in it and fails on the first `case` whatever the syntax
        # is.  `.gitattributes` now pins `*.sh` to LF, but the check itself
        # belongs where the script actually runs.
        pytest.skip("no POSIX shell whose checkout of this file is faithful")
    assert subprocess.run([shell, "-n", str(ROOT / "scripts" / "install.sh")],
                          capture_output=True).returncode == 0


def test_nothing_shipped_hardcodes_a_path_from_the_machine_it_was_written_on():
    """A stranger opening any of this should not find somebody else's home
    directory or conda environment in it.  Scripts were the obvious place;
    a real thesis path in a docstring was the one that got through."""
    # Assembled rather than written out, so this test does not trip itself.
    mine = "/" + "home/" + USER, "/" + "data/" + USER
    offenders = []
    for path in [
        *python_sources(),
        *(ROOT / "nexttex" / "vendor").rglob("*.py"),
        *(ROOT / "scripts").glob("*.sh"),
        *(ROOT / "scripts").glob("*.ps1"),
    ]:
        text = path.read_text(encoding="utf-8")
        if any(needle in text for needle in (*mine, "miniconda")):
            offenders.append(str(path.relative_to(ROOT)))
    assert not offenders, offenders


def test_nothing_private_is_committed_with_the_example_project():
    """`.nexttex/` holds a project's history, its trash, its agent
    transcript and the id of the Claude session that produced it.  It was
    committed once, along with the example project, and went out in a
    public push."""
    ignored = (ROOT / ".gitignore").read_text(encoding="utf-8")
    assert ".nexttex/" in ignored
    assert not (ROOT / "examples" / "minimal-article" / ".nexttex").exists()


def test_the_example_project_is_generic():
    """The example is the first thing a new install opens, and it is a real
    project on disk -- so driving the running app against it edits the file
    that ships, and a `git add -A` commits whatever the session left there.
    That is exactly what happened: the published copy carried a tail of
    test detritus (`\\notarealcommand`, `A settled sentence.`) appended
    after `\\end{document}` by browser specs and by hand."""
    main = (ROOT / "examples" / "minimal-article" / "main.tex").read_text(
        encoding="utf-8"
    )
    tail = main.split("\\end{document}", 1)[1]
    assert not tail.strip(), f"detritus after the document ends: {tail[:80]!r}"
    # Nothing in it should name a person, an institution or a real project.
    lowered = main.lower()
    for needle in ("dissertation", "temple", "matsika", "dakshitha"):
        assert needle not in lowered, needle


def test_nothing_ships_with_the_authors_own_contact_details():
    """The vendored scholarly tools hard-coded the author's email address
    and a User-Agent naming their dissertation.  That was fine while this
    was one person's tooling; published, it made every user's literature
    searches identify as -- and give a contact address for -- somebody
    else."""
    import re

    leaks = []
    pattern = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
    for path in python_sources() + list((ROOT / "nexttex" / "vendor").rglob("*.py")):
        for match in pattern.findall(path.read_text(encoding="utf-8")):
            if match.endswith((".invalid", ".example", "@localhost")):
                continue          # deliberate placeholders
            leaks.append(f"{path.relative_to(ROOT)}: {match}")
    assert not leaks, "\n".join(leaks)


def test_the_scholarly_apis_are_told_who_is_calling_generically():
    """And the address, when there is one, is the user's own."""
    from nexttex.references import _load

    for name in ("lit_search", "bib_from_doi", "verify_bib"):
        module = _load(name)
        assert module.UA.startswith("nexttex-"), module.UA
        assert "thesis" not in module.UA, module.UA


# Every host the shipped code can talk to.  The README names these, and a
# reader deciding whether to run NextTex on a machine they care about is
# entitled to that list being complete.
OUTBOUND = {
    "api.anthropic.com",        # the Claude agent, via its own SDK
    "api.openai.com",           # the OpenAI agent
    "api.crossref.org",         # the reference pipeline
    "api.openalex.org",
    "api.semanticscholar.org",
    "export.arxiv.org",
    "doi.org",
    "dx.doi.org",
    "claude.ai",                # the sign-in screen links to the download page
    "github.com",               # the prebuilt interface, and the update check
    # The installer, and only what the plan it printed said it would fetch.
    "yihui.org",                # TinyTeX
    "astral.sh",                # uv, when this Python cannot make a venv
    "codeload.github.com",      # reachability probe before anything is asked
    # Named in what the installer prints, never contacted: these appear in
    # the survey's "you will have to install this yourself" lines.
    "nodejs.org",
    "tailscale.com",
    "www.apple.com",            # the DOCTYPE of a launchd plist
}

# Hosts NextTex reaches through a library rather than by naming them, so the
# scan below cannot see them.  iroh's discovery and relays are contacted by
# `preset_n0()` and appear in no source file of ours -- which means the test
# that keeps the README honest would have gone on passing while the README
# quietly became false.  That is worse than a failure, so they are asserted
# separately, by name.
THROUGH_A_LIBRARY = {
    "dns.iroh.link":            "iroh's discovery, so two peers can find each other",
    "relay.n0.iroh.link":       "iroh's relays, when two peers cannot reach each other directly",
}


def test_the_shipped_code_talks_to_nothing_the_readme_does_not_name():
    """Not a security boundary -- a promise being kept.  A new host here
    without a matching line in the README turns a stated fact into a
    stale one, which is worse than never having claimed it."""
    import re

    host = re.compile(r"https?://([a-z0-9.-]+\.[a-z]{2,})", re.I)
    found: dict[str, str] = {}
    for path in python_sources() + list((ROOT / "nexttex" / "vendor").rglob("*.py")):
        for match in host.findall(path.read_text(encoding="utf-8")):
            found.setdefault(match.lower(), str(path.relative_to(ROOT)))

    surprises = {name: where for name, where in found.items() if name not in OUTBOUND}
    assert not surprises, (
        "new outbound host(s); add them to the README's "
        f"'What leaves this machine' section: {surprises}"
    )


def test_the_readme_names_every_one_of_them():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    section = readme.split("## What leaves this machine")[1].split("##")[0]
    for host in ("Crossref", "OpenAlex", "Semantic Scholar", "arXiv", "doi.org"):
        assert host in section, f"{host} is reachable but unmentioned"
    assert "Anthropic" in section and "OpenAI" in section


def test_the_readme_names_the_hosts_a_library_reaches_for_us():
    """The scan above cannot see these, so this is the only thing that can.

    `preset_n0()` configures iroh's discovery and relays inside iroh, so no
    URL for them appears in any file of ours.  A version of this suite
    without this test passed perfectly while the README's list was wrong,
    which is the failure mode worth writing a test against.
    """
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    section = readme.split("## What leaves this machine")[1].split("##")[0]
    for host, why in THROUGH_A_LIBRARY.items():
        assert host in section, f"{host} is reachable ({why}) but unmentioned"


def test_sharing_is_what_turns_the_network_on():
    """Nothing above is contacted by a project nobody has shared.

    The promise is not only "these hosts" but "and not until you ask", so
    the transport must not be started for an unshared project.
    """
    import inspect

    from server.collab import peers

    source = inspect.getsource(peers.PeerNetwork.start)
    assert "if not self.share.shared:" in source
    assert "return" in source


def test_no_telemetry_of_any_kind():
    import re

    watched = re.compile(r"telemetry|analytics|sentry|posthog|mixpanel|gtag", re.I)
    offenders = [
        str(path.relative_to(ROOT))
        for path in python_sources() + list((ROOT / "frontend" / "src").rglob("*.ts*"))
        if watched.search(path.read_text(encoding="utf-8"))
    ]
    assert not offenders, offenders


def test_every_link_the_readme_makes_resolves():
    """A README that points at a file nobody wrote is the first thing a
    stranger clicks."""
    import re

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    broken = [
        target for target in re.findall(r"\]\((docs/[^)]+)\)", readme)
        if not (ROOT / target).exists()
    ]
    assert not broken, broken


def test_the_docs_link_to_each_other_correctly():
    import re

    broken = []
    for path in (ROOT / "docs").glob("*.md"):
        text = path.read_text(encoding="utf-8")
        for target in re.findall(r"\]\((?!https?:)([^)#]+)\)", text):
            if not (path.parent / target).exists():
                broken.append(f"{path.name} -> {target}")
    assert not broken, broken


def test_the_readme_contains_no_em_dash():
    """`nexttex/writing.py` states the rule as an absolute, with no
    exceptions, for every agent.

    I read it narrowly for a while, as governing only prose written into
    somebody's LaTeX project, on the evidence that the repository's own
    markdown was full of em dashes. That was backwards: those were the thing
    to fix rather than a licence to add more, and the user said so. A double
    hyphen in a code comment is a different character and is fine; this is
    about the em dash itself.

    The README is held to it here. Everything under `docs/` still carries a
    backlog of them, `design.md` most of all, and clearing that is a pass of
    its own: each one wants a comma, a colon, a bracket or two sentences
    depending on the sentence, and swapping them mechanically would leave
    worse prose than it found.
    """
    text = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "—" not in text, (
        "em dash on line "
        + str(text[: text.index("—")].count("\n") + 1)
    )


def test_the_readme_does_not_claim_windows_is_tested():
    """An install has now been run on Windows and reached its last step,
    which found four real bugs.  What has still not happened is a server
    serving a project, so the README has to keep hedging: "it installs" and
    "it works" are different claims, and the second one is the kind that
    costs somebody an evening."""
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "unverified" in readme or "untested" in readme


def test_an_install_without_the_claude_sdk_still_runs(monkeypatch, tmp_path):
    """A writer who chose OpenAI, or no agent, should not be stopped by a
    package for the one they did not choose -- and if they did choose it
    and it is missing, the reason belongs in the chat panel rather than in
    a 500 from whatever route touched a session first."""
    import sys

    from nexttex.providers import agent_for

    # Both, and in this order: dropping the cached module is what makes the
    # import actually run, and `None` in sys.modules is what makes it fail.
    # Without the first, this passes alone and fails in a full run, because
    # by then something else has already imported it.
    monkeypatch.delitem(sys.modules, "nexttex.agent", raising=False)
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", None)
    monkeypatch.delenv("NEXTTEX_SCRIPTED_AGENT", raising=False)

    agent = agent_for("claude", tmp_path, tmp_path)
    assert type(agent).__name__ == "Unavailable"
    assert agent.busy is False


def test_an_unavailable_agent_says_why_rather_than_failing(tmp_path):
    import asyncio

    from nexttex.providers import Unavailable

    agent = Unavailable("the reason")
    seen = []

    async def drive():
        await agent.ask("anything")
        async for event in agent.events():
            seen.append(event)
            if event["type"] == "done":
                return

    asyncio.run(asyncio.wait_for(drive(), timeout=5))
    assert seen[0]["type"] == "error" and seen[0]["message"] == "the reason"
    assert seen[-1]["type"] == "done"


def test_choosing_openai_never_loads_the_claude_sdk(monkeypatch, tmp_path):
    import builtins

    from nexttex.providers import agent_for

    real = builtins.__import__

    def without_sdk(name, *args, **kwargs):
        if name.startswith("claude_agent_sdk"):
            raise AssertionError("the Claude SDK was imported for an OpenAI agent")
        return real(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", without_sdk)
    monkeypatch.delenv("NEXTTEX_SCRIPTED_AGENT", raising=False)
    agent = agent_for("openai", tmp_path, tmp_path, api_key="k")
    assert type(agent).__name__ == "OpenAIAgent"


def test_two_installs_never_default_to_the_same_port(monkeypatch):
    """A second NextTex that defaults to 8450 does not start; it says the
    port is taken, which is a message about the wrong thing entirely."""
    import importlib
    from nexttex import config, project

    ports = set()
    for name in ("", "dev", "test", "scratch"):
        monkeypatch.setenv("NEXTTEX_INSTANCE", name)
        importlib.reload(project)
        importlib.reload(config)
        ports.add(config.default_port())
    assert len(ports) == 4
    monkeypatch.delenv("NEXTTEX_INSTANCE", raising=False)
    importlib.reload(project)
    importlib.reload(config)
    assert config.default_port() == 8450


def test_an_instance_name_cannot_escape_its_directory(monkeypatch):
    import importlib
    from nexttex import project

    for hostile in ("../..", "a/b", "..", "x" * 40, "  ", "a b"):
        monkeypatch.setenv("NEXTTEX_INSTANCE", hostile)
        importlib.reload(project)
        assert project.state_home().name == "nexttex", hostile
    monkeypatch.delenv("NEXTTEX_INSTANCE", raising=False)
    importlib.reload(project)

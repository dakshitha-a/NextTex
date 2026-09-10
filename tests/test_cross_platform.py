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
    "yihui.org",                # TinyTeX on Unix
    "tinytex.yihui.org",        # TinyTeX on Windows, where the .bat is broken
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


# A `[ValidateSet(...)]` parameter and the default underneath it, as they are
# written in the PowerShell installer's `param` block.
VALIDATE_SET = re.compile(
    r"\[ValidateSet\(([^)]*)\)\]\s*\[string\]\$(\w+)\s*=\s*'([^']*)'"
)


def test_every_windows_default_is_allowed_by_its_own_validate_set():
    """The documented Windows install is `irm ... | iex`, and `iex` has no
    script file to bind parameters against: the `param` block runs in the
    caller's scope, where each entry becomes a variable with an attribute
    attached rather than a parameter with a default.  A default outside its
    own set is then a value the attribute cannot be applied to, and the
    install stops on the first one with "the attribute cannot be added
    because variable Tex with value would no longer be valid" before it has
    done anything at all.

    `-Bind` used to default to `localhost`, which is in its set, so this
    held by accident until three parameters were given an empty default at
    once.  It is checked here rather than in the `pwsh` tests because those
    skip on the machine this is written on, and this is a Windows-only
    failure that nobody here would otherwise see.
    """
    text = (ROOT / "scripts" / "install.ps1").read_text(encoding="utf-8")
    found = VALIDATE_SET.findall(text)
    assert found, "no validated parameters found; has the param block moved?"
    for allowed, name, default in found:
        members = re.findall(r"'([^']*)'", allowed)
        assert default in members, (
            f"-{name} defaults to '{default}', which its ValidateSet "
            f"({', '.join(members)}) forbids, so `irm | iex` cannot run"
        )


# Cmdlets that a Windows machine can be too old to have, and the PowerShell
# version each one arrived in.  `Invoke-WebRequest` is 3.0 and is used, which
# is the floor these scripts already stand on.
TOO_NEW_FOR_SOME_WINDOWS = {
    "Get-FileHash": "4.0",
    "Expand-Archive": "5.0",
    "Compress-Archive": "5.0",
    "Get-ItemPropertyValue": "5.0",
    "New-TemporaryFile": "5.0",
}


def _powershell_code(text: str) -> str:
    """A script with its comments taken out.

    Crude on purpose: a `#` inside a string literal would take the rest of
    the line with it, and none of these scripts has one.  It exists so that
    a cmdlet named in a comment, explaining why it is not called, does not
    read as a call.
    """
    text = re.sub(r"<#.*?#>", "", text, flags=re.S)
    return "\n".join(line.split("#")[0] for line in text.splitlines())


def test_no_windows_script_needs_a_powershell_newer_than_three():
    """A user's install downloaded both halves of the interface and then
    stopped on "the term 'Get-FileHash' is not recognized", which is what a
    `powershell` older than 4.0 says.  Everything else in that script is
    3.0, so one cmdlet cost the whole interface, and the install had no way
    to say what was wrong.  The .NET class underneath works everywhere, and
    this keeps the dependency from creeping back in.
    """
    for script in sorted((ROOT / "scripts").glob("*.ps1")):
        code = _powershell_code(script.read_text(encoding="utf-8"))
        for cmdlet, version in TOO_NEW_FOR_SOME_WINDOWS.items():
            assert cmdlet not in code, (
                f"{script.name} calls {cmdlet}, which needs PowerShell "
                f"{version}, and Windows machines older than that exist"
            )


def test_windows_powershell_does_not_inherit_powershell_sevens_modules():
    """The bug that cost a user three installs.

    Windows PowerShell and PowerShell 7 use the same variable name for
    different directories. An install line typed into pwsh 7 hands
    PowerShell 7's `PSModulePath` to this installer, which hands it to the
    `powershell.exe` it starts; 5.1 then imports PowerShell 7's
    `Microsoft.PowerShell.Utility` instead of its own, and `Get-FileHash`
    is not in it. The install stops on "the term is not recognized" on a
    machine that has the cmdlet.

    The upper-case key is the whole point of the test: `os.environ`
    upper-cases its keys on Windows, so a `pop("PSModulePath")` written the
    way PowerShell spells it removes nothing and looks like it worked.
    """
    from nexttex.install.ui import child_env

    polluted = {
        "PSMODULEPATH": r"C:\Program Files\PowerShell\7\Modules",
        "PATH": r"C:\Windows",
    }
    cleaned = child_env(["powershell", "-File", "x.ps1"], polluted)
    assert not any(key.upper() == "PSMODULEPATH" for key in cleaned), cleaned
    assert cleaned["PATH"] == r"C:\Windows"

    mixed = child_env(["C:\\Windows\\powershell.exe"], {"PSModulePath": "x", "PATH": "y"})
    assert not any(key.upper() == "PSMODULEPATH" for key in mixed), mixed


def test_powershell_seven_keeps_the_module_path_it_was_given():
    """Only Windows PowerShell is corrected. pwsh wants what it inherits,
    and a child that is not PowerShell at all is not this function's
    business."""
    from nexttex.install.ui import child_env

    env = {"PSMODULEPATH": "keep me"}
    assert child_env(["pwsh", "-File", "x.ps1"], env) == env
    assert child_env(["git", "status"], env) == env
    assert child_env(["git", "status"], None) is None


def test_the_powershell_correction_reaches_the_process_that_is_started(monkeypatch):
    """The helper being right is worth nothing if `run` does not use it,
    and `run` is the one place the installer starts anything."""
    import io

    from nexttex.install import ui as installer_ui

    seen = {}

    class FakePopen:
        def __init__(self, argv, **kwargs):
            seen["argv"] = argv
            seen["env"] = kwargs.get("env")
            self.stdout = io.StringIO("")
            self.stdin = None
            self.returncode = 0

        def poll(self):
            return 0

        def terminate(self):
            pass

    monkeypatch.setattr(installer_ui.subprocess, "Popen", FakePopen)
    monkeypatch.setitem(os.environ, "PSMODULEPATH", r"C:\Program Files\PowerShell\7\Modules")

    console = installer_ui.Console(stream=io.StringIO(), plain=True)
    console.run("probe", ["powershell", "-NoProfile", "-File", "x.ps1"])
    assert seen["env"] is not None, "the child inherited the polluted environment"
    assert not any(key.upper() == "PSMODULEPATH" for key in seen["env"])

    console.run("probe", ["git", "status"])
    assert seen["env"] is None, "a child that is not PowerShell should inherit"


def test_the_installer_asks_nobody_when_input_is_redirected():
    """`[Environment]::UserInteractive` tracks the window station, not the
    keyboard: it is true inside a child started with its input on the null
    device, which is exactly where `Read-Host` waits for an answer that
    cannot come. Measured on a real machine, not reasoned about."""
    text = (ROOT / "scripts" / "install.ps1").read_text(encoding="utf-8")
    body = text.split("function Test-Interactive")[1].split("\nfunction ")[0]
    assert "IsInputRedirected" in body, body


# Where a child that might be Windows PowerShell is started, as a call site
# rather than a file. A file-level check gets this backwards: naming the
# three files and then exempting them from the sweep makes the three most
# likely to grow a fourth spawn the three least protected, and a substring
# check passes on an import line while the new call inherits the polluted
# environment.
POWERSHELL_SPAWNS = (
    ("nexttex/install/ui.py", "run"),
    ("nexttex/claude_auth.py", "_run_install"),
    ("server/main.py", "pump"),
)

# Names that start a process. Deliberately wider than what is used today,
# because the rule is about what anyone might reach for next.
_SPAWN_ATTRS = {
    "subprocess": {"Popen", "run", "call", "check_call", "check_output"},
    "asyncio": {"create_subprocess_exec", "create_subprocess_shell"},
    "os": {"system", "spawnv", "spawnve", "popen"},
}
_SPAWN_NAMES = {
    "Popen", "check_call", "check_output",
    "create_subprocess_exec", "create_subprocess_shell",
}


def _is_spawn(node) -> bool:
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
        return func.attr in _SPAWN_ATTRS.get(func.value.id, ())
    return isinstance(func, ast.Name) and func.id in _SPAWN_NAMES


def _corrects_the_module_path(call) -> bool:
    """Whether this call passes `env=child_env(...)`, not merely `env=`."""
    for keyword in call.keywords:
        if keyword.arg != "env":
            continue
        value = keyword.value
        if isinstance(value, ast.Call):
            func = value.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
            if name == "child_env":
                return True
    return False


def _functions(tree, text):
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield node, ast.get_source_segment(text, node) or ""


def test_every_named_powershell_spawn_corrects_the_module_path():
    """The three known sites, asserted on the call and not on the file.

    Windows PowerShell inherits PowerShell 7's `PSModulePath` through any
    process that is not itself PowerShell, and then loads PowerShell 7's
    `Microsoft.PowerShell.Utility` instead of its own. There is no single
    choke point to fix it at: the installer starts children, the settings
    sheet starts the Claude CLI installer, and the server starts the
    updater.
    """
    for name, function in POWERSHELL_SPAWNS:
        text = (ROOT / name).read_text(encoding="utf-8")
        tree = ast.parse(text)
        found = [
            call
            for node, _ in _functions(tree, text)
            if node.name == function
            for call in ast.walk(node)
            if _is_spawn(call)
        ]
        assert found, f"no process is started in {name}::{function} any more"
        for call in found:
            assert _corrects_the_module_path(call), (
                f"{name}::{function} line {call.lineno} starts a process "
                "without env=child_env(...)"
            )


def test_no_unguarded_spawn_sits_next_to_the_word_powershell():
    """The sweep that has to hold for files nobody has listed, including
    the listed ones: a fourth spawn added inside `run`, `_run_install` or
    `main.py` must fail here rather than reach a user's machine."""
    for path in python_sources():
        text = path.read_text(encoding="utf-8")
        if "powershell" not in text.lower():
            continue
        tree = ast.parse(text)
        relative = path.relative_to(ROOT)
        for node, source in _functions(tree, text):
            if "powershell" not in source.lower():
                continue
            for call in ast.walk(node):
                if _is_spawn(call) and not _corrects_the_module_path(call):
                    raise AssertionError(
                        f"{relative}::{node.name} line {call.lineno} starts a "
                        "process in a function that names PowerShell, without "
                        "env=child_env(...)"
                    )

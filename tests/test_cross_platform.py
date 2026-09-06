"""What has to hold on a machine that is not this one.

NextTex is developed on Linux and released for three platforms, so the
things that would break elsewhere are the things nobody here will notice.
These are the ones that can be checked without the other machine.
"""

import ast
import re
from pathlib import Path

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

    joined = " ".join(str(hint) for hint in TEX_HINTS)
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


def test_the_unix_installer_looks_for_tex_where_macos_puts_it():
    text = (ROOT / "scripts" / "install.sh").read_text(encoding="utf-8")
    assert "universal-darwin" in text
    assert "/Library/TeX/texbin" in text


def test_the_unix_installer_can_start_on_login_on_both_platforms():
    text = (ROOT / "scripts" / "install.sh").read_text(encoding="utf-8")
    assert "LaunchAgents" in text, "no launchd unit for macOS"
    assert "systemd/user" in text, "no systemd unit for Linux"


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


def test_the_readme_does_not_claim_windows_is_tested():
    """It is written carefully and has never been run on Windows.  Saying
    otherwise is the kind of claim that costs somebody an evening."""
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

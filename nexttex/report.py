"""The text a bug report carries: what this install is, and what it saw.

A report is the commit pair, the settings without their secrets, every tool
the installer would look for and where it found it, the service state, the
interface's last errors when the browser asked, and the last lines of every
log the install keeps.  It is composed here as one string and redacted once,
at the end, over the whole of it: there is no section that skips the pass,
and the pass is what the tests exercise.

Two constraints shape the module.  It imports only the standard library at
module level, because a broken virtual environment is one of the likelier
things to report and `server/run.py` cannot even be asked for `--version`
then; `python -m nexttex.report` still runs on whatever Python the machine
has.  And nothing in it opens a socket: the survey is asked not to probe the
network, no update check is made, and the only thing that leaves the machine
is the report the writer reads and pastes for themselves.

What it never reads: `peer.key`, `key.pem`, `cert.pem`, a project's
`transcript.jsonl`, `history/`, `context/`, or any file of the manuscript.
`projects.json` is opened for a count and its paths are not repeated.
"""

from __future__ import annotations

import datetime
import getpass
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import urllib.parse
from pathlib import Path

from .paths import instance_name, state_home
from .version import VERSION

#: The config keys whose values are secrets, replaced wherever they appear.
SECRET_KEYS = ("token", "openai_key", "password_hash", "password_salt")

#: Lines quoted from the end of each log.
LOG_TAIL = 80

#: How far back a tail reads before splitting lines.  A log appended across
#: every run this install has made can be many megabytes; eighty lines are
#: in the last few kilobytes of it.
TAIL_BYTES = 64 * 1024

#: The header `nexttex/install/__main__.py` and `scripts/update.sh` write at
#: the start of each run, which is how the last block is found.
BLOCK_MARK = "=== "

#: Entries the interface may hand over, and how much of each is kept.
MAX_CLIENT_ERRORS = 20
MAX_MESSAGE = 2000
MAX_STACK_LINES = 5

#: The whole report, after which it is cut with a line saying so.
MAX_REPORT_BYTES = 96_000

#: A prefilled issue URL longer than this is not worth the 414 it risks.
MAX_URL = 6000

REDACTED = "[redacted]"

#: What the account's name becomes: not a secret, so not the same word, and
#: still readable as the place where a name was.
ACCOUNT = "[account]"


# ---------------------------------------------------------------------------
# Reading files without reading too much


def tail(path: Path, lines: int = LOG_TAIL) -> str:
    """The last `lines` of a file, or a word about why there are none."""
    try:
        size = path.stat().st_size
        with path.open("rb") as handle:
            if size > TAIL_BYTES:
                handle.seek(size - TAIL_BYTES)
            raw = handle.read()
    except FileNotFoundError:
        return "(absent)"
    except OSError as error:
        return f"(unreadable: {error.strerror or error})"
    text = raw.decode("utf-8", errors="replace")
    kept = text.splitlines()[-lines:]
    if not kept:
        return "(empty)"
    return "\n".join(kept)


def last_block(path: Path, mark: str = BLOCK_MARK, lines: int = LOG_TAIL) -> str:
    """The final run recorded in an appended log, then its last `lines`."""
    whole = tail(path, lines=10_000)
    if whole.startswith("("):
        return whole
    rows = whole.splitlines()
    start = 0
    for index, row in enumerate(rows):
        if row.startswith(mark):
            start = index
    return "\n".join(rows[start:][-lines:])


def journal(unit: str, lines: int = LOG_TAIL) -> str:
    """The user journal for a systemd unit, where that is where the log went."""
    binary = shutil.which("journalctl")
    if not binary:
        return "(no journalctl)"
    try:
        result = subprocess.run(
            [binary, "--user", "-u", unit, "-n", str(lines), "--no-pager",
             "-o", "short-iso"],
            capture_output=True, text=True, errors="replace", timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as error:
        return f"(journalctl failed: {error})"
    if result.returncode != 0:
        return f"(journalctl failed: {result.stderr.strip() or result.returncode})"
    return result.stdout.strip() or "(empty)"


def read_config(state: Path) -> dict:
    """The config file as it is on disk, and nothing if it is not there.

    Raw rather than `Settings.load()`, which writes a file where it finds
    none; a report must not be the first thing to create the state it is
    describing.
    """
    try:
        loaded = json.loads((state / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


# ---------------------------------------------------------------------------
# The sections


def _git(root: Path, *arguments: str) -> str:
    binary = shutil.which("git")
    if not binary:
        return ""
    try:
        result = subprocess.run(
            [binary, *arguments], cwd=str(root), capture_output=True, text=True,
            errors="replace", timeout=10,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C"},
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def facts_of(root: Path, environ=None) -> dict:
    """The few facts the prefilled issue and the report both need."""
    environ = environ if environ is not None else os.environ
    root = Path(root)
    head = _git(root, "log", "-1", "--format=%h %cs %s") or "unknown (not a git checkout)"
    try:
        built = (root / "frontend" / "dist" / "BUILD_SHA").read_text(encoding="utf-8").strip()[:7]
    except OSError:
        built = "unknown"
    dirty = _git(root, "status", "--porcelain")
    return {
        "version": VERSION,
        "head": head,
        "short": head.split(" ")[0],
        "built": built,
        "dirty": len(dirty.splitlines()) if dirty else 0,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "python": sys.version.split()[0],
        "instance": instance_name(environ),
        "state": state_home(environ),
        "root": root,
    }


def install_section(facts: dict) -> list:
    return [
        f"version    {facts['version']}",
        f"code       {facts['head']}",
        f"interface  {facts['built']}",
        f"changed    {facts['dirty']} file(s) not committed" if facts["dirty"] else "changed    nothing",
        f"root       {facts['root']}",
        f"state      {facts['state']}",
        f"instance   {facts['instance'] or '(default)'}",
        f"python     {facts['python']}  {sys.executable}",
        f"platform   {facts['platform']}  {facts['machine']}  os.name={os.name}",
    ]


def settings_section(config: dict) -> list:
    """The settings that shape behaviour, and a yes or no for each secret."""
    if not config:
        return ["(no config.json)"]
    sessions = config.get("sessions")
    return [
        f"port        {config.get('port', '')}",
        f"localhost   {config.get('localhost', '')}",
        f"tailscale   {config.get('tailscale', '')}",
        f"lan_host    {'set' if config.get('lan_host') else 'unset'}",
        f"certificate {'yes' if config.get('certfile') else 'no'}",
        f"provider    {config.get('provider', '')}",
        f"model       {config.get('model') or '(default)'}",
        f"latexmk_rc  {config.get('latexmk_rc', '')}",
        f"password    {'set' if config.get('password_hash') else 'not set'}",
        f"browsers    {len(sessions) if isinstance(sessions, list) else 0} signed in",
    ]


def tools_section(root: Path, environ) -> list:
    """Every tool the installer looks for, from the installer's own survey."""
    from .install.survey import survey, this_platform

    try:
        result = survey(this_platform(), root, check_network=False, environ=environ)
    except Exception as error:  # a report about a broken install still prints
        return [f"(survey failed: {type(error).__name__}: {error})"]
    rows = []
    for finding in result.findings:
        rows.append(f"{finding.name:<18}{finding.kind:<12}{finding.version:<14}{finding.where}".rstrip())
    rows += [
        f"tex_dir     {result.tex_dir or '(none)'}",
        f"tex extras  {', '.join(result.missing_tex_extras) or 'all present'}" if result.tex_dir else "",
        f"service     {result.service or '(none)'}",
        f"interface   {'present' if result.interface_present else 'absent'}",
        f"node        {result.node_major or '(none)'}",
    ]
    return [row for row in rows if row]


def service_section(instance: str, from_server: bool) -> list:
    """Whether something supervises the server, asked of the right process.

    `supervised()` reads the environment of the process it runs in.  From
    the projects screen that is the server, and the answer is a fact about
    it; from a terminal it is the terminal, and a supervised install would
    print `supervised False` two lines above `systemd unit: active`.  So
    those lines are only quoted when the server composed the report, and
    the unit probe below answers for both.
    """
    from . import updates

    if from_server:
        rows = [
            f"supervised     {updates.supervised()}",
            f"INVOCATION_ID  {'set' if os.environ.get('INVOCATION_ID') else 'unset'}",
            f"XPC_SERVICE    {'set' if os.environ.get('XPC_SERVICE_NAME') else 'unset'}",
        ]
    else:
        rows = ["(composed at a terminal, so only the unit can be asked)"]
    # What systemd says about the unit, where there is a systemd to ask.
    # The survey knows whether a unit file exists and not whether it is
    # running, which is the half a report needs.
    binary = shutil.which("systemctl") if sys.platform.startswith("linux") else None
    if binary:
        unit = "nexttex" + ("-" + instance if instance else "")
        try:
            result = subprocess.run(
                [binary, "--user", "is-active", unit], capture_output=True,
                text=True, errors="replace", timeout=10,
            )
            rows.append(f"systemd unit   {unit}: {result.stdout.strip() or result.stderr.strip() or 'unknown'}")
        except (OSError, subprocess.SubprocessError) as error:
            rows.append(f"systemd unit   {unit}: (systemctl failed: {error})")
    return rows


def agent_section(config: dict) -> list:
    provider = config.get("provider", "claude") if config else "claude"
    if provider != "claude":
        return [f"provider   {provider}"]
    try:
        from . import claude_auth

        status = claude_auth.status()
    except Exception as error:
        return [f"(status failed: {type(error).__name__}: {error})"]
    return [
        f"installed  {status.get('installed', False)}",
        f"signed in  {status.get('loggedIn', False)}",
        f"plan       {status.get('plan', '')}",
        f"reason     {status.get('reason', '')}",
    ]


def projects_section(state: Path, open_projects) -> list:
    try:
        registry = json.loads((state / "projects.json").read_text(encoding="utf-8"))
        registered = len(registry) if isinstance(registry, list) else 0
    except (OSError, ValueError):
        registered = 0
    rows = [f"registered  {registered}"]
    if open_projects is not None:
        rows.append(f"open        {open_projects}")
    return rows


def client_section(client: dict) -> list:
    """What the browser saw: its own errors, and which browser it is."""
    rows = [f"browser  {str(client.get('browser', ''))[:300]}"]
    errors = client.get("errors") or []
    if not isinstance(errors, list):
        errors = []
    for entry in errors[:MAX_CLIENT_ERRORS]:
        if not isinstance(entry, dict):
            continue
        rows.append("")
        rows.append(f"{str(entry.get('at', ''))[:40]}  {str(entry.get('kind', ''))[:32]}")
        rows.append(f"  {str(entry.get('message', ''))[:MAX_MESSAGE]}")
        for line in str(entry.get("stack", "")).splitlines()[:MAX_STACK_LINES]:
            rows.append(f"    {line[:300]}")
    if len(rows) == 1:
        rows.append("no errors recorded")
    return rows


def logs_section(state: Path, instance: str) -> list:
    rows = []

    def add(title: str, body: str) -> None:
        rows.append(f"### {title}")
        rows.append(body)
        rows.append("")

    if sys.platform.startswith("linux"):
        add(f"journalctl --user -u nexttex{'-' + instance if instance else ''}",
            journal("nexttex" + ("-" + instance if instance else "")))
    for name in ("server.err.log", "server.log", "restart.log"):
        add(str(state / name), tail(state / name))
    for name in ("update.log", "install.log"):
        add(str(state / name) + " (last run)", last_block(state / name))
    return rows


# ---------------------------------------------------------------------------
# The one pass that removes what must not leave


def redact(text: str, secrets, home: str = "", account: str = "") -> str:
    """Every secret value, every token in a URL, every key-shaped line, then
    the home directory, then the account's name.

    Secrets first and longest first, so a shorter one that is a prefix of a
    longer one cannot leave the longer one's tail behind.  The home path goes
    after them: a token never contains it, and replacing it earlier would
    move the text under the patterns that follow.  The account name goes
    last of all, because the home path usually ends in it and folding the
    path first is what leaves nothing of it behind: a Windows event names
    the account as `DOMAIN\\name` and journalctl as name at host, neither
    of which the home fold reaches.  Bounded by non-word characters so a
    short name does not eat the middle of other words, and not applied to
    a name under three characters, which would fold too much else to be
    worth what it hides.
    """
    for secret in sorted({s for s in secrets if isinstance(s, str) and s}, key=len, reverse=True):
        text = text.replace(secret, REDACTED)
    text = re.sub(r"([?&]token=)[^\s&\"'<>]+", r"\1" + REDACTED, text)
    text = re.sub(
        r"(\"?(?:token|openai_key|password_hash|password_salt)\"?\s*[:=]\s*\"?)(?!\[redacted\])[^\s\",}]+",
        r"\1" + REDACTED, text,
    )
    text = re.sub(r"sk-[A-Za-z0-9_-]{16,}", "sk-" + REDACTED, text)
    if home:
        for spelling in {home, home.replace("\\", "/"), home.replace("/", "\\")}:
            if spelling and spelling not in ("/", "\\"):
                text = text.replace(spelling, "~")
    if account and len(account) >= 3:
        text = re.sub(
            r"(?<![A-Za-z0-9_])" + re.escape(account) + r"(?![A-Za-z0-9_])",
            ACCOUNT, text,
        )
    return text


def account_name() -> str:
    """The name this process runs as, or "" where nothing can say."""
    try:
        return getpass.getuser()
    except Exception:
        return os.environ.get("USERNAME") or os.environ.get("USER") or ""


def _secrets_in(config: dict) -> list:
    found = [config.get(key) for key in SECRET_KEYS]
    for session in config.get("sessions") or []:
        if isinstance(session, dict):
            found.append(session.get("hash"))
    return [value for value in found if isinstance(value, str) and value]


# ---------------------------------------------------------------------------
# The report


def compose(*, root: Path, environ=None, client=None, source: str,
            open_projects=None) -> str:
    """The whole report, redacted, as the text a person pastes."""
    environ = environ if environ is not None else os.environ
    root = Path(root)
    facts = facts_of(root, environ)
    state = facts["state"]
    config = read_config(state)

    sections = [
        ("Install", install_section(facts)),
        ("Settings", settings_section(config)),
        ("Tools", tools_section(root, environ)),
        ("Service", service_section(facts["instance"], from_server=client is not None)),
        ("Agent", agent_section(config)),
        ("Projects", projects_section(state, open_projects)),
    ]
    if client is not None:
        sections.append(("Interface", client_section(client)))
    sections.append(("Logs", logs_section(state, facts["instance"])))

    lines = [
        "NextTex report",
        f"generated {datetime.datetime.now().isoformat(timespec='seconds')} by {source}",
        "",
    ]
    for title, rows in sections:
        lines.append(f"## {title}")
        lines.extend(rows)
        lines.append("")
    text = "\n".join(lines).rstrip() + "\n"

    text = redact(text, _secrets_in(config), str(Path.home()), account_name())
    if len(text.encode("utf-8")) > MAX_REPORT_BYTES:
        text = text.encode("utf-8")[:MAX_REPORT_BYTES].decode("utf-8", errors="ignore")
        text = text.rstrip() + "\n(cut here: the report was longer than it is worth pasting)\n"
    return text


def prefill(facts: dict, slug: str, browser: str = "", service: str = "") -> str:
    """The new-issue URL with the short facts filled in.

    Only the fields a person would otherwise have to look up.  The report
    itself never goes in the URL: a query string is capped by the server at
    the other end, and the clipboard is not.  No `labels=` either, because a
    visitor without triage rights is shown a 404 for it rather than the form.
    """
    where = ", ".join(part for part in (
        facts.get("platform", ""),
        service or "no service",
        f"Python {facts.get('python', '')}",
        browser[:120],
    ) if part)
    commit = f"code {facts.get('short', '')}, interface {facts.get('built', '')}"
    base = f"https://github.com/{slug}/issues/new"
    fields = {"template": "bug.yml", "where": where, "commit": commit}
    url = base + "?" + urllib.parse.urlencode(fields, quote_via=urllib.parse.quote)
    if len(url) > MAX_URL:
        fields.pop("where")
        url = base + "?" + urllib.parse.urlencode(fields, quote_via=urllib.parse.quote)
    return url


def main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Print a report for a NextTex bug report and exit.")
    parser.add_argument("--instance", default="",
                        help="which named instance to describe")
    arguments = parser.parse_args(argv)
    environ = dict(os.environ)
    if arguments.instance:
        environ["NEXTTEX_INSTANCE"] = arguments.instance
    root = Path(__file__).resolve().parent.parent
    sys.stdout.write(compose(root=root, environ=environ, source="python -m nexttex.report"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

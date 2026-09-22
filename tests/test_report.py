"""The bug report text: what it holds, and what it can never hold.

The report is the one thing a person is asked to paste into a public issue,
so the interesting property is negative.  Whatever the logs and the config
contain, the token, the API key, the password hash and the session
fingerprints do not come out the other side, and neither does the home
directory.  Hypothesis writes the logs here; the tests only read the result.
"""

from __future__ import annotations

import json
import os
import socket
import string
import subprocess
import sys
from pathlib import Path

import pytest
import re
from hypothesis import assume, given, settings, strategies as st

from nexttex import report

ROOT = Path(__file__).resolve().parents[1]

URLSAFE = string.ascii_letters + string.digits + "-_"


@pytest.fixture
def state(tmp_path, monkeypatch):
    """An empty state directory, and a home the report should spell as ~."""
    home = tmp_path / "home"
    (home / ".local" / "share" / "nexttex").mkdir(parents=True)
    monkeypatch.setenv("XDG_DATA_HOME", str(home / ".local" / "share"))
    monkeypatch.delenv("NEXTTEX_INSTANCE", raising=False)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    return home / ".local" / "share" / "nexttex"


def compose(**kw) -> str:
    kw.setdefault("root", ROOT)
    kw.setdefault("source", "the tests")
    return report.compose(**kw)


# -- the redaction pass ----------------------------------------------------


@settings(max_examples=200, deadline=None)
@given(
    secrets=st.lists(st.text(alphabet=URLSAFE, min_size=8, max_size=40),
                     min_size=1, max_size=4),
    filler=st.text(max_size=200),
)
def test_redaction_never_lets_a_secret_through(secrets, filler):
    text = filler
    for secret in secrets:
        text += f" {secret} \n?token={secret}&x=1 \"token\": \"{secret}\"\n" + filler
    out = report.redact(text, secrets, "/home/somebody")
    for secret in secrets:
        assert secret not in out
    assert report.REDACTED in out


@settings(max_examples=200, deadline=None)
@given(text=st.text(alphabet=string.ascii_letters + " \n.,", max_size=300)
       .filter(lambda t: "token" not in t and "sk" not in t))
def test_redaction_leaves_innocent_text_alone(text):
    assert report.redact(text, [], "/home/somebody") == text


def test_redaction_is_idempotent():
    text = "a ?token=abc123 sk-abcdefghijklmnopqrstuvwxyz /home/me/x token: zzz"
    once = report.redact(text, ["zzz"], "/home/me")
    assert report.redact(once, ["zzz"], "/home/me") == once
    assert "abc123" not in once and "zzz" not in once
    assert "sk-[redacted]" in once
    assert "~/x" in once


def test_a_shorter_secret_inside_a_longer_one_leaves_no_tail():
    out = report.redact("x LONGsecretTAIL y", ["LONGsecretTAIL", "LONGsecret"], "")
    assert "TAIL" not in out


def test_the_home_directory_is_spelled_as_a_tilde():
    out = report.redact(r"C:\Users\me\x and C:/Users/me/y", [], r"C:\Users\me")
    assert out == "~\\x and ~/y"


@settings(max_examples=200, deadline=None)
@given(
    name=st.text(alphabet=string.ascii_letters + string.digits, min_size=3, max_size=16),
    filler=st.text(alphabet=string.ascii_letters + " \n.,", max_size=120),
)
def test_the_account_name_never_leaves_as_itself(name, filler):
    """A Windows event names the account as DOMAIN\\name and journalctl as
    name@host, and neither is inside the home path the tilde fold reaches.

    An account actually called AppData is excluded, and the exclusion is
    the interesting part: the last line below folds to `~\\AppData\\x`,
    and this test then asks for two things that cannot both be true, that
    the name appears nowhere as a word and that `~\\AppData` is still
    there. Hypothesis found it after this file had been green for weeks,
    which is what an unconstrained alphabet does eventually. It is a
    collision between the name and the literal this fixture uses, not
    something `redact` gets wrong.
    """
    assume(name != "AppData")
    text = (f"{filler} UserContext: DESKTOP\\{name} {filler}\n"
            f"session opened for user {name}@laptop\n"
            f"C:\\Users\\{name}\\AppData\\x {filler}")
    out = report.redact(text, [], f"C:\\Users\\{name}", name)
    assert re.search(r"(?<![A-Za-z0-9_])" + re.escape(name) + r"(?![A-Za-z0-9_])", out) is None
    assert report.ACCOUNT in out
    assert "~\\AppData" in out


def test_the_account_name_is_a_word_and_a_short_one_is_left_alone():
    out = report.redact("dan, danger, dan@host, DOMAIN\\dan", [], "", "dan")
    assert out == "[account], danger, [account]@host, DOMAIN\\[account]"
    assert report.redact("me and some", [], "", "me") == "me and some"


# -- what the report reads, and what it does not ---------------------------


def test_compose_reads_nothing_it_must_not(state):
    (state / "peer.key").write_bytes(b"PEERKEYBYTES")
    (state / "key.pem").write_text("PRIVATEKEYPEM\n")
    (state / "cert.pem").write_text("CERTPEM\n")
    (state / "projects.json").write_text(json.dumps([
        {"path": "/somewhere/thesis-SECRETNAME"}, {"path": "/elsewhere/paper"},
    ]))
    project = state.parent / "thesis"
    (project / ".nexttex").mkdir(parents=True)
    (project / ".nexttex" / "transcript.jsonl").write_text("TRANSCRIPTLINE\n")

    text = compose()

    for planted in ("PEERKEYBYTES", "PRIVATEKEYPEM", "CERTPEM", "SECRETNAME",
                    "TRANSCRIPTLINE", "/elsewhere/paper"):
        assert planted not in text
    assert "registered  2" in text


def test_every_secret_in_the_config_is_gone(state):
    (state / "config.json").write_text(json.dumps({
        "port": 8450, "token": "TOKENVALUE0123", "openai_key": "sk-OPENAIKEYVALUE0123456",
        "password_hash": "HASHVALUE0123", "password_salt": "SALTVALUE0123",
        "sessions": [{"hash": "SESSIONFINGERPRINT0123", "name": "laptop"}],
        "lan_host": "192.168.1.9", "display_name": "Real Name",
    }))
    (state / "server.log").write_text(
        "http://127.0.0.1:8450/?token=TOKENVALUE0123\nSESSIONFINGERPRINT0123 seen\n")

    text = compose()

    for planted in ("TOKENVALUE0123", "OPENAIKEYVALUE", "HASHVALUE0123",
                    "SALTVALUE0123", "SESSIONFINGERPRINT0123", "192.168.1.9",
                    "Real Name"):
        assert planted not in text, planted
    assert "?token=[redacted]" in text
    assert "password    set" in text
    assert "browsers    1 signed in" in text
    assert "lan_host    set" in text


def test_compose_survives_an_empty_state_directory(state):
    text = compose()
    assert text.startswith("NextTex report\n")
    assert "(no config.json)" in text
    assert text.count("(absent)") >= 5
    assert "registered  0" in text


def test_compose_does_not_create_the_config(state):
    compose()
    assert not (state / "config.json").exists()


def test_the_last_block_of_a_log_is_the_one_quoted(state):
    (state / "update.log").write_text(
        "=== 2026-01-01T00:00:00 update.sh\nFIRSTRUN\n"
        "=== 2026-02-01T00:00:00 update.sh\nSECONDRUN\n"
        "=== 2026-03-01T00:00:00 update.sh\nTHIRDRUN\n")
    text = compose()
    assert "THIRDRUN" in text
    assert "FIRSTRUN" not in text and "SECONDRUN" not in text


def test_a_huge_log_costs_a_bounded_read(state, monkeypatch):
    path = state / "server.log"
    with path.open("w") as handle:
        for index in range(200_000):
            handle.write(f"line {index}\n")
    assert path.stat().st_size > 2_000_000

    read = []
    original = Path.open

    def counting(self, *args, **kwargs):
        handle = original(self, *args, **kwargs)
        if self == path:
            inner = handle.read

            def measured(*a, **k):
                data = inner(*a, **k)
                read.append(len(data))
                return data
            handle.read = measured
        return handle
    monkeypatch.setattr(Path, "open", counting)

    text = report.tail(path)
    assert text.splitlines()[-1] == "line 199999"
    assert len(text.splitlines()) == report.LOG_TAIL
    assert sum(read) <= report.TAIL_BYTES


def test_the_report_never_opens_a_socket(state, monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("the report reached for the network")
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket.socket, "connect", refuse)

    asked = {}
    from nexttex.install import survey as survey_module
    original = survey_module.survey

    def watching(*args, **kwargs):
        asked.update(kwargs)
        return original(*args, **kwargs)
    monkeypatch.setattr(survey_module, "survey", watching)

    text = compose()
    assert "## Tools" in text
    assert asked.get("check_network") is False


def test_client_errors_are_bounded_and_quoted(state):
    client = {
        "browser": "Browser/1.0",
        "errors": [{"at": "12:00:00", "kind": "error", "message": "m" * 5000,
                    "stack": "\n".join(f"frame {i}" for i in range(50))}] * 40,
    }
    text = compose(client=client)
    assert "browser  Browser/1.0" in text
    assert text.count("12:00:00  error") == report.MAX_CLIENT_ERRORS
    assert "m" * report.MAX_MESSAGE in text and "m" * (report.MAX_MESSAGE + 1) not in text
    assert "frame 4" in text and "frame 5" not in text


def test_a_report_longer_than_is_worth_pasting_is_cut(state):
    (state / "server.log").write_text(("x" * 3000 + "\n") * 80)
    (state / "server.err.log").write_text(("y" * 3000 + "\n") * 80)
    text = compose()
    assert len(text.encode("utf-8")) <= report.MAX_REPORT_BYTES + 100
    assert text.rstrip().endswith("(cut here: the report was longer than it is worth pasting)")


def test_the_service_lines_describe_the_server_and_not_the_terminal(state, monkeypatch):
    monkeypatch.setenv("INVOCATION_ID", "abc")
    at_terminal = compose()
    assert "composed at a terminal" in at_terminal
    assert "INVOCATION_ID" not in at_terminal.split("## Service")[1].split("## ")[0]
    from_server = compose(client={"browser": "", "errors": []})
    assert "INVOCATION_ID  set" in from_server
    assert "supervised     True" in from_server


# -- the prefilled issue -----------------------------------------------------


def test_the_prefill_url_is_short_and_carries_no_secret():
    facts = {"platform": "Linux-x", "python": "3.10.0", "short": "abc1234",
             "built": "abc1234"}
    url = report.prefill(facts, "someone/NextTex", browser="Firefox/1 token=NO",
                         service="systemd")
    assert url.startswith("https://github.com/someone/NextTex/issues/new?template=bug.yml")
    assert "where=Linux-x%2C%20systemd%2C%20Python%203.10.0%2C%20Firefox" in url
    assert "commit=code%20abc1234%2C%20interface%20abc1234" in url
    assert "labels=" not in url and "title=" not in url
    assert len(url) < report.MAX_URL


def test_a_prefill_that_would_be_too_long_drops_where_first():
    facts = {"platform": "P" * 7000, "python": "3", "short": "a", "built": "b"}
    url = report.prefill(facts, "someone/NextTex")
    assert "where=" not in url and "commit=" in url and len(url) < report.MAX_URL


# -- the two entry points -----------------------------------------------------


def test_run_py_prints_the_report_without_creating_a_config(tmp_path):
    env = {**os.environ, "XDG_DATA_HOME": str(tmp_path / "data"),
           "NEXTTEX_INSTANCE": ""}
    env.pop("NEXTTEX_FAKE_CLAUDE_AUTH", None)
    result = subprocess.run(
        [sys.executable, "server/run.py", "--report"], cwd=ROOT, env=env,
        capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("NextTex report\n")
    assert "by server/run.py --report" in result.stdout
    assert not (tmp_path / "data" / "nexttex" / "config.json").exists()


def test_the_report_module_imports_on_a_bare_interpreter():
    result = subprocess.run(
        [sys.executable, "-I", "-S", "-c",
         f"import sys; sys.path.insert(0, {str(ROOT)!r}); import nexttex.report"],
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr


def test_the_module_names_no_person():
    """`tests/test_cross_platform.py` scans for an email address; this is the
    other thing a report module could carry by accident."""
    assert "@" not in (ROOT / "nexttex" / "report.py").read_text(encoding="utf-8").replace("@app", "")


# -- the Windows events section --------------------------------------------


class _Ran:
    def __init__(self, stdout="", stderr="", returncode=0):
        self.stdout, self.stderr, self.returncode = stdout, stderr, returncode


def _on_windows(monkeypatch, run):
    monkeypatch.setattr(report.sys, "platform", "win32")
    monkeypatch.setattr(report.shutil, "which", lambda name: r"C:\Windows\powershell.exe")
    monkeypatch.setattr(report.subprocess, "run", run)


def test_the_windows_section_is_absent_anywhere_but_windows(monkeypatch):
    monkeypatch.setattr(report.sys, "platform", "linux")
    assert report.windows_events("nexttex") == []


def test_the_windows_section_tells_history_off_from_nothing_there(monkeypatch):
    """The Task Scheduler's history is off on a client Windows unless
    somebody turned it on, and a report that said "nothing there" for a
    machine that keeps nothing would send the reader looking for events
    that were never written."""
    seen = {}

    def run(argv, **kwargs):
        seen["argv"] = argv
        seen["kwargs"] = kwargs
        return _Ran("##history disabled\n##crashes\n")

    _on_windows(monkeypatch, run)
    rows = report.windows_events("nexttex-lab")
    assert any("not enabled" in row for row in rows)
    assert any("Enable All Tasks History" in row for row in rows)
    assert rows[-2] == "(none)"
    # The task's own name, non-interactive, and no profile.
    assert "-NoProfile" in seen["argv"] and "-NonInteractive" in seen["argv"]
    assert r"\nexttex-lab" in seen["argv"][-1]
    assert seen["kwargs"]["timeout"] == 30


def test_the_windows_section_quotes_the_events_when_history_is_on(monkeypatch):
    _on_windows(monkeypatch, lambda argv, **kw: _Ran(
        "##history enabled\n"
        "2026-09-17T23:01:02  102  Task Scheduler successfully finished \\nexttex\n"
        "##crashes\n"
        "2026-09-17T23:01:00  Application Error  Faulting application name: python.exe\n"
    ))
    rows = report.windows_events("nexttex")
    text = "\n".join(rows)
    assert "Task Scheduler successfully finished" in text
    assert "Faulting application name: python.exe" in text
    assert "(none)" not in text


def test_the_windows_section_says_so_when_history_is_on_and_empty(monkeypatch):
    _on_windows(monkeypatch, lambda argv, **kw: _Ran("##history enabled\n##crashes\n"))
    rows = report.windows_events("nexttex")
    assert any("holds nothing for the task" in row for row in rows)
    assert rows[-2] == "(none)"


def test_the_windows_section_reports_a_failure_as_a_row(monkeypatch):
    _on_windows(monkeypatch, lambda argv, **kw: _Ran("", "Access is denied", 1))
    assert report.windows_events("nexttex") == ["(powershell failed: Access is denied)"]

    def slow(argv, **kwargs):
        raise subprocess.TimeoutExpired(argv, kwargs["timeout"])

    _on_windows(monkeypatch, slow)
    assert "given up on" in report.windows_events("nexttex")[0]

    monkeypatch.setattr(report.shutil, "which", lambda name: None)
    assert "no PowerShell" in report.windows_events("nexttex")[0]


def test_the_journal_helper_reports_its_failures_as_words(monkeypatch):
    """`journal()` had no test of its own, and the Windows section is its
    twin: the same answers for no binary, a refusal and a timeout."""
    monkeypatch.setattr(report.shutil, "which", lambda name: None)
    assert report.journal("nexttex") == "(no journalctl)"
    monkeypatch.setattr(report.shutil, "which", lambda name: "/usr/bin/journalctl")
    monkeypatch.setattr(report.subprocess, "run", lambda argv, **kw: _Ran("", "No journal files", 1))
    assert report.journal("nexttex") == "(journalctl failed: No journal files)"
    monkeypatch.setattr(report.subprocess, "run", lambda argv, **kw: _Ran("Sep 17 server started\n"))
    assert report.journal("nexttex") == "Sep 17 server started"
    monkeypatch.setattr(report.subprocess, "run", lambda argv, **kw: _Ran(""))
    assert report.journal("nexttex") == "(empty)"

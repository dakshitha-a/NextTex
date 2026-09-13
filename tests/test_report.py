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
from hypothesis import given, settings, strategies as st

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

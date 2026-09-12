"""A check that never reached the network is not an answer about the code.

`check()` returns early when `git fetch` fails, before `behind` is ever
assigned, so it keeps its dataclass default of zero. The footer reads
`report.behind === 0` and draws "Up to date." Nothing between that line and
the checkout test looks at `error` or `reason`, and the card that would say
the repository could not be reached belongs to a different phase, the request
itself failing, which is not what happened.

The Windows laptop's server cannot resolve github.com while a shell on the
same machine can. So it sat five commits behind, was told it was current, and
could not start an update from the page either, because `can_update` was false
and the route refuses with "There is nothing to update". The documented
recovery was the one path closed.
"""

import pytest

from nexttex import gitrepo, updates


def test_a_failed_fetch_says_it_did_not_check(monkeypatch, tmp_path):
    root = tmp_path / "install"
    root.mkdir()
    (root / ".git").mkdir()

    monkeypatch.setattr(updates.gitrepo, "_run", lambda *a, **k: "deadbee")

    def refuse(*args, **kwargs):
        raise gitrepo.GitError(
            "fatal: unable to access 'https://github.com/x/y.git/': "
            "Could not resolve host: github.com"
        )

    monkeypatch.setattr(updates.gitrepo, "fetch", refuse)

    report = updates.check(root)

    assert report.checked is False, (
        "a check that never reached the network reported that it had"
    )
    assert report.error, "the failure was not carried to the screen"
    assert report.can_update is False


def test_a_fetch_that_worked_says_it_checked(monkeypatch, tmp_path):
    root = tmp_path / "install"
    root.mkdir()
    (root / ".git").mkdir()

    monkeypatch.setattr(updates.gitrepo, "_run", lambda *a, **k: "deadbee")
    monkeypatch.setattr(updates.gitrepo, "fetch", lambda *a, **k: None)
    monkeypatch.setattr(updates, "_commits_behind", lambda root: [])
    monkeypatch.setattr(
        updates.gitrepo, "status", lambda root: type("S", (), {"as_dict": lambda self: {"changes": []}})()
    )

    report = updates.check(root)

    assert report.checked is True
    assert report.behind == 0
    assert not report.error

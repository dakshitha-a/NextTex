"""At most three scripts run at once, and the fourth is told.

Q-007, the half done here: one run per script was the only limit, so a
model asked for twenty figures could start twenty interpreters. The other
half, a cgroup so a script that starts its own session cannot outlive its
stop, is in the backlog with its reason.
"""

import asyncio

from nexttex import scripts
from nexttex.scripts import ScriptRuns


def test_a_fourth_script_is_not_started_while_three_run(tmp_path, monkeypatch):
    started: list[str] = []
    release = asyncio.Event()

    async def slow(root, state_dir, path, capture=None, *, on_output=None):
        started.append(path.name)
        await release.wait()
        return {"ok": True, "code": 0, "out": "", "err": "", "figures": [], "saved": []}

    monkeypatch.setattr(scripts.plots, "run", slow)
    published: list[dict] = []

    async def publish(event):
        published.append(event)

    async def scenario():
        runs = ScriptRuns(tmp_path, tmp_path / "state", publish)
        first = [asyncio.ensure_future(runs.run(f"scripts/s{n}.py")) for n in range(3)]
        while len(started) < 3:
            await asyncio.sleep(0.01)
        fourth = await runs.run("scripts/s3.py")
        # A rerun of one already running replaces it rather than counting.
        again = asyncio.ensure_future(runs.run("scripts/s0.py"))
        while len(started) < 4:
            await asyncio.sleep(0.01)
        release.set()
        await asyncio.gather(*first, again, return_exceptions=True)
        return fourth

    fourth = asyncio.run(scenario())
    assert fourth["busy"] == 3 and fourth["ok"] is False
    assert "s3.py" not in started
    assert not [e for e in published if e.get("script") == "scripts/s3.py"]


def test_the_stream_is_told_which_scripts_are_running(tmp_path, monkeypatch):
    """Q-034: the first frames of a connection say which scripts run."""
    release = asyncio.Event()

    async def slow(root, state_dir, path, capture=None, *, on_output=None):
        await release.wait()
        return {"ok": True, "code": 0, "out": "", "err": "", "figures": [], "saved": []}

    monkeypatch.setattr(scripts.plots, "run", slow)

    async def publish(event):
        pass

    async def scenario():
        runs = ScriptRuns(tmp_path, tmp_path / "state", publish)
        assert runs.snapshot() == {"type": "script_state", "running": []}
        task = asyncio.ensure_future(runs.run("scripts/fit.py"))
        await asyncio.sleep(0.05)
        during = runs.snapshot()
        release.set()
        await task
        return during, runs.snapshot()

    during, after = asyncio.run(scenario())
    assert during["running"] == ["scripts/fit.py"]
    assert after["running"] == []

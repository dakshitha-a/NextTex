"""Two listeners share one app, and its background work runs once.

`server/run.py` serves the app on loopback and on the tailnet address as two
uvicorn servers, and uvicorn runs the app's lifespan once per server. Until
8 November 2026 that started everything twice: the journal printed the
`LaTeX` line twice under one pid, and two file watchers reported every edit
made outside NextTex twice, each report folding the change into history and
telling every tab to re-read the tree.
"""

from __future__ import annotations

import asyncio

from server import main


def test_two_listeners_start_the_background_once(monkeypatch) -> None:
    started: list[str] = []
    stopped: list[str] = []

    def fake(name):
        async def run() -> None:
            started.append(name)
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                stopped.append(name)
                raise
        return run

    for name in ("_watch_projects", "_reap_idle", "_rejoin_shared_projects",
                 "_warm_the_agent", "_settle_an_update"):
        monkeypatch.setattr(main, name, fake(name))
    printed: list[str] = []
    monkeypatch.setattr(main, "ensure_tex_on_path", lambda: "/tex")
    monkeypatch.setattr(main, "missing_tools", lambda: [])
    monkeypatch.setattr("builtins.print", lambda *a, **k: printed.append(" ".join(map(str, a))))
    monkeypatch.setattr(main.SETTINGS, "host", False)
    monkeypatch.setattr(main, "SESSIONS", {})
    monkeypatch.setattr(main, "PENDING_JOINS", {})

    async def scenario() -> None:
        async with main.lifespan(main.app):
            async with main.lifespan(main.app):
                await asyncio.sleep(0.01)
                assert sorted(started) == sorted(set(started)) and len(started) == 5
            # One listener has stopped; the other is still serving.
            await asyncio.sleep(0.01)
            assert stopped == []
        await asyncio.sleep(0.01)
        assert sorted(stopped) == sorted(started)

    asyncio.run(scenario())
    assert sum("LaTeX" in line for line in printed) == 1
    assert main._LISTENERS == 0 and main._BACKGROUND == []

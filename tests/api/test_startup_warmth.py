"""The first project opened after a restart should not pay for the SDK.

`providers.agent_for` imports the Claude SDK lazily, which is right -- an
install that chose OpenAI or no agent at all should never load it. But the
import costs about six hundred milliseconds, because the SDK pulls in `mcp`
and `mcp` builds several hundred pydantic models, and it was landing on
whoever opened the first project after the server started. That is every
update, for the person who just pressed the update button.
"""

from __future__ import annotations

import sys

from server import main


def test_the_agent_is_warmed_at_startup(client) -> None:
    """The fixture has already run the lifespan, so the module is in."""
    assert "nexttex.agent" in sys.modules


def test_an_install_without_claude_is_left_alone(monkeypatch) -> None:
    """The whole point of the lazy import is not to load it needlessly."""
    loaded: list[str] = []
    monkeypatch.setattr(main.SETTINGS, "provider", "openai")

    real = main.asyncio.get_running_loop

    def watched():
        loop = real()

        class Recording:
            def run_in_executor(self, _pool, function):
                loaded.append("ran")
                return loop.run_in_executor(_pool, function)

            def __getattr__(self, name):
                return getattr(loop, name)

        return Recording()

    monkeypatch.setattr(main.asyncio, "get_running_loop", watched)

    import asyncio

    asyncio.run(main._warm_the_agent())
    assert loaded == []


def test_warming_never_takes_the_server_down(monkeypatch) -> None:
    """An install missing the SDK reports that when somebody asks a
    question, not by failing to start."""
    import asyncio

    monkeypatch.setattr(main.SETTINGS, "provider", "claude")
    monkeypatch.setitem(sys.modules, "nexttex.agent", None)

    def explode(_name, *args, **kwargs):
        raise ImportError("no SDK here")

    monkeypatch.setattr("builtins.__import__", explode)
    # Returns rather than raises, which is what keeps `lifespan` intact.
    asyncio.run(main._warm_the_agent())

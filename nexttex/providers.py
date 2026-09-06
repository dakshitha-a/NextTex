"""Which writing agent this instance uses, if any.

NextTex is a LaTeX editor first.  The agent is the reason many people will
want it, and it is still not the reason the app exists: the editor, the
preview, the version history, the trash, the reference tools and the git
panel all work with no model behind them at all, and a writer who does not
want an AI in their thesis should get a complete application rather than a
crippled one with a dead panel down the right-hand side.

So there are three providers and one of them is "none".  All three satisfy
the same eleven members, which is what lets `ProjectSession` and every
route stay ignorant of the choice.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any, AsyncIterator

PROVIDERS = ("claude", "openai", "none")


class NoAgent:
    """The agent that says there isn't one.

    Not a stub that throws: a stub that throws would surface as a red
    error strip every time something touched it.  This answers every
    question truthfully -- never busy, nothing to disconnect, no usage --
    and if a question does somehow reach it, says so in one sentence
    rather than failing.
    """

    def __init__(self, *_args: Any, **_kwargs: Any):
        self.model = ""
        self.usage = {
            "turns": 0, "costUsd": 0.0, "inputTokens": 0, "outputTokens": 0,
            "cacheReadTokens": 0, "durationMs": 0, "model": "none",
        }
        self._events: asyncio.Queue | None = None

    def _queue(self) -> asyncio.Queue:
        if self._events is None:
            self._events = asyncio.Queue()
        return self._events

    async def events(self) -> AsyncIterator[dict]:
        queue = self._queue()
        while True:
            yield await queue.get()

    @property
    def busy(self) -> bool:
        return False

    @property
    def idle_seconds(self) -> float:
        return time.monotonic()

    def current_why(self) -> str:
        return ""

    async def disconnect(self) -> None:
        return None

    async def reset(self) -> None:
        return None

    async def interrupt(self) -> None:
        return None

    def resolve_permission(self, request_id: str, decision: str) -> bool:
        return False

    async def set_model(self, model: str | None) -> None:
        return None

    async def ask(self, prompt: str) -> None:
        await self._queue().put({
            "type": "error",
            "message": (
                "This NextTex is set up without a writing agent. "
                "Everything else works; choose a provider in Settings to "
                "turn one on."
            ),
        })
        await self._queue().put({"type": "done", "subtype": "success"})


def agent_for(provider: str, project_root: Path, state_dir: Path, **kwargs: Any):
    """Build the agent this instance is configured for.

    A stand-in wins over all of them when one is asked for, so a test can
    drive the interface without a model whichever provider is configured.
    """
    from .scripted_agent import ScriptedAgent, scripted_name

    # Only the OpenAI one takes a key; the others must not be handed one.
    api_key = kwargs.pop("api_key", "")

    if scripted_name():
        return ScriptedAgent(project_root, state_dir, **kwargs)

    if provider == "openai":
        from .openai_agent import OpenAIAgent

        return OpenAIAgent(project_root, state_dir, api_key=api_key, **kwargs)

    if provider == "none":
        return NoAgent()

    # The default, and what an unrecognised setting falls back to: a
    # configuration typo should not silently turn the agent off.
    #
    # Imported here rather than at the top so that an install which chose
    # OpenAI, or no agent at all, never loads the Claude SDK -- and so that
    # an install missing it says something a person can act on instead of
    # failing with an ImportError on the first question asked.
    try:
        from .agent import ProjectAgent
    except ImportError:
        return Unavailable(
            "The Claude agent needs the claude-agent-sdk package, which is "
            "not installed. Run scripts/install.sh again, or choose OpenAI "
            "or no agent in the sign-in screen."
        )

    return ProjectAgent(project_root, state_dir, **kwargs)


class Unavailable(NoAgent):
    """An agent that was asked for and cannot be built.

    Not an exception: the writer's project has to open, their document has
    to typeset, and the reason the chat panel is not answering belongs in
    the chat panel rather than in a 500 from whatever route happened to
    touch a session first.
    """

    def __init__(self, why: str):
        super().__init__()
        self.why = why

    async def ask(self, prompt: str) -> None:
        await self._queue().put({"type": "error", "message": self.why})
        await self._queue().put({"type": "done", "subtype": "success"})

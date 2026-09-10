"""An agent that follows a script instead of a model.

The real `ProjectAgent` spawns the `claude` CLI: slow, costly, and different
every time.  That makes a large part of NextTex untestable -- streamed
prose, edit chips with their diffs and undo, permission cards and the 350 ms
shield that guards them, the follow-up queue, usage, model switching.  All
of that is interface, and interface is exactly what a test should be able to
drive.

So this stands in.  It has the members the rest of the app actually uses -- `ask`, `events`,
`busy`, `idle_seconds`, `disconnect`, `reset`, `current_why`,
`resolve_permission`, `set_mode`, `set_model`, `model`, `usage` -- and
replays a list of steps through the same event queue the real agent writes
to.  An `edit` step
performs a *real* write through the same `apply_edit` callback, so the
version, the rebuild, the chip and the undo all run for real; a `permission`
step really does block until somebody answers it.

Selected with NEXTTEX_SCRIPTED_AGENT=<name>, which names a file in
tests/scripts/.  It is never reachable in an ordinary run.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any, AsyncIterator, Callable

from .modes import MODES

SCRIPT_DIR = Path(__file__).resolve().parent.parent / "tests" / "scripts"

# How long a `text` step takes to "stream", in total.  Short enough that a
# test does not wait, long enough that a browser sees more than one frame.
STREAM_SECONDS = 0.12


def scripted_name() -> str:
    return os.environ.get("NEXTTEX_SCRIPTED_AGENT", "")


def load_script(name: str) -> list[dict]:
    """The steps for one scripted turn, by name."""
    if not name:
        return []
    path = SCRIPT_DIR / f"{name}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else data.get("steps", [])


class Vanish(Exception):
    """A scripted turn stopping the way the real one did: mid-answer, with
    no result and nothing raised that anybody would have logged."""


class ScriptedAgent:
    """A stand-in for ProjectAgent that replays a script."""

    def __init__(
        self,
        project_root: Path,
        state_dir: Path,
        *,
        context_prompt: Callable[[], str] | None = None,
        has_voice: Callable[[], bool] | None = None,
        remember: Callable[[str], tuple[bool, str]] | None = None,
        editor_state: Callable[[], dict] | None = None,
        diagnostics: Callable[[], list[dict]] | None = None,
        compile_now: Callable[[], Any] | None = None,
        apply_edit: Callable[[Path, str], Any] | None = None,
        on_edit: Callable[[Path, str | None, str | None], Any] | None = None,
        reveal: Callable[[str, int], Any] | None = None,
        model: str | None = None,
        script: str | None = None,
    ):
        self.root = project_root.resolve()
        self.state_dir = state_dir
        self.editor_state = editor_state or (lambda: {})
        self.remember_note = remember or (
            lambda _note: (False, "This project has nowhere to keep a memory.")
        )
        self.mode = "ask"
        self._conversation_allow: set[str] = set()
        self.compile_now = compile_now
        self.apply_edit = apply_edit
        self.on_edit = on_edit
        self.reveal = reveal
        self.model = model
        self.script_name = script or scripted_name()

        self._events: asyncio.Queue | None = None
        self._turn: asyncio.Task | None = None
        self._pending: dict[str, asyncio.Future] = {}
        self._why = ""
        self._last_used = 0.0
        self._counter = 0
        self.usage = {
            "turns": 0, "costUsd": 0.0, "inputTokens": 0, "outputTokens": 0,
            "cacheReadTokens": 0, "durationMs": 0, "model": model or "default",
        }
        # What the last turn was asked, so a test can assert on it.
        self.asked: list[str] = []

    # -- the shape ProjectSession and the routes expect --------------------
    def _queue(self) -> asyncio.Queue:
        if self._events is None:
            self._events = asyncio.Queue()
        return self._events

    async def _emit(self, event: dict) -> None:
        await self._queue().put(event)

    async def events(self) -> AsyncIterator[dict]:
        queue = self._queue()
        while True:
            yield await queue.get()

    @property
    def busy(self) -> bool:
        return self._turn is not None and not self._turn.done()

    @property
    def idle_seconds(self) -> float:
        return time.monotonic() - self._last_used if self._last_used else 0.0

    def current_why(self) -> str:
        return self._why

    async def reset(self) -> None:
        # Refused mid-turn exactly as the real agents refuse it.  A
        # stand-in that is more permissive than the thing it stands in for
        # stops the browser tests from covering the guard at all.
        if self.busy:
            raise RuntimeError("a turn is still running")
        self.asked.clear()
        self._conversation_allow.clear()

    def set_mode(self, mode: str) -> None:
        if mode not in MODES:
            raise ValueError(f"no such permission mode: {mode!r}")
        self.mode = mode

    @property
    def auto(self) -> bool:
        return self.mode != "ask"

    async def disconnect(self) -> None:
        return None

    async def interrupt(self) -> None:
        if self._turn is not None and not self._turn.done():
            self._turn.cancel()
        for future in list(self._pending.values()):
            if not future.done():
                future.cancel()
        await self._emit({"type": "done", "subtype": "interrupted"})

    def resolve_permission(self, request_id: str, decision: str) -> bool:
        future = self._pending.get(request_id)
        if future is None or future.done():
            return False
        future.set_result(decision)
        return True

    async def set_model(self, model: str | None) -> None:
        self.model = model or None
        self.usage["model"] = self.model or "default"

    async def ask(self, prompt: str, *, context: str = "") -> None:
        # Accepted and ignored: what a script replies does not depend on
        # what was selected, but the signature has to match the real ones.
        if self.busy:
            raise RuntimeError("a turn is already running")
        # A browser test cannot set an environment variable, so the script
        # for one turn can be named in the question itself: a first line of
        # `#script:permission` picks tests/scripts/permission.json and is
        # then taken out of the prompt.
        if prompt.startswith("#script:"):
            first, _, rest = prompt.partition("\n")
            self.script_name = first[len("#script:"):].strip() or self.script_name
            prompt = rest.lstrip()
        self.asked.append(prompt)
        self._why = prompt.strip().splitlines()[0][:120] if prompt.strip() else ""
        self._turn = asyncio.create_task(self._run(prompt))

    # -- replaying ---------------------------------------------------------
    async def _run(self, prompt: str) -> None:
        started = time.monotonic()
        await self._emit({"type": "turn_start", "prompt": prompt})
        vanished = False
        try:
            for step in load_script(self.script_name):
                await self._step(step)
        except asyncio.CancelledError:
            # Re-raised, so the task really ends cancelled: swallowing it
            # leaves a task that reports success and a cancellation that
            # never reached whoever asked for it.
            raise
        except Vanish:
            # The one fault the real agent had and nothing could reproduce:
            # a turn that stops without a result and without an error.  It
            # is what a mid-turn disconnect looks like from inside
            # `_stream`, and the interface has to settle anyway.
            vanished = True
        except Exception as error:                       # a broken script
            await self._emit({"type": "error", "message": str(error)})
        self.usage["turns"] += 1
        self.usage["durationMs"] += int((time.monotonic() - started) * 1000)
        self._last_used = time.monotonic()
        if vanished:
            await self._emit({"type": "done", "subtype": "no_result"})
            return
        await self._emit({
            "type": "done", "subtype": "success",
            "costUsd": self.usage["costUsd"], "usage": self.usage,
        })

    async def _step(self, step: dict) -> None:
        kind = step.get("kind", "")

        if kind == "text":
            text = str(step.get("text", ""))
            # In pieces, so the stream itself is exercised rather than a
            # single lump that would never show the caret or the batching.
            pieces = max(1, min(len(text), int(step.get("pieces", 4))))
            size = max(1, len(text) // pieces)
            for index in range(0, len(text), size):
                await self._emit({"type": "text", "text": text[index : index + size]})
                await asyncio.sleep(STREAM_SECONDS / pieces)
            await self._emit({"type": "text_end"})

        elif kind == "tool":
            self._counter += 1
            # A pair, not one event.  A real turn always finishes the calls
            # it starts, so a stand-in whose tool rows never complete is a
            # stand-in kinder than the thing it stands in for, which is the
            # failure the parity test exists to catch.  The step gains an
            # optional `ms` so a spec can assert a number it chose, and
            # every script written before this keeps working.
            await self._tool(
                step.get("name", "Read"),
                step.get("input") or {},
                int(step.get("ms", 40)),
                bool(step.get("ok", True)),
            )

        elif kind == "edit":
            await self._edit(step)

        elif kind == "permission":
            decision = await self._permission(step)
            if decision == "deny" and step.get("stop_if_denied", True):
                raise asyncio.CancelledError

        elif kind == "remember":
            # Writes for real, through the same callback the model's tool
            # uses, so the panel and the prompt section are both exercised.
            note = str(step.get("note", ""))
            _kept, message = self.remember_note(note)
            await self._tool("mcp__nexttex__remember", {"note": note}, 12, True)
            await self._emit({"type": "text", "text": message})
            await self._emit({"type": "text_end"})

        elif kind == "thinking":
            # No text, only the fact of it.  The panel shows that the model
            # is reasoning and never what the reasoning says.
            await self._emit({"type": "thinking"})
            await asyncio.sleep(float(step.get("seconds", 0.05)))
            await self._emit({"type": "thinking_end",
                              "ms": int(step.get("ms", 50))})

        elif kind == "notice":
            await self._emit({"type": "notice",
                              "message": step.get("message", "")})

        elif kind == "error":
            await self._emit({"type": "error", "message": step.get("message", "")})

        elif kind == "wait":
            await asyncio.sleep(float(step.get("seconds", 0.1)))

        elif kind == "vanish":
            raise Vanish

    async def _tool(self, name: str, args: dict, ms: int, ok: bool) -> None:
        """One tool call, started and finished, the way a real one is.

        With the gap in the middle, which is the part that matters. A real
        call takes time between its two events, and that gap is the whole
        window in which the panel says what is being done; emitting the
        pair back to back made the stand-in report every call as having
        started and finished before anything could draw, so the activity
        line went straight back to "Thinking" and a browser spec asserting
        on it could not see the case a writer sees. The scripted duration
        is the wait, so a spec that wants a visible call asks for a longer
        one and the rest stay fast.
        """
        self._counter += 1
        identifier = f"scripted-tool-{self._counter}"
        await self._emit({
            "type": "tool_use", "id": identifier, "name": name, "input": args,
        })
        await asyncio.sleep(min(ms, 3000) / 1000)
        await self._emit({
            "type": "tool_done", "id": identifier, "name": name,
            "ms": ms, "ok": ok,
        })

    async def _edit(self, step: dict) -> None:
        """A real write, so everything downstream of one runs for real."""
        relative = str(step.get("path", ""))
        target = (self.root / relative).resolve()
        if not (target == self.root or self.root in target.parents):
            await self._emit({"type": "error", "message": "outside the project"})
            return
        try:
            before = target.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            before = ""

        after = step.get("text")
        if after is None:
            find, replace = step.get("find", ""), step.get("replace", "")
            after = before.replace(find, replace, 1) if find else before
        after = str(after)

        if self.apply_edit is not None:
            self.apply_edit(target, after)
        elif self.on_edit is not None:
            target.write_text(after, encoding="utf-8")
            self.on_edit(target, before, after)
        await self._emit({
            "type": "edit", "path": relative, "before": before, "after": after,
        })

    async def _permission(self, step: dict) -> str:
        self._counter += 1
        request_id = f"scripted-perm-{self._counter}"
        # Three positions, and this stand-in has to model all of them or a
        # browser spec cannot see the case a writer actually runs into.  It
        # used to approve whatever the script said whenever the switch was
        # on, which is a stand-in kinder than the thing it stands in for.
        #
        # A step says what holds it back with `holds`, in the vocabulary the
        # real fence uses: "outside", "control" or "network".  The middle
        # position asks about those three and runs everything else,
        # including the compound commands it used to card; the last position
        # asks about nothing.
        holds = step.get("holds") or ("network" if step.get("uncovered") else "")
        rule = step.get("rule", "Bash:echo")
        silent = (
            self.mode == "all"
            or (self.mode == "project" and not holds)
            # An answer given earlier in this conversation, which the real
            # fence consults in the same place. Without this the stand-in
            # asked again, so a browser spec could see the button and not
            # what pressing it buys.
            or (rule and rule in self._conversation_allow)
        )
        if silent:
            # The same pre-decided card the real fence emits, so the browser
            # specs exercise what a writer would actually see.
            await self._emit({
                "type": "permission",
                "id": f"auto-{self._counter}",
                "tool": step.get("tool", "Bash"),
                "rule": rule,
                "decision": (
                    "conversation"
                    if rule and rule in self._conversation_allow
                    else "auto"
                ),
                "headline": step.get("headline", "Run a shell command"),
                "detail": step.get("detail", "echo hello"),
                "consequence": step.get("consequence", ""),
                "reason": step.get("reason", ""),
            })
            return "allow"
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        await self._emit({
            "type": "permission",
            "id": request_id,
            "tool": step.get("tool", "Bash"),
            "rule": step.get("rule", "Bash:echo"),
            "headline": step.get("headline", "Run a shell command"),
            "detail": step.get("detail", "echo hello"),
            "consequence": step.get("consequence", ""),
            "reason": step.get("reason", ""),
        })
        try:
            answer = await future
        except asyncio.CancelledError:
            return "deny"
        finally:
            self._pending.pop(request_id, None)
        if answer == "conversation" and rule:
            self._conversation_allow.add(rule)
        return answer

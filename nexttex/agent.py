"""The writing agent: one Claude session per project, driven from the browser.

The agent is scoped to a writing project and nothing else. Its working
directory is the project root, so it cannot see NextTex's own source, and it
loads the project's own CLAUDE.md, so whatever rules a project has set for
itself apply without being restated here.

Two things are worth understanding before changing this file.

**The permission fence is a PreToolUse hook, not `can_use_tool`.** This was
established by testing, not by reading: with `can_use_tool` supplied and no
allowed_tools entry covering it, a Bash call still ran without the callback
ever firing, in every permission mode. The SDK's own shadowing warning names
the reliable mechanism -- "to gate every tool call, use a PreToolUse hook" --
and a hook does fire for every call, can return a deny decision, and can
await an answer from the browser before returning. `can_use_tool` is not
used here at all; a fence that silently does nothing is worse than none.

**Disk is the source of truth.** The agent uses ordinary Edit and Write.
Nothing here proxies edits through the editor, because the editor autosaves
to disk and watches it. The custom tools below exist only for the things a
filesystem cannot express -- where the cursor is, what the compiler said.

**A turn outlives the request that started it.** Everything a turn produces
-- streamed text, tool calls, edits, permission cards -- goes into one queue
per project, and the turn runs as its own task. Two things follow. Closing
the browser mid-turn no longer abandons the agent halfway through, leaving
the next message to deadlock behind a half-consumed response. And because
permission cards travel the same queue as the text, they arrive in the order
they happened, so a card sits after the sentence that provoked it instead of
racing it through a side channel.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Callable

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    HookMatcher,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
    create_sdk_mcp_server,
    tool,
)

SESSION_FILE = "session.json"

# Tools that never need asking about: they only read.
READ_ONLY_TOOLS = [
    "Read", "Glob", "Grep", "NotebookRead", "TodoWrite",
    "WebSearch", "WebFetch",
]

SYSTEM_PROMPT = """\
You are helping write and maintain a document in NextTex, a LaTeX editor.

The user is looking at their source on the left and the rendered PDF on the
right. Edits you make appear in their editor within a second, so make them
directly rather than printing LaTeX for the user to copy.

How to work here:

- Prefer a small, surgical edit over rewriting a section. The user is
  reading the diff of what you changed.
- When you write prose, write finished prose. Not an outline, not a
  placeholder, not a comment saying what should go here.
- Match the document's existing conventions -- its macros, its citation
  commands, how its figures and tables are set up. Read a neighbouring
  section before adding to one.
- Never invent a citation. If a reference is needed and you cannot verify
  it exists, say so and ask, rather than producing a plausible key.
- Keep the document compiling. If you are unsure a construct is valid,
  compile and check rather than leaving it for the user to discover.

Explain what you changed in a sentence or two. The user can see the diff, so
do not restate it line by line."""


@dataclass
class EditRecord:
    """One file the agent changed, for the undo chip in the transcript."""

    tool: str
    path: str
    before: str | None
    after: str | None
    at: float = field(default_factory=time.time)


class ProjectAgent:
    """A live Claude session bound to one writing project."""

    def __init__(
        self,
        project_root: Path,
        state_dir: Path,
        *,
        context_prompt: Callable[[], str] | None = None,
        editor_state: Callable[[], dict] | None = None,
        diagnostics: Callable[[], list[dict]] | None = None,
        compile_now: Callable[[], Any] | None = None,
        model: str | None = None,
    ):
        self.root = project_root.resolve()
        self.state_dir = state_dir
        self.context_prompt = context_prompt or (lambda: "")
        self.editor_state = editor_state or (lambda: {})
        self.diagnostics = diagnostics or (lambda: [])
        self.compile_now = compile_now
        self.model = model

        self._client: ClaudeSDKClient | None = None
        self._lock = asyncio.Lock()
        self._session_id: str | None = None
        self._last_used = 0.0
        # What this project has spent, kept beside the session so it
        # survives a restart.  Writers on a subscription still want to know
        # how much of the day's work went through the model.
        self.usage = self._load_usage()

        # A permission request in flight, waiting on the browser.
        self._pending: dict[str, asyncio.Future] = {}
        # Prefixes the user chose to always allow, e.g. "Bash:latexmk".
        self._always_allow: set[str] = set()
        # Edits made this turn, drained by the caller into the transcript.
        self._edits: list[EditRecord] = []
        self._file_snapshots: dict[str, str] = {}
        # The single ordered channel every turn writes to.
        self._events: asyncio.Queue | None = None
        self._turn: asyncio.Task | None = None
        self._cancelled = False

    # -- session persistence ---------------------------------------------
    @property
    def _session_path(self) -> Path:
        return self.state_dir / SESSION_FILE

    def _load_session(self) -> str | None:
        try:
            return json.loads(self._session_path.read_text()).get("session_id")
        except (OSError, json.JSONDecodeError):
            return None

    def _save_session(self, session_id: str) -> None:
        # Written through a temporary file: an interrupted write here would
        # otherwise leave unparseable JSON and silently lose the whole
        # conversation history on the next start.
        try:
            temp = self._session_path.with_suffix(".json.tmp")
            temp.write_text(json.dumps({"session_id": session_id}), encoding="utf-8")
            temp.replace(self._session_path)
        except OSError:
            pass

    # -- permissions -------------------------------------------------------
    def _inside_project(self, raw: str | None) -> bool:
        if not raw:
            return False
        try:
            candidate = Path(raw)
            if not candidate.is_absolute():
                candidate = self.root / candidate
            candidate = candidate.resolve()
        except OSError:
            return False
        return candidate == self.root or self.root in candidate.parents

    @staticmethod
    def _rule_for(tool_name: str, data: dict) -> str:
        """The scope an 'always allow' grants.

        Scoped by the command's first word, never blanket: allowing
        `latexmk -c` must not also allow `rm`.
        """
        if tool_name == "Bash":
            command = (data.get("command") or "").strip()
            first = command.split()[0] if command else ""
            return f"Bash:{first}"
        return tool_name

    def describe(self, tool_name: str, data: dict) -> dict:
        """Plain-English headline and detail for a permission card."""
        if tool_name == "Bash":
            return {
                "headline": "Run a shell command",
                "detail": data.get("command", ""),
                "consequence": data.get("description", ""),
            }
        path = data.get("file_path") or data.get("path") or ""
        display = path
        try:
            display = str(Path(path).resolve().relative_to(self.root))
        except (ValueError, OSError):
            pass
        if tool_name in {"Write", "Edit", "MultiEdit", "NotebookEdit"}:
            return {
                "headline": f"Write outside the project: {display}",
                "detail": path,
                "consequence": "This file is not part of this writing project.",
            }
        return {"headline": f"Use {tool_name}", "detail": json.dumps(data)[:400],
                "consequence": ""}

    def resolve_permission(self, request_id: str, decision: str) -> bool:
        future = self._pending.get(request_id)
        if future is None or future.done():
            return False
        future.set_result(decision)
        return True

    # -- hooks -------------------------------------------------------------
    # Tool calls that are always safe here: they only read, or they are our
    # own in-process tools.  Checked in the hook rather than delegated to
    # `allowed_tools`, so the decision lives in one place.
    _ALWAYS_OK = frozenset(READ_ONLY_TOOLS) | {
        "mcp__nexttex__editor_state",
        "mcp__nexttex__compile_diagnostics",
        "mcp__nexttex__compile",
        # How the model finds out which tools exist.  Asking the writer to
        # approve that is asking them to approve punctuation: it reads
        # nothing, changes nothing, and a card for it trains them to click
        # Allow without looking, which is exactly what the cards are for.
        "ToolSearch",
        "TodoWrite",
        "Task",
    }
    _WRITE_TOOLS = frozenset({"Write", "Edit", "MultiEdit", "NotebookEdit"})

    @staticmethod
    def _allow(reason: str = "") -> dict:
        return {"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": reason,
        }}

    @staticmethod
    def _deny(reason: str) -> dict:
        return {"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }}

    async def _pre_tool(self, input_data: dict, tool_use_id: str | None, ctx: Any) -> dict:
        """Decide whether a tool call may proceed, and snapshot what it will change.

        This is the security boundary.  It runs before every tool call and
        can block for as long as it takes the user to answer.
        """
        tool_name = input_data.get("tool_name", "")
        tool_input = input_data.get("tool_input") or {}

        if tool_name in self._ALWAYS_OK:
            return self._allow()

        if tool_name in self._WRITE_TOOLS:
            raw = tool_input.get("file_path") or tool_input.get("path")
            if self._inside_project(raw):
                # Snapshot first: the undo chip needs the previous contents,
                # and after the edit lands they are gone.
                path = Path(raw)
                if not path.is_absolute():
                    path = self.root / path
                try:
                    self._file_snapshots[str(path)] = path.read_text(
                        encoding="utf-8", errors="replace"
                    )
                except OSError:
                    self._file_snapshots[str(path)] = ""
                return self._allow("Inside the writing project.")
            # Falls through to ask.

        decision = await self._ask_user(tool_name, tool_input)
        if decision in {"allow", "always"}:
            return self._allow()
        result = self._deny("The user declined this action.")
        if self._cancelled:
            result["continue_"] = False
            result["stopReason"] = "Interrupted."
        return result

    async def _ask_user(self, tool_name: str, tool_input: dict) -> str:
        """Put a permission card in front of the user and wait for the answer."""
        rule = self._rule_for(tool_name, tool_input)
        if rule in self._always_allow:
            return "allow"

        request_id = f"perm-{int(time.time()*1000)}-{len(self._pending)}"
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future

        await self._emit({
            "type": "permission",
            "id": request_id,
            "tool": tool_name,
            "rule": rule,
            **self.describe(tool_name, tool_input),
        })

        try:
            decision = await future
        except asyncio.CancelledError:
            # An interrupt while a card is open must end the turn, not just
            # refuse this one call and let the agent carry on.
            self._cancelled = True
            return "deny"
        finally:
            self._pending.pop(request_id, None)

        if decision == "always":
            self._always_allow.add(rule)
        return decision

    async def _post_tool(self, input_data: dict, tool_use_id: str | None, ctx: Any) -> dict:
        """Record what an edit did, for the chip and its undo."""
        tool_name = input_data.get("tool_name", "")
        if tool_name not in {"Write", "Edit", "MultiEdit"}:
            return {}
        raw = (input_data.get("tool_input") or {}).get("file_path")
        if not raw or not self._inside_project(raw):
            return {}
        path = Path(raw)
        if not path.is_absolute():
            path = self.root / path
        try:
            after = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            after = None
        before = self._file_snapshots.pop(str(path), None)
        if before == after:
            return {}
        try:
            display = str(path.resolve().relative_to(self.root))
        except (ValueError, OSError):
            display = str(path)
        self._edits.append(EditRecord(tool_name, display, before, after))
        return {}

    def drain_edits(self) -> list[EditRecord]:
        edits, self._edits = self._edits, []
        return edits

    # -- custom tools ------------------------------------------------------
    def _tools_server(self):
        """Tools for things the filesystem cannot answer.

        Deliberately few. The agent already has Read, Write, Edit, Glob and
        Grep, and every tool added here costs context on every turn.
        """

        @tool(
            "editor_state",
            "Where the user is looking: the open file, the cursor line, and any "
            "text they have selected. Use this when they say 'here' or 'this'.",
            {},
        )
        async def editor_state(args: dict) -> dict:
            state = self.editor_state()
            return {"content": [{"type": "text", "text": json.dumps(state, indent=2)}]}

        @tool(
            "compile_diagnostics",
            "Errors and warnings from the most recent LaTeX build, with file "
            "and line numbers.",
            {},
        )
        async def compile_diagnostics(args: dict) -> dict:
            items = self.diagnostics()
            if not items:
                return {"content": [{"type": "text",
                                     "text": "The last build produced no errors or warnings."}]}
            lines = [
                f"{d.get('severity')}: {d.get('file')}:{d.get('line')} — {d.get('message')}"
                for d in items
            ]
            return {"content": [{"type": "text", "text": "\n".join(lines)}]}

        @tool(
            "compile",
            "Rebuild the document now and report whether it succeeded. Use this "
            "to check your own work before saying you are done.",
            {},
        )
        async def compile_document(args: dict) -> dict:
            if self.compile_now is None:
                return {"content": [{"type": "text", "text": "Compiling is unavailable."}],
                        "is_error": True}
            result = await self.compile_now()
            payload = result.as_dict() if hasattr(result, "as_dict") else result
            errors = payload.get("errorCount", 0)
            if errors:
                detail = "\n".join(
                    f"{d['file']}:{d['line']} — {d['message']}"
                    for d in payload.get("diagnostics", []) if d["severity"] == "error"
                )
                return {"content": [{"type": "text",
                                     "text": f"Build failed with {errors} error(s):\n{detail}"}]}
            return {"content": [{"type": "text",
                                 "text": f"Built cleanly in {payload.get('durationMs')} ms."}]}

        return create_sdk_mcp_server(
            name="nexttex",
            version="1.0.0",
            tools=[editor_state, compile_diagnostics, compile_document],
        )

    # -- lifecycle ---------------------------------------------------------
    def _options(self) -> ClaudeAgentOptions:
        system = SYSTEM_PROMPT
        extra = self.context_prompt()
        if extra:
            system = f"{system}\n\n---\n\n{extra}"

        return ClaudeAgentOptions(
            cwd=str(self.root),
            system_prompt=system,
            model=self.model,
            # The project's own CLAUDE.md and settings load; NextTex's do not.
            setting_sources=["project"],
            include_partial_messages=True,
            # allowed_tools is deliberately empty and can_use_tool is
            # deliberately unset.  An entry in either shadows the PreToolUse
            # hook for that tool, and the hook is the fence.  Read-only tools
            # are waved through inside the hook instead, which keeps every
            # permission decision in one readable place.
            mcp_servers={"nexttex": self._tools_server()},
            hooks={
                "PreToolUse": [HookMatcher(hooks=[self._pre_tool])],
                "PostToolUse": [HookMatcher(hooks=[self._post_tool])],
            },
            resume=self._load_session(),
        )

    async def _ensure_client(self) -> ClaudeSDKClient:
        if self._client is not None:
            return self._client
        client = ClaudeSDKClient(options=self._options())
        await client.connect()
        self._client = client
        return client

    async def disconnect(self) -> None:
        client, self._client = self._client, None
        if client is not None:
            try:
                await client.disconnect()
            except Exception:
                pass

    @property
    def idle_seconds(self) -> float:
        return time.monotonic() - self._last_used if self._last_used else 0.0

    async def interrupt(self) -> None:
        self._cancelled = True
        if self._turn is not None and not self._turn.done():
            self._turn.cancel()
        if self._client is not None:
            try:
                await self._client.interrupt()
            except Exception:
                pass
        for future in list(self._pending.values()):
            if not future.done():
                future.cancel()

    # -- the conversation ---------------------------------------------------
    # One queue per project carries everything a turn produces, in the order
    # it happened.  The SSE route drains it; the turn does not care whether
    # anyone is listening.

    def _queue(self) -> asyncio.Queue:
        if self._events is None:
            self._events = asyncio.Queue()
        return self._events

    async def _emit(self, event: dict) -> None:
        await self._queue().put(event)

    async def events(self) -> AsyncIterator[dict]:
        """Drain the event queue. Safe to leave and re-enter mid-turn."""
        queue = self._queue()
        while True:
            yield await queue.get()

    @property
    def busy(self) -> bool:
        return self._turn is not None and not self._turn.done()

    async def ask(self, prompt: str) -> None:
        """Start a turn. Returns as soon as it is running, not when it ends.

        The turn is a task so that it survives the HTTP request that
        started it; the browser reads the result from the event stream.
        """
        if self.busy:
            raise RuntimeError("a turn is already running")
        self._cancelled = False
        await self._emit({"type": "turn_start", "prompt": prompt})
        self._turn = asyncio.create_task(self._run_turn(prompt))

    async def _run_turn(self, prompt: str) -> None:
        try:
            await self._stream(prompt)
        except asyncio.CancelledError:
            await self._emit({"type": "done", "subtype": "interrupted"})
            raise
        except Exception as exc:  # a crashed turn must not stall the UI
            await self._emit({
                "type": "error",
                "message": f"{type(exc).__name__}: {exc}",
            })
            await self._emit({"type": "done", "subtype": "error"})
        finally:
            self._turn = None

    async def _stream(self, prompt: str) -> None:
        async with self._lock:
            self._last_used = time.monotonic()
            client = await self._ensure_client()
            await client.query(prompt)

            # With include_partial_messages on, text arrives twice: as
            # content_block_delta events and again in the completed
            # AssistantMessage.  The deltas are what makes the reply appear
            # as it is written, so those are rendered and the finished block
            # is used only to close the run -- emitting both would double
            # every sentence.
            streaming_text = False

            async for message in client.receive_response():
                if isinstance(message, StreamEvent):
                    event = getattr(message, "event", {}) or {}
                    if event.get("type") == "content_block_delta":
                        delta = event.get("delta") or {}
                        if delta.get("type") == "text_delta" and delta.get("text"):
                            streaming_text = True
                            await self._emit({"type": "text", "text": delta["text"]})
                    elif event.get("type") == "content_block_stop" and streaming_text:
                        streaming_text = False
                        await self._emit({"type": "text_end"})
                    continue

                if isinstance(message, SystemMessage):
                    session_id = (getattr(message, "data", {}) or {}).get("session_id")
                    if session_id and session_id != self._session_id:
                        self._session_id = session_id
                        self._save_session(session_id)
                    continue

                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, ToolUseBlock):
                            await self._emit({
                                "type": "tool_use",
                                "id": block.id,
                                "name": block.name,
                                "input": block.input,
                            })
                        elif isinstance(block, TextBlock) and not streaming_text:
                            # No deltas arrived for this block, so nothing has
                            # been shown yet.
                            if block.text:
                                await self._emit({"type": "text", "text": block.text})
                                await self._emit({"type": "text_end"})
                    continue

                if isinstance(message, UserMessage):
                    # Tool results arrive as user messages; what the
                    # transcript wants from them is the edits they produced.
                    await self._flush_edits()
                    continue

                if isinstance(message, ResultMessage):
                    await self._flush_edits()
                    session_id = getattr(message, "session_id", None)
                    if session_id and session_id != self._session_id:
                        self._session_id = session_id
                        self._save_session(session_id)
                    self._record_usage(message)
                    await self._emit({
                        "type": "done",
                        "subtype": message.subtype,
                        "costUsd": getattr(message, "total_cost_usd", None),
                        "durationMs": getattr(message, "duration_ms", None),
                        "usage": self.usage,
                    })
                    self._last_used = time.monotonic()
                    return

    # -- usage -------------------------------------------------------------
    @property
    def usage_path(self) -> Path:
        return self.state_dir / "usage.json"

    def _load_usage(self) -> dict:
        blank = {
            "turns": 0, "costUsd": 0.0, "inputTokens": 0, "outputTokens": 0,
            "cacheReadTokens": 0, "durationMs": 0, "model": self.model or "default",
        }
        try:
            saved = json.loads(self.usage_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return blank
        return {**blank, **{k: v for k, v in saved.items() if k in blank}}

    def _record_usage(self, message: Any) -> None:
        counts = getattr(message, "usage", None) or {}
        self.usage["turns"] += 1
        self.usage["costUsd"] += getattr(message, "total_cost_usd", None) or 0.0
        self.usage["durationMs"] += getattr(message, "duration_ms", None) or 0
        self.usage["inputTokens"] += counts.get("input_tokens", 0) or 0
        self.usage["outputTokens"] += counts.get("output_tokens", 0) or 0
        self.usage["cacheReadTokens"] += (
            counts.get("cache_read_input_tokens", 0) or 0
        )
        self.usage["model"] = self.model or "default"
        try:
            temp = self.usage_path.with_suffix(".json.tmp")
            temp.write_text(json.dumps(self.usage, indent=2), encoding="utf-8")
            temp.replace(self.usage_path)
        except OSError:
            pass

    async def set_model(self, model: str | None) -> None:
        """Change the model this project's agent uses.

        The client carries the model it was started with, so this ends the
        current one; the next question starts a fresh client, which resumes
        the same conversation from its stored session id.  Nothing in the
        transcript is lost.
        """
        if (model or None) == (self.model or None):
            return
        self.model = model or None
        await self.close()

    async def _flush_edits(self) -> None:
        for edit in self.drain_edits():
            await self._emit({
                "type": "edit",
                "path": edit.path,
                "before": edit.before,
                "after": edit.after,
            })

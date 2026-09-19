"""The permission card's shared parts: rule keys, card texts, and a gate.

Two agents put a card in front of the writer before running a script:
the Claude one in `agent.py`, whose fence is a hook on the SDK and is
tested down to its private fields, and the OpenAI one in
`openai_agent.py`, which had no card at all until the backlog close-out.
What the two must agree on is here, so that the browser and the replay
cannot tell which provider put a card up:

- **the rule key** an "always" remembers, spelled the Claude way for both
  providers (`mcp__nexttex__run_script:<digest>`), because the rule names
  the code the writer approved and not the model that proposed it, and an
  answer given under one provider holds under the other;
- **the card texts** for the three script tools, so the same script draws
  the same card;
- **the reason** a card gives at the middle position, and the notice for
  a card nobody answered;
- **`PermissionGate`**, the pending futures, the remembered rules and the
  settings file, for an agent that does not have `agent.py`'s own copy.
  `agent.py` keeps its copy: `tests/test_permissions.py` holds it by its
  private fields, and the fence of a three-thousand-line file is not
  refactored in the same push as a feature.

Its own module, and importing nothing from `agent.py`, for the reason
`modes.py` gives: an install that chose OpenAI must never load the Claude
SDK.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import secrets
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

from .modes import DEFAULT_MODE, MODES

log = logging.getLogger("nexttex.permission")

# How long a permission card may sit unanswered before the turn gives up on
# it.  A card that never reached a browser -- the tab was closed, the stream
# dropped between the emit and the render -- used to block the turn for
# ever, holding the lock and leaving the interface thinking.  Ten minutes is
# long enough that nobody who stepped away for coffee loses their answer,
# and short enough that a lost card is not a wedged project.
PERMISSION_TIMEOUT = 600.0

#: The three tools that run code or fetch it, by the names the Claude
#: agent's MCP server gives them, which are the names the rule keys use.
SCRIPT_TOOLS = ("run_plot_script", "run_script", "install_package")

#: Which positions ask about a script or a package.  `ask` asks about
#: everything; `project` still asks about these two, because a script can
#: do anything Python can and a package install runs code from PyPI; `all`
#: asks about nothing and records instead.
HELD_BACK_AT_PROJECT = ("script", "network")


def canonical(kind: str) -> str:
    """The rule-key spelling of a script tool's name."""
    return kind if kind.startswith("mcp__nexttex__") else f"mcp__nexttex__{kind}"


def script_rule(kind: str, text: str) -> str:
    """What an "always" on a script card remembers.

    The script's text, not the tool's name.  The bare tool name was the
    rule once, so one "always" on a card showing one script let every
    later script run silently.  The digest of what the card showed is
    what the writer agreed to, and exactly that; an empty script is
    nothing nameable, so nothing is remembered and the card comes back.
    """
    if not text:
        return ""
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    return f"{canonical(kind)}:{digest}"


def install_rule(name: str) -> str:
    name = (name or "").strip()
    return f"install:{name}" if name else ""


def holds_back(kind: str) -> str:
    """What a script tool is held back for: `script`, or `network` for an
    install, which fetches from PyPI and runs what it fetches."""
    return "network" if canonical(kind) == "mcp__nexttex__install_package" else "script"


def reason_at(mode: str, why: str) -> str:
    """One sentence saying which rule put this card up.

    Empty at the first position, because there the answer is simply that
    this app asks before it acts, and a sentence explaining that on every
    card is a sentence people stop reading.  It has something to say at
    the middle position, where the writer has asked not to be interrupted
    and is being interrupted anyway.
    """
    if mode != "project":
        return ""
    if why == "network":
        return (
            "Asked at this setting, because what is sent and where it "
            "goes are chosen from files that may not be yours."
        )
    if why == "script":
        return (
            "Asked at this setting: a script can do anything Python can, "
            "which is more than any single command could."
        )
    return ""


def script_card(kind: str, mode: str, *, name: str = "", text: str = "",
                command: str = "") -> dict:
    """Headline, detail, consequence and reason for a script tool's card.

    The detail is the code itself, because that is the thing being agreed
    to; a summary of it would be a card about a description.
    """
    reason = reason_at(mode, holds_back(kind))
    kind = canonical(kind)
    if kind == "mcp__nexttex__run_plot_script":
        return {
            "headline": "Run a script to draw a figure",
            "detail": text,
            "consequence": "This is Python, so it can do anything Python "
                           "can: read files, write them, and reach the "
                           "network. It is saved in scripts/ either way, "
                           "so you can read it again afterwards.",
            "reason": reason,
        }
    if kind == "mcp__nexttex__run_script":
        return {
            "headline": f"Run scripts/{name}.py",
            "detail": text or "(the script could not be read)",
            "consequence": "This is Python, so it can do anything Python "
                           "can: read files, write them, and reach the "
                           "network. Nothing is rewritten; the file runs "
                           "as it is.",
            "reason": reason,
        }
    return {
        "headline": f"Install a Python package: {name}",
        "detail": command,
        "consequence": "This downloads and runs installation code "
                       "from PyPI, into the environment NextTex "
                       "itself runs in.",
        "reason": reason,
    }


def expired_notice(tool_name: str) -> str:
    return (
        f"NextTex waited {int(PERMISSION_TIMEOUT // 60)} minutes for an "
        f"answer about {tool_name} and did not get one, so it said no. "
        "Ask again if you meant to allow it."
    )


class PermissionGate:
    """The cards waiting on an answer, and the answers worth remembering.

    Built for an agent with an event queue and nothing else: `emit` puts
    an event on that queue, `describe` says what a tool call is in plain
    words, and `state_dir` is where `agent-settings.json` lives, the same
    file and the same shape the Claude agent writes, so the mode and the
    remembered rules are the project's rather than one provider's.
    """

    def __init__(
        self,
        state_dir: Path,
        emit: Callable[[dict], Awaitable[None]],
        describe: Callable[[str, dict], dict],
    ):
        self.state_dir = state_dir
        self.path = state_dir / "agent-settings.json"
        self._emit = emit
        self._describe = describe
        self._pending: dict[str, asyncio.Future] = {}
        self._cards: dict[str, dict] = {}
        self.conversation: set[str] = set()
        stored = self._stored()
        self.mode = self._mode_from(stored)
        self.always: set[str] = self._allow_from(stored)

    # -- the settings file --------------------------------------------------
    def _stored(self) -> dict:
        try:
            stored = json.loads(self.path.read_text())
        except (OSError, json.JSONDecodeError):
            return {}
        return stored if isinstance(stored, dict) else {}

    @staticmethod
    def _mode_from(stored: dict) -> str:
        # A settings file written before there were three positions carries
        # a boolean, and it is read rather than discarded: the middle
        # position, never promoted to the third, because nobody agreed to
        # that.
        mode = stored.get("mode")
        if isinstance(mode, str) and mode in MODES:
            return mode
        if "auto" in stored:
            return "project" if stored.get("auto") else "ask"
        return DEFAULT_MODE

    @staticmethod
    def _allow_from(stored: dict) -> set[str]:
        # Anything that is not a list of strings is read as nothing: a file
        # somebody hand-edited should cost an answer given again, never a
        # project that will not open.
        allow = stored.get("allow")
        if not isinstance(allow, list):
            return set()
        return {rule for rule in allow if isinstance(rule, str) and rule}

    def save(self) -> None:
        try:
            self.state_dir.mkdir(parents=True, exist_ok=True)
            temp = self.path.with_suffix(".json.tmp")
            temp.write_text(
                json.dumps({
                    "mode": self.mode,
                    # Written as well as the mode, for one version, so a
                    # tab or an install that has not been updated does not
                    # read a fence it does not understand as no fence.
                    "auto": self.mode != "ask",
                    "allow": sorted(self.always),
                }),
                encoding="utf-8",
            )
            temp.replace(self.path)
        except OSError:
            pass

    def set_mode(self, mode: str) -> None:
        # Reachable from an HTTP body, so an unknown string is an error and
        # not a silent fall back to the quietest thing available.
        if mode not in MODES:
            raise ValueError(f"no such permission mode: {mode!r}")
        self.mode = mode
        self.save()

    @property
    def auto(self) -> bool:
        return self.mode != "ask"

    # -- what is remembered -------------------------------------------------
    def already_answered(self, rule: str) -> str:
        if not rule:
            return ""
        if rule in self.always:
            return "always"
        if rule in self.conversation:
            return "conversation"
        return ""

    def forget_conversation(self) -> None:
        self.conversation.clear()

    # -- the cards ----------------------------------------------------------
    @property
    def pending_cards(self) -> list[dict]:
        """The cards waiting on an answer right now, for a browser that
        reloaded: a reload loses the card and not the turn."""
        return list(self._cards.values())

    def resolve(self, request_id: str, decision: str) -> bool:
        future = self._pending.get(request_id)
        if future is None or future.done():
            return False
        future.set_result(decision)
        return True

    def cancel_all(self) -> None:
        """Answer every open card with no, for an interrupt: the turn is
        ending and a card left open would wait out its own timeout."""
        for future in self._pending.values():
            if not future.done():
                future.set_result("deny")

    async def settled(self, tool_name: str, tool_input: dict, rule: str,
                      decision: str, tool_id: str = "") -> None:
        """Record an action allowed without anybody being asked, in the
        shape of a card the writer answered, so the transcript reads as one
        list of what was done."""
        await self._emit({
            "type": "permission",
            "id": f"{decision}-{int(time.time()*1000)}-{secrets.token_hex(3)}",
            "tool": tool_name,
            "rule": rule,
            "decision": decision,
            "toolId": tool_id,
            **self._describe(tool_name, tool_input),
            # Nothing stopped, so the sentence saying why a card stopped is
            # blank; `describe` sets it and this overrides it.
            "reason": "",
        })

    async def ask(self, tool_name: str, tool_input: dict, rule: str,
                  tool_id: str = "") -> str:
        """Put a card in front of the writer and wait for the answer.

        Returns `allow`, `always`, `conversation` or `deny`.  A remembered
        answer is recorded as a settled card rather than passed silently:
        a rule the writer set earlier is still an action taken on their
        document.
        """
        remembered = self.already_answered(rule)
        if remembered:
            await self.settled(tool_name, tool_input, rule, remembered, tool_id)
            return "allow"

        request_id = f"perm-{int(time.time()*1000)}-{secrets.token_hex(3)}"
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        card = {
            "type": "permission",
            "id": request_id,
            "tool": tool_name,
            "rule": rule,
            "toolId": tool_id,
            **self._describe(tool_name, tool_input),
        }
        self._cards[request_id] = card
        await self._emit(card)
        try:
            decision = await asyncio.wait_for(future, timeout=PERMISSION_TIMEOUT)
        except asyncio.TimeoutError:
            # Nobody answered, most likely because the card never reached a
            # browser.  Denying is the safe reading of silence, and saying
            # so is what stops the turn from looking wedged.
            log.warning("permission request %s went unanswered", request_id)
            await self._emit({**card, "decision": "expired", "reason": ""})
            await self._emit({"type": "notice", "message": expired_notice(tool_name)})
            return "deny"
        finally:
            self._pending.pop(request_id, None)
            self._cards.pop(request_id, None)

        if decision == "conversation" and rule:
            self.conversation.add(rule)
        if decision == "always" and rule:
            self.always.add(rule)
            self.save()
        return decision

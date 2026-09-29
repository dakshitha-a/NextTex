"""An always-on install that keeps its writers' shared projects in step.

A host is an ordinary install with host mode on. It has no accounts: a
writer pairs with it once by pasting its pairing code, which carries the
host's address and a secret, and from then on the writer's install asks it
to keep each project it shares. The host joins with the invite it was
handed, exactly as a person would, and accepts the join itself into a
folder of its own under `host_root`, since nobody is there to look at an
offer card. It says it is a host in its HELLO, so the others record its
role, draw it as a host rather than a collaborator, and let it write the
paragraph merge when it is present.

The conversation is one frame each way on a connection of its own:
HOST_KEEP from the writer, with the pairing secret, the writer's name and,
when there is one, an invite and the project's name; HOST_KEPT back, with
whether it worked and why not. A key that presented the secret once is
remembered as paired, and a paired key that is removed is refused again.
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
import secrets
import time
from pathlib import Path
from typing import Awaitable, Callable

from . import wire

PREFIX = "nexttex-host-v1-"
#: How long a writer waits for a host to join and take the whole project.
ASK_TIMEOUT = 120.0


def make_secret() -> str:
    return secrets.token_urlsafe(24)


def make_code(address: str, secret: str) -> str:
    body = json.dumps({"v": 1, "address": address, "secret": secret}, separators=(",", ":"))
    return PREFIX + base64.urlsafe_b64encode(body.encode()).decode().rstrip("=")


def read_code(code: str) -> dict | None:
    """The address and secret a pairing code carries, or None."""
    code = (code or "").strip()
    if not code.startswith(PREFIX):
        return None
    body = code[len(PREFIX):]
    try:
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or data.get("v") != 1:
        return None
    address, secret = str(data.get("address") or ""), str(data.get("secret") or "")
    if not address or not secret:
        return None
    return {"address": address, "secret": secret}


_UNSAFE = re.compile(r"[^A-Za-z0-9._ -]+")


def folder_name(project: str) -> str:
    """A folder name made here from a name a peer sent, which is only ever
    a suggestion: letters, digits, dots, dashes and spaces, no leading dot,
    at most 80 characters."""
    name = _UNSAFE.sub("-", project or "").strip(" .-")[:80].strip(" .-")
    return name or "project"


def folder_for(root: Path, project: str) -> Path:
    """A new folder under `root` for a kept project. Refuses anything that
    would land outside it, and never reuses a name that is taken."""
    root = root.resolve()
    base = folder_name(project)
    for number in range(1, 1000):
        candidate = root / (base if number == 1 else f"{base} ({number})")
        if candidate.resolve().parent != root:
            raise PermissionError("That project name does not make a folder here.")
        if not candidate.exists():
            return candidate
    raise OSError("Too many kept projects of that name.")


class HostService:
    """The host's side: answers HOST_KEEP on the install's endpoint.

    `settings` gives the live settings and `save` writes them; `keep` joins
    an invite into a folder and accepts it, returning "" or why not; `name`
    is what the host calls itself.
    """

    def __init__(self, settings, save: Callable[[], None],
                 keep: Callable[[str, str], Awaitable[str]], name: Callable[[], str]) -> None:
        self.settings = settings
        self.save = save
        self.keep = keep
        self.name = name

    def paired(self, peer_id: str) -> bool:
        return any(entry.get("peer") == peer_id for entry in self.settings().host_paired)

    async def handle(self, stream) -> None:
        try:
            frame = wire.Frame.decode(await asyncio.wait_for(anext(aiter(stream)), 60))
        except Exception:
            await _close(stream)
            return
        settings = self.settings()
        peer_id = getattr(stream, "peer_id", "")
        head = frame.header
        if frame.kind != wire.HOST_KEEP or not settings.host:
            await _answer(stream, False, "This install is not a host.")
            return
        if not self.paired(peer_id):
            if not secrets.compare_digest(str(head.get("secret") or ""), settings.host_secret or "\0"):
                await _answer(stream, False, "That pairing code is not this host's, or it was replaced.")
                return
            settings.host_paired.append({
                "peer": peer_id, "name": str(head.get("name") or "")[:120], "at": time.time(),
            })
            self.save()
        invite = str(head.get("invite") or "")
        if not invite:
            await _answer(stream, True, name=self.name())
            return
        reason = await self.keep(invite, str(head.get("project") or ""))
        await _answer(stream, not reason, reason, name=self.name())


async def _answer(stream, ok: bool, reason: str = "", name: str = "") -> None:
    try:
        await stream.send(wire.host_kept(ok, reason, name))
    except Exception:
        pass
    await _close(stream)


async def _close(stream) -> None:
    try:
        await stream.close()
    except Exception:
        pass


async def ask(endpoint, address: str, secret: str, name: str,
              invite: str = "", project: str = "", timeout: float = ASK_TIMEOUT) -> dict:
    """The writer's side: one HOST_KEEP and its answer.

    Returns `ok`, `reason`, the host's `name` and its `peer` id, which is
    the key the connection proved, not anything the host claimed."""
    try:
        stream = await asyncio.wait_for(endpoint.dial(address), 30)
    except Exception as error:
        return {"ok": False, "reason": f"Could not reach the host: {error}", "name": "", "peer": ""}
    try:
        await stream.send(wire.host_keep(secret, name, invite, project))
        raw = await asyncio.wait_for(anext(aiter(stream)), timeout)
        frame = wire.Frame.decode(raw)
    except (Exception, asyncio.TimeoutError):
        await _close(stream)
        return {"ok": False, "reason": "The host did not answer.", "name": "", "peer": ""}
    await _close(stream)
    if frame.kind != wire.HOST_KEPT:
        reason = str(frame.header.get("reason") or "The host did not answer.")
        return {"ok": False, "reason": reason, "name": "", "peer": ""}
    head = frame.header
    return {
        "ok": bool(head.get("ok")), "reason": str(head.get("reason") or ""),
        "name": str(head.get("name") or ""), "peer": getattr(stream, "peer_id", ""),
    }

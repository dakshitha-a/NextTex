"""Other people's NextTex, and how a project comes to be shared with them.

There is no server in the middle and no owner.  A shared project is a set of
installs that each hold the whole thing -- the files, the history, the git
repository -- and agree about a document.  Any member may invite another; any
member may remove one; and the change gossips outward through the same
document everything else travels in.

## Being allowed in

`conn.remote_id()` is an ed25519 public key that the transport authenticated
during its own handshake.  So the check is one line, and it is the whole
model: is this key a member.

That leaves exactly one hole, and it is the one that matters, because a
brand-new invitee is *by definition* not a member yet.  So an invite is a
one-time secret: minted by a member, only its hash written into the document,
and handed over out of band along with a ticket for dialling them.  A
connection carrying a live secret for this share is admitted once, the secret
is burned, and the caller's authenticated key is written into the membership
-- from where every other peer learns it.

## Where the gate lives

Membership lives in the shared document, and the shared document is the thing
you have not synced yet.  Authorising against it directly has a bootstrap
hole with teeth: a joiner starts empty, and a peer that happened to be
offline when Carol was added would refuse Carol for ever.

So the member list is *mirrored* out of the document into `share.json` after
every sync, and the mirror is what an inbound connection is checked against.
It only ever grows more permissive as peers talk to each other, which is the
correct direction for a system with no authority in it.

## What removal is, honestly

Removing a member stops future connections.  It does not, and cannot, take
back the copy they already have -- they have the files, the history and very
likely a git remote.  The interface says so beside the button rather than
only in the documentation, because a control that looks like revocation and
is not is worse than no control.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import secrets
import time
from pathlib import Path

from pycrdt import Map, create_sync_message, handle_sync_message

from nexttex.atomic import write_atomically

from . import identity, transport, wire

# How long to wait before dialling a peer again, growing to a resting rate.
# The common failure is a laptop closing its lid, so the first few are quick.
BACKOFF = [1, 2, 4, 8, 15, 30, 60]

# An invite that is never used should not be usable for ever.
INVITE_TTL_SECONDS = 7 * 24 * 60 * 60


def _hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


class Share:
    """What this peer knows about a shared project, on its own disk.

    A plain file rather than part of the document, because it has to be
    readable *before* the document has been synced -- it is what says whether
    a project is shared at all, and it is the gate an inbound connection is
    checked against.
    """

    def __init__(self, root: Path) -> None:
        self.path = root / "share.json"
        self.share_id: str = ""
        self.members: dict[str, dict] = {}
        self.invites: dict[str, dict] = {}
        self.joined_at: float = 0.0
        self.load()

    def load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        self.share_id = str(data.get("share_id") or "")
        self.members = dict(data.get("members") or {})
        self.invites = dict(data.get("invites") or {})
        self.joined_at = float(data.get("joined_at") or 0.0)

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_atomically(self.path, json.dumps({
            "share_id": self.share_id,
            "members": self.members,
            "invites": self.invites,
            "joined_at": self.joined_at,
        }, indent=2), mode=0o600)

    @property
    def shared(self) -> bool:
        return bool(self.share_id)

    def allows(self, peer_id: str) -> bool:
        record = self.members.get(peer_id)
        return bool(record) and not record.get("removed_at")

    def mint_invite(self, by: str) -> str:
        secret = secrets.token_urlsafe(24)
        self.invites[_hash_secret(secret)] = {
            "created": time.time(), "by": by, "used_by": "",
        }
        self.save()
        return secret

    def redeem(self, secret: str) -> bool:
        """Spend an invite, if it is live. One use, and then never again."""
        record = self.invites.get(_hash_secret(secret))
        if record is None or record.get("used_by"):
            return False
        if time.time() - float(record.get("created") or 0) > INVITE_TTL_SECONDS:
            return False
        return True

    def burn(self, secret: str, peer_id: str) -> None:
        record = self.invites.get(_hash_secret(secret))
        if record is not None:
            record["used_by"] = peer_id
            self.save()


class PeerLink:
    """One connection to one other install."""

    def __init__(self, network: "PeerNetwork", stream, peer_id: str) -> None:
        self.network = network
        self.stream = stream
        self.peer_id = peer_id
        self.name = ""
        self.colour = ""
        self.address = ""
        self.alive = True
        #: Documents we have already opened the conversation about, so a
        #: manifest that changes twice does not re-offer everything twice.
        self.offered: set[str] = set()

    async def send(self, frame: bytes) -> None:
        if not self.alive:
            return
        try:
            await self.stream.send(frame)
        except Exception:
            self.alive = False

    async def send_documents(self) -> None:
        """Offer everything we have, and ask for everything we do not.

        A state vector each way, which is all a Yjs sync needs however long
        the two have been apart -- an hour or a fortnight is the same
        exchange, and this is why being offline needed no queue of its own.

        **Every text file the manifest names, not merely the ones this
        install happens to have open.**  A peer holds the whole project, not
        a working set: a joiner has nothing open at all, so a version of this
        that iterated the open documents asked for nothing and received an
        empty project while every other part of the handshake looked
        perfectly healthy.
        """
        store = self.network.store
        if "manifest" not in self.offered:
            self.offered.add("manifest")
            await self.send(wire.sync("manifest", create_sync_message(store.manifest)))

        for file_id, record in list(store.files.items()):
            doc_id = f"text/{file_id}"
            if doc_id in self.offered or record.get("kind") != "text":
                continue
            doc = store.document(doc_id)
            if doc is None:
                continue
            self.offered.add(doc_id)
            await self.send(wire.sync(doc_id, create_sync_message(doc)))

    async def run(self) -> None:
        try:
            async for raw in self.stream:
                try:
                    frame = wire.Frame.decode(raw)
                except ValueError:
                    # A peer speaking nonsense is a peer to stop talking to,
                    # not a reason to take the project down.
                    break
                await self.handle(frame)
        except Exception:
            pass
        finally:
            self.alive = False
            self.network.dropped(self)

    async def handle(self, frame: wire.Frame) -> None:
        store = self.network.store
        if frame.kind == wire.SYNC:
            doc_id = frame.header.get("doc", "")
            doc = store.document(doc_id)
            if doc is None:
                return
            # The payload is a complete y-protocols message, type byte and
            # all -- byte for byte what the browser's socket carries, which
            # is the point of having one codec. `handle_sync_message` wants
            # it without that byte, exactly as sync.py passes it.
            if not frame.payload or frame.payload[0] != 0:
                return
            self.network.applying = self
            try:
                reply = handle_sync_message(frame.payload[1:], doc)
            finally:
                self.network.applying = None
            if reply is not None:
                await self.send(wire.sync(doc_id, reply))
            if doc_id == "manifest":
                # The manifest is how a peer learns which files exist, so a
                # change to it is the moment to ask about the ones that were
                # not there a second ago.
                self.network.mirror_members()
                await self.send_documents()
        elif frame.kind == wire.AWARE:
            # Relayed to this install's own browsers, unread. See sync.py.
            doc_id = frame.header.get("doc", "")
            hub = self.network.hub
            if hub is not None:
                for connection in hub.rooms.get(doc_id, ()):
                    connection.send(frame.payload)
        elif frame.kind == wire.WELCOME:
            self.network.share.share_id = frame.header.get("share", "") or \
                self.network.share.share_id
            self.network.share.save()
            await self.send_documents()
        elif frame.kind == wire.DENIED:
            self.network.last_error = frame.header.get("reason", "refused")
            self.alive = False


class PeerNetwork:
    """This install's side of one shared project."""

    def __init__(self, store, hub=None, session=None) -> None:
        self.store = store
        self.hub = hub
        self.session = session
        self.share = Share(store.project.state_dir / "collab")
        self.transport: transport.Transport | None = None
        self.links: dict[str, PeerLink] = {}
        self.applying: PeerLink | None = None
        self.last_error = ""
        self._tasks: set[asyncio.Task] = set()
        self._closed = False
        self._me = ""

    # --- identity ---------------------------------------------------------

    @property
    def peer_id(self) -> str:
        if not self._me:
            self._me = identity.peer_id()
        return self._me

    def address(self) -> str:
        return self.transport.address() if self.transport else ""

    # --- starting ---------------------------------------------------------

    async def start(self) -> None:
        """Listen, and dial every member we know about."""
        if self._closed or self.transport is not None:
            return
        if not self.share.shared:
            return
        self.transport = self._make_transport()
        await self.transport.start(self._accept)
        self.store.listeners.append(self._document_changed)
        for peer_id in list(self.share.members):
            if peer_id != self.peer_id and self.share.allows(peer_id):
                self._spawn(self._keep_dialling(peer_id))

    def _make_transport(self) -> transport.Transport:
        if transport.wanted() == "loopback":
            return transport.LoopbackTransport(self.peer_id)
        from .iroh_transport import IrohTransport

        return IrohTransport(identity.secret_key())

    def _spawn(self, coroutine) -> None:
        task = asyncio.create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    # --- sharing and joining ---------------------------------------------

    def begin_sharing(self, name: str) -> None:
        """Turn a private project into a shared one, with us as its first
        member.  There is no owner in this: "first" carries no privileges
        and is not recorded as anything."""
        if self.share.shared:
            return
        self.share.share_id = secrets.token_hex(16)
        self.share.joined_at = time.time()
        self.share.members[self.peer_id] = {
            "name": name, "added_by": self.peer_id, "at": time.time(),
        }
        self.share.save()
        self._write_member(self.peer_id, name)

    def invite(self, name: str = "") -> str:
        """A single-use string for one other install."""
        if not self.share.shared:
            self.begin_sharing(name)
        secret = self.share.mint_invite(self.peer_id)
        return json.dumps({
            "v": 1,
            "share": self.share.share_id,
            "address": self.address(),
            "secret": secret,
        }, separators=(",", ":"))

    def _write_member(self, peer_id: str, name: str, colour: str = "") -> None:
        members = self.store.manifest.get("members", type=Map) \
            if "members" in self.store.manifest else None
        if members is None:
            self.store.manifest["members"] = members = Map()
        if peer_id in members:
            return
        members[peer_id] = Map({
            "name": name, "colour": colour,
            "added_by": self.peer_id, "at": time.time(),
        })

    def mirror_members(self) -> None:
        """Copy the document's membership into the file the gate reads.

        Only ever adds, or records a removal that the document itself
        carries.  A peer that has not heard about a new member yet simply has
        not heard yet; it must never conclude from its own silence that
        somebody was removed.
        """
        if "members" not in self.store.manifest:
            return
        members = self.store.manifest.get("members", type=Map)
        changed = False
        for peer_id, record in members.items():
            entry = dict(record)
            known = self.share.members.get(peer_id)
            if known != entry:
                self.share.members[peer_id] = entry
                changed = True
        if changed:
            self.share.save()

    def remove(self, peer_id: str) -> None:
        """Stop talking to a peer, and tell the others.

        Not revocation. They keep every byte they already have.
        """
        if "members" in self.store.manifest:
            members = self.store.manifest.get("members", type=Map)
            record = members.get(peer_id)
            if record is not None:
                record["removed_at"] = time.time()
                record["removed_by"] = self.peer_id
        entry = self.share.members.setdefault(peer_id, {})
        entry["removed_at"] = time.time()
        self.share.save()
        link = self.links.pop(peer_id, None)
        if link is not None:
            link.alive = False
            self._spawn(link.stream.close())

    async def join(self, invite: str, name: str) -> str:
        """Accept an invite: dial the peer who wrote it and ask to be let in.

        Returns "" on success, or a sentence saying why not.
        """
        try:
            payload = json.loads(invite)
            share_id = str(payload["share"])
            address = str(payload["address"])
            secret = str(payload["secret"])
        except Exception:
            return "That does not look like an invite."

        self.share.share_id = share_id
        self.share.joined_at = time.time()
        self.share.save()

        self.transport = self.transport or self._make_transport()
        await self.transport.start(self._accept)
        self.store.listeners.append(self._document_changed)
        try:
            stream = await self.transport.connect(address)
        except Exception as error:
            return f"Could not reach that peer: {error}"

        link = PeerLink(self, stream, getattr(stream, "peer_id", ""))
        self.links[link.peer_id] = link
        self._spawn(link.run())
        await link.send(wire.hello(
            share_id, name, "", self.address(), secret,
        ))
        return ""

    # --- connections ------------------------------------------------------

    async def _accept(self, stream) -> None:
        """Somebody dialled us."""
        peer_id = getattr(stream, "peer_id", "")
        link = PeerLink(self, stream, peer_id)
        try:
            first = await anext(aiter(stream))
        except Exception:
            return
        try:
            frame = wire.Frame.decode(first)
        except ValueError:
            await stream.close()
            return
        if frame.kind != wire.HELLO:
            await link.send(wire.denied("say hello first"))
            await stream.close()
            return

        if frame.header.get("share") != self.share.share_id:
            await link.send(wire.denied("that is not this project"))
            await stream.close()
            return

        secret = frame.header.get("secret") or ""
        if not self.share.allows(peer_id):
            # Not a member. The only way in is a live invite -- and its
            # authenticated caller, not whatever the caller claims to be, is
            # what gets written down.
            if not (secret and self.share.redeem(secret)):
                await link.send(wire.denied("not a member of this project"))
                await stream.close()
                return
            self.share.burn(secret, peer_id)
            self.share.members[peer_id] = {
                "name": frame.header.get("name", ""),
                "added_by": self.peer_id,
                "at": time.time(),
            }
            self.share.save()
            self._write_member(peer_id, frame.header.get("name", ""),
                               frame.header.get("colour", ""))

        link.name = frame.header.get("name", "")
        link.colour = frame.header.get("colour", "")
        link.address = frame.header.get("address", "")
        self.links[peer_id] = link
        self._spawn(link.run())
        await link.send(wire.welcome(self.share.share_id, self.share.members))
        await link.send_documents()

    async def _keep_dialling(self, peer_id: str) -> None:
        """Stay connected to one peer, however often it goes away."""
        attempt = 0
        while not self._closed and self.share.allows(peer_id):
            if peer_id in self.links and self.links[peer_id].alive:
                await asyncio.sleep(2)
                continue
            address = (self.share.members.get(peer_id) or {}).get("address") or peer_id
            try:
                stream = await self.transport.connect(address)
            except Exception:
                wait = BACKOFF[min(attempt, len(BACKOFF) - 1)]
                attempt += 1
                await asyncio.sleep(wait)
                continue
            attempt = 0
            link = PeerLink(self, stream, peer_id)
            self.links[peer_id] = link
            self._spawn(link.run())
            name = (self.share.members.get(self.peer_id) or {}).get("name", "")
            await link.send(wire.hello(
                self.share.share_id, name, "", self.address(),
            ))
            await link.send_documents()
            await asyncio.sleep(2)

    def dropped(self, link: PeerLink) -> None:
        if self.links.get(link.peer_id) is link:
            self.links.pop(link.peer_id, None)

    # --- documents --------------------------------------------------------

    def _document_changed(self, doc_id: str, update: bytes) -> None:
        """Pass a local change on to every peer but the one it came from.

        Runs inside the transaction, so it queues a send rather than doing
        one -- reading the document here is what "Already mutably borrowed"
        is made of.
        """
        from pycrdt import create_update_message

        message = wire.sync(doc_id, create_update_message(update))
        source = self.applying
        for link in list(self.links.values()):
            if link is source or not link.alive:
                continue
            self._spawn(link.send(message))

    def state(self) -> dict:
        """What the interface shows about this project's peers."""
        return {
            "shared": self.share.shared,
            "shareId": self.share.share_id,
            "me": self.peer_id,
            "address": self.address(),
            "available": transport.available(),
            "members": [
                {
                    "peer": peer_id,
                    "name": record.get("name", ""),
                    "connected": peer_id in self.links and self.links[peer_id].alive,
                    "removed": bool(record.get("removed_at")),
                }
                for peer_id, record in self.share.members.items()
            ],
            "error": self.last_error,
        }

    async def close(self) -> None:
        self._closed = True
        if self._document_changed in self.store.listeners:
            self.store.listeners.remove(self._document_changed)
        for link in list(self.links.values()):
            link.alive = False
            with contextlib.suppress(Exception):
                await link.stream.close()
        self.links.clear()
        for task in list(self._tasks):
            task.cancel()
        if self.transport is not None:
            with contextlib.suppress(Exception):
                await self.transport.close()
            self.transport = None

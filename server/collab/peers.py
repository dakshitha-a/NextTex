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
import base64
import contextlib
import hashlib
import json
import logging
import re
import secrets
import time
from pathlib import Path

from pycrdt import Map, create_sync_message, handle_sync_message

from nexttex.atomic import write_atomically

from . import history_sync, identity, transport, wire

log = logging.getLogger("nexttex.collab")

# How long to wait before dialling a peer again, growing to a resting rate.
# The common failure is a laptop closing its lid, so the first few are quick.
BACKOFF = [1, 2, 4, 8, 15, 30, 60]

# An invite that is never used should not be usable for ever.
INVITE_TTL_SECONDS = 7 * 24 * 60 * 60

# How many frames may be waiting for one peer. Past this the peer is not
# keeping up, and closing the connection is better than dropping updates
# into it -- a peer that quietly stops receiving looks like a peer that is
# up to date. Same reasoning as the browser event stream's.
OUTBOX = 2048


# A content address is sixty-four hex characters and nothing else. Checked
# because it arrives from another machine and is joined onto a path.
_IS_SHA = re.compile(r"[0-9a-f]{64}")

# What an invite looks like, so a person pasting one into the wrong box is
# told which box it belongs in rather than being told it is malformed.
INVITE_PREFIX = "nexttex-share-v1-"


async def _quietly_close(stream) -> None:
    try:
        await stream.close()
    except Exception:
        pass


def _hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _wrap(payload: dict) -> str:
    """An invite's contents, as the one token that gets pasted."""
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return INVITE_PREFIX + base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unwrap(invite: str) -> dict:
    """The contents of an invite.

    Tolerant of what happens to a string on its way through a chat window:
    surrounding whitespace, a line break in the middle, and the padding that
    base64 has and this does not.
    """
    text = "".join(invite.split())
    if text.startswith(INVITE_PREFIX):
        text = text[len(INVITE_PREFIX):]
    raw = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    payload = json.loads(raw.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("an invite is an object")
    return payload


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
        #: What is waiting to go to this peer. A queue rather than a task
        #: each, because `_document_changed` runs per keystroke per peer: a
        #: peer that is connected but not draining -- QUIC flow control, a
        #: closed lid -- grew an unbounded pile of pending sends for as long
        #: as somebody was typing. Full means this connection is not keeping
        #: up, and the same answer as the browser's: close it rather than
        #: quietly dropping updates.
        self.outbox: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=OUTBOX)
        self._pump: asyncio.Task | None = None
        #: Documents we have already opened the conversation about, so a
        #: manifest that changes twice does not re-offer everything twice.
        self.offered: set[str] = set()
        #: Blobs asked for and not yet answered, so a figure referenced by
        #: five versions is fetched once.
        self.wanted: set[str] = set()

    def enqueue(self, frame: bytes) -> None:
        """Hand a frame to this peer without waiting for it.

        Called from inside a document transaction, so it must not block and
        must not await.
        """
        if not self.alive:
            return
        if self._pump is None:
            try:
                self._pump = asyncio.create_task(self._drain())
            except RuntimeError:
                # No loop. Reachable only from a caller driving the store
                # directly, and worth catching rather than letting it out:
                # this runs inside a document transaction, where an
                # exception surfaces from underneath pycrdt with a message
                # about neither the peer nor the caller.
                return
        try:
            self.outbox.put_nowait(frame)
        except asyncio.QueueFull:
            self.alive = False
            self.network.dropped(self)

    async def _drain(self) -> None:
        while True:
            frame = await self.outbox.get()
            if frame is None or not self.alive:
                return
            try:
                await self.stream.send(frame)
            except Exception:
                self.alive = False
                return

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
            # And what this file used to say. Cheap to ask, and it is the
            # difference between joining a project and joining a project
            # with its past.
            await self.send(wire.hist_want(
                file_id, self.peer_id,
                self.network.cursors.at(self.peer_id, file_id),
            ))

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
            with contextlib.suppress(asyncio.QueueFull):
                self.outbox.put_nowait(None)
            if self._pump is not None:
                self._pump.cancel()
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
            hub = self.network.hub
            if hub is not None:
                hub.from_peer(frame.header.get("doc", ""), frame.payload)
        elif frame.kind == wire.WELCOME:
            # Only ever *learned*, never overwritten.
            #
            # A joiner has no share id until somebody welcomes them, and this
            # is where they get it.  But it took the value from every WELCOME
            # that arrived, and `_accept` checks incoming peers against it --
            # so any admitted member could send a different one and cut this
            # install off from every other member at once, without touching
            # the member list this line is careful about just below.
            #
            # Filling a blank is the case that exists; replacing a value we
            # already hold is the case that does not.
            if not self.network.share.share_id:
                self.network.share.share_id = frame.header.get("share", "")
            elif frame.header.get("share", "") not in ("", self.network.share.share_id):
                log.warning(
                    "a peer sent a different share id; keeping the one we have"
                )
            for peer_id, record in (frame.header.get("members") or {}).items():
                if peer_id not in self.network.share.members:
                    self.network.share.members[peer_id] = record
            self.network.share.save()
            # And keep in touch with everybody else they know about, not only
            # the one who let us in: a project with three people in it should
            # not stop working because the second one closed their laptop.
            for peer_id in list(self.network.share.members):
                if peer_id != self.network.peer_id and peer_id != self.peer_id:
                    self.network.dial_later(peer_id)
            await self.send_documents()
        elif frame.kind == wire.HIST_WANT:
            await self._send_history(frame)
        elif frame.kind == wire.HIST_GIVE:
            await self._take_history(frame)
        elif frame.kind == wire.BLOB_WANT:
            await self._send_blob(frame.header.get("sha", ""))
        elif frame.kind == wire.BLOB_HAVE:
            self.network.take_blob(frame.header.get("sha", ""), frame.payload)
        elif frame.kind == wire.DENIED:
            self.network.last_error = frame.header.get("reason", "refused")
            self.alive = False

    async def _send_history(self, frame: wire.Frame) -> None:
        """Our own lines for a file, from where they left off."""
        network = self.network
        history = network.history()
        if history is None:
            return
        file_id = frame.header.get("file", "")
        relative = network.store.path_for(file_id)
        if not relative:
            return
        after = int(frame.header.get("cursor") or 0)
        lines, reached = history_sync.mine(
            history, relative, network.peer_id, after,
        )
        if lines:
            await self.send(wire.hist_give(
                file_id, network.peer_id, reached, lines,
            ))

    async def _take_history(self, frame: wire.Frame) -> None:
        network = self.network
        history = network.history()
        if history is None:
            return
        file_id = frame.header.get("file", "")
        relative = network.store.path_for(file_id)
        if not relative:
            return
        lines = frame.header.get("lines") or []
        history_sync.absorb(history, relative, lines)
        network.cursors.advance(
            self.peer_id, file_id, int(frame.header.get("cursor") or 0),
        )
        # There may be more where those came from.
        if len(lines) >= history_sync.BATCH:
            await self.send(wire.hist_want(
                file_id, self.peer_id,
                network.cursors.at(self.peer_id, file_id),
            ))

    async def _send_blob(self, sha: str) -> None:
        history = self.network.history()
        if history is None or not _IS_SHA.fullmatch(sha or ""):
            # `BlobStore.path_for` joins this straight onto a directory, so
            # an unchecked value from a peer is a path traversal -- a member
            # could ask for anything on the disk that happens to be
            # zlib-compressed.
            return
        data = history.blobs.get(sha)
        if data is not None:
            await self.send(wire.blob_have(sha, data))

    async def want_blob(self, sha: str) -> None:
        if sha in self.wanted:
            return
        self.wanted.add(sha)
        await self.send(wire.blob_want(sha))


class PeerNetwork:
    """This install's side of one shared project."""

    def __init__(self, store, hub=None, session=None) -> None:
        self.store = store
        self.hub = hub
        self.session = session
        self.share = Share(store.project.state_dir / "collab")
        self.cursors = history_sync.Cursors(store.project.state_dir / "collab")
        self.transport: transport.Transport | None = None
        self.links: dict[str, PeerLink] = {}
        self.applying: PeerLink | None = None
        self.last_error = ""
        self._tasks: set[asyncio.Task] = set()
        #: Peers we already have a dialling loop for, so learning about one
        #: twice does not start two.
        self._dialling: set[str] = set()
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
        if self.hub is not None:
            # Cursors, outward. Without this the collaborator strip and the
            # remote carets only ever showed other *tabs on this machine* --
            # so the feature appeared to work in every test that used two
            # browsers and did nothing at all between two people, failing as
            # an empty strip that reads as "nobody else is here".
            self.hub.on_awareness = self._awareness_changed
        for peer_id in list(self.share.members):
            if peer_id != self.peer_id:
                self.dial_later(peer_id)

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
        """A single-use string for one other install.

        One opaque token rather than the JSON it wraps.  It is pasted into a
        chat window or an email, where the JSON version was both mangled by
        anything that reflows text and needlessly legible -- a secret printed
        in the clear beside a label saying "secret" invites somebody to read
        it over a shoulder.  No colons, because too many clients turn
        anything with one into a link.
        """
        if not self.share.shared:
            self.begin_sharing(name)
        secret = self.share.mint_invite(self.peer_id)
        return _wrap({
            "v": 1,
            "share": self.share.share_id,
            "address": self.address(),
            "secret": secret,
        })

    def _write_member(self, peer_id: str, name: str, colour: str = "") -> None:
        members = self.store.manifest.get("members", type=Map) \
            if "members" in self.store.manifest else None
        if members is None:
            self.store.manifest["members"] = members = Map()

        existing = members.get(peer_id)
        if existing is not None and not existing.get("removed_at"):
            return
        if existing is not None:
            # Somebody who was removed and has now been invited back. Leaving
            # the tombstone in place let them in once and then locked them
            # out again: the next manifest sync copied `removed_at` back into
            # the file the gate reads, and there was no way to undo that from
            # the interface.
            existing["removed_at"] = None
            existing["removed_by"] = None
            existing["at"] = time.time()
            if name:
                existing["name"] = name
            return

        members[peer_id] = Map({
            "name": name, "colour": colour,
            "added_by": self.peer_id, "at": time.time(),
        })

    def note_address(self, peer_id: str, address: str, name: str = "") -> None:
        """Remember how a peer was reachable when it last called.

        An address goes stale and a public key does not, so this is a
        shortcut rather than the truth: iroh can find a peer by key alone,
        and does, but a remembered ticket makes the first attempt after a
        restart direct instead of a discovery round trip.
        """
        if not address:
            return
        entry = self.share.members.setdefault(peer_id, {"at": time.time()})
        if entry.get("address") == address and (not name or entry.get("name") == name):
            return
        entry["address"] = address
        if name:
            entry.setdefault("name", name)
        self.share.save()

    def dial_later(self, peer_id: str) -> None:
        """Start keeping in touch with a peer, if we are not already."""
        if self._closed or peer_id == self.peer_id:
            return
        if peer_id in self._dialling or not self.share.allows(peer_id):
            return
        self._dialling.add(peer_id)
        self._spawn(self._keep_dialling(peer_id))

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
            entry = {k: v for k, v in dict(record).items() if v is not None}
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
            payload = _unwrap(invite)
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
        if self.hub is not None:
            self.hub.on_awareness = self._awareness_changed
        try:
            stream = await self.transport.connect(address)
        except Exception as error:
            return f"Could not reach that peer: {error}"

        link = PeerLink(self, stream, getattr(stream, "peer_id", ""))
        self.adopt_link(link)
        self._spawn(link.run())
        await link.send(wire.hello(
            share_id, name, "", self.address(), secret,
        ))
        # And keep it up afterwards. Without this a joiner that lost its
        # first connection sat there until the server was restarted: the
        # dialling loop is only started for peers that were already members
        # when `start()` ran, and a joiner has none.
        self.note_address(link.peer_id, address)
        self.dial_later(link.peer_id)
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
        self.note_address(peer_id, link.address, link.name)
        self.adopt_link(link)
        self._spawn(link.run())
        await link.send(wire.welcome(self.share.share_id, self.share.members))
        await link.send_documents()

    async def _keep_dialling(self, peer_id: str) -> None:
        """Stay connected to one peer, however often it goes away."""
        try:
            await self._dial_until_told_otherwise(peer_id)
        finally:
            self._dialling.discard(peer_id)

    async def _dial_until_told_otherwise(self, peer_id: str) -> None:
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
            self.adopt_link(link)
            self._spawn(link.run())
            name = (self.share.members.get(self.peer_id) or {}).get("name", "")
            await link.send(wire.hello(
                self.share.share_id, name, "", self.address(),
            ))
            await link.send_documents()
            await asyncio.sleep(2)

    def adopt_link(self, link: PeerLink) -> None:
        """Take a new connection to a peer, closing any it replaces.

        Two installs starting at the same time dial each other at the same
        time, which is the ordinary shape rather than a rare one -- and
        assigning straight into the dictionary left the loser's `run()` loop
        going round for ever on a stream nothing would ever close. `dropped`
        could not clean it up either, because it only forgets a link that is
        still the current one.
        """
        existing = self.links.get(link.peer_id)
        if existing is not None and existing is not link:
            existing.alive = False
            self._spawn(_quietly_close(existing.stream))
        self.links[link.peer_id] = link

    def dropped(self, link: PeerLink) -> None:
        if self.links.get(link.peer_id) is link:
            self.links.pop(link.peer_id, None)

    # --- documents --------------------------------------------------------

    def _awareness_changed(self, doc_id: str, message: bytes) -> None:
        """A cursor moved here; tell the other installs.

        Relayed as the bytes it arrived as. The server has no business
        knowing what is inside an awareness frame -- what it needs about
        where the writer is looking comes from `session.presence` instead.
        """
        frame = wire.aware(doc_id, message)
        for link in list(self.links.values()):
            if link.alive:
                link.enqueue(frame)

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
            link.enqueue(message)

    def history(self):
        """This project's version history, if a session is holding one.

        None when a project is being joined: there is no session yet, and a
        joiner has nothing to send anybody.
        """
        return getattr(self.session, "history", None)

    def take_blob(self, sha: str, data: bytes) -> None:
        """Store a blob a peer sent, if it is really the one asked for."""
        history = self.history()
        if history is None or not sha or not data:
            return
        import hashlib

        # Checked rather than trusted. A content-addressed store whose
        # contents do not match their names is worse than an empty one.
        if hashlib.sha256(data).hexdigest() != sha:
            return
        history.blobs.put(data)
        for link in self.links.values():
            link.wanted.discard(sha)

    async def fetch_blob(self, sha: str) -> None:
        """Ask whoever is connected for a blob this install does not have."""
        for link in list(self.links.values()):
            if link.alive:
                await link.want_blob(sha)

    def state(self) -> dict:
        """What the interface shows about this project's peers."""
        return {
            "shared": self.share.shared,
            "shareId": self.share.share_id,
            "me": self.peer_id,
            # Whether this install is in the share it is holding the record
            # of.  It is not, on a machine the project was copied to: the
            # share travels inside the project as `.nexttex/collab/share.json`
            # and the identity does not, because it lives in the install's own
            # state directory.  Every member then shows as not connected and
            # the honest reading of that is "nobody is here", which is a
            # different thing from "they will not let you in" and sends the
            # writer looking for the wrong problem.
            "member": bool(self.share.shared and self.peer_id in self.share.members),
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
        if self.hub is not None and self.hub.on_awareness is self._awareness_changed:
            self.hub.on_awareness = None
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

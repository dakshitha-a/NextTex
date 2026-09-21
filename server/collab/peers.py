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

The removed member is told, once, by the same tombstone: it is the last
thing their link carries before it is closed, and if that link was down it
reaches them through whichever member they next sync with.  Their install
then stops dialling and stops listening, and offers to keep the copy as a
project of its own.  A refusal at the door is deliberately *not* the same
signal: a peer refuses from its own copy of the member list, which can be
behind, and one stale peer must not be able to put a member out for good.
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
from nexttex.history import now_ms
from nexttex.project import shares_home

from . import history_sync, identity, transport, wire
from .store import ARRIVED_LIMIT, _WELL_FORMED_ID as _WELL_FORMED_ID_RE

log = logging.getLogger("nexttex.collab")

# How long to wait before dialling a peer again, growing to a resting rate.
# The common failure is a laptop closing its lid, so the first few are quick.
BACKOFF = [1, 2, 4, 8, 15, 30, 60]

#: The heartbeat.  A link with nothing to send says so every PING_EVERY
#: seconds, and a link that has heard nothing at all for SILENCE_LIMIT
#: seconds is dropped, at this layer rather than in the transport, because
#: the loopback transport never times out and it is the one the test tier
#: can sever without closing.  Three pings fit in one limit, so a single
#: lost frame is not a dropped link.  Class attributes on PeerLink below
#: mirror these so a test can shorten them.
PING_EVERY = 20.0
SILENCE_LIMIT = 60.0
#: How long an ask for a blob or a file stands before it is asked again.
#: A peer that did not have the bytes when asked is asked once more after
#: this, rather than never; a peer that answers with a miss clears the
#: ask so the next request goes out at once.
WANT_AGAIN = 30.0

#: How long after a version is written before the other installs are told.
#: An editing burst is already one version, so there is nothing to say more
#: often than this.
HISTORY_NUDGE_SECONDS = 2.0

#: A collaborator's version this new, or one they named, has its contents
#: fetched as the line arrives rather than when somebody clicks it.
EAGER_BLOB_HOURS = 24.0

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


#: What a share id looks like: `token_hex(16)` from `begin_sharing`.  A
#: joiner takes its id from an invite, so it is checked against this before
#: it names a file anywhere.
WELL_FORMED_SHARE_ID = re.compile(r"[0-9a-f]{8,64}")


class Share:
    """What this peer knows about a shared project, on its own disk.

    A plain file rather than part of the document, because it has to be
    readable *before* the document has been synced -- it is what says whether
    a project is shared at all, and it is the gate an inbound connection is
    checked against.

    Kept twice.  `share.json` lives inside the project, where the store and
    the gate read it.  A *card* with the same members and no invites lives
    in the install's own state directory, keyed by share id, because the
    one moment somebody most needs to know whom to dial is after the
    project folder is gone, and everything the install knew about the
    share used to go with it.
    """

    def __init__(self, root: Path, card_dir: Path | None = None,
                 project_root: Path | None = None) -> None:
        self.path = root / "share.json"
        self.card_dir = card_dir
        self.project_root = project_root
        self.share_id: str = ""
        self.members: dict[str, dict] = {}
        self.invites: dict[str, dict] = {}
        self.joined_at: float = 0.0
        self.load()

    @property
    def card_path(self) -> Path | None:
        if self.card_dir is None or not WELL_FORMED_SHARE_ID.fullmatch(self.share_id):
            return None
        return self.card_dir / f"{self.share_id}.json"

    def save_card(self) -> None:
        card = self.card_path
        if card is None:
            return
        try:
            write_atomically(card, json.dumps({
                "share_id": self.share_id,
                "members": self.members,
                "joined_at": self.joined_at,
                "path": str(self.project_root) if self.project_root else "",
            }, indent=2), mode=0o600)
        except OSError:
            log.warning("could not write the share card for %s", self.share_id)

    def drop_card(self) -> None:
        card = self.card_path
        if card is not None:
            with contextlib.suppress(OSError):
                card.unlink()

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
        self.save_card()

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

    #: The heartbeat's rates, per class so a test can shorten them.
    ping_every = PING_EVERY
    silence_limit = SILENCE_LIMIT

    def __init__(self, network: "PeerNetwork", stream, peer_id: str,
                 outbound: bool = False) -> None:
        self.network = network
        self.stream = stream
        self.peer_id = peer_id
        #: Whether this install dialled the connection, as opposed to
        #: accepting it.  What `adopt_link` decides between two live links
        #: to one peer by.
        self.outbound = outbound
        self.name = ""
        self.colour = ""
        self.address = ""
        self.alive = True
        #: Set when the other end answered this link with a DENIED.  Read
        #: by the dial loop, which backs off from a peer that refuses us
        #: rather than dialling it again two seconds later.
        self.denied = False
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
        #: Blobs asked for and not yet answered, each with when it was
        #: asked, so a figure referenced by five versions is fetched once
        #: and an ask that was never answered is repeated after a while.
        self.wanted: dict[str, float] = {}
        #: Files asked for by manifest id, the same way.
        self.wanted_files: dict[str, float] = {}
        #: When something last went out, for the heartbeat's silence.
        self._last_sent = 0.0
        self._pinger: asyncio.Task | None = None

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
            try:
                if frame is None or not self.alive:
                    return
                try:
                    await self.stream.send(frame)
                    self._last_sent = asyncio.get_running_loop().time()
                except Exception:
                    self.alive = False
                    return
            finally:
                self.outbox.task_done()

    async def drained(self, timeout: float = 2.0) -> bool:
        """Wait until everything queued for this peer has been sent.

        For the two moments a queued frame matters more than the link:
        removing a peer, whose tombstone is the last thing they should hear
        from us, and leaving, where our own is.  Bounded, because a peer
        that is not reading is exactly the peer this may be waiting on.
        """
        if self._pump is None or not self.alive:
            return self.outbox.empty()
        try:
            await asyncio.wait_for(self.outbox.join(), timeout)
        except asyncio.TimeoutError:
            return False
        return True

    async def send(self, frame: bytes) -> None:
        if not self.alive:
            return
        try:
            await self.stream.send(frame)
            self._last_sent = asyncio.get_running_loop().time()
        except Exception:
            self.alive = False

    def _due(self, table: dict[str, float], key: str) -> bool:
        """Whether an ask should go out now, and note it if so.  An ask
        younger than WANT_AGAIN stands; an older one is made again."""
        now = asyncio.get_running_loop().time()
        if now - table.get(key, -WANT_AGAIN) < WANT_AGAIN:
            return False
        table[key] = now
        return True

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

        # And what those files used to say.  Cheap to ask, and it is the
        # difference between joining a project and joining a project with
        # its past.
        #
        # **Every file the manifest names, not only the text ones.**  This
        # ask used to sit inside the loop above, behind its `kind != "text"`
        # guard, so a figure's past was never asked for and never offered.
        # That went unnoticed until figures were given a viewer, version
        # viewing and a clear-history button of their own, all of which
        # assume it travels.  Trashed records included: a deletion is a
        # version, and it is one that is never thinned away.
        for file_id in list(store.files):
            asked = f"hist/{file_id}"
            if asked in self.offered:
                continue
            self.offered.add(asked)
            await self.send(wire.hist_want(
                file_id, self.peer_id, self.network.marks.since(file_id),
            ))

        await self.want_files()

    async def want_files(self) -> None:
        """Ask for every binary the manifest names that this disk lacks.

        A joiner got a manifest entry for `figures/plot.png` and no file:
        the text path syncs documents and the history path syncs a
        figure's past, and nothing delivered its bytes.  One ask per file,
        aged like a blob ask so a peer that never answers is asked again
        after a while and not on every manifest sync; none while the parked
        bytes have reached their bound, and none for a path the join
        summary marks as one that will not be written.
        """
        store = self.network.store
        if store.arrived_bytes() >= ARRIVED_LIMIT:
            return
        for file_id, record in list(store.files.items()):
            if record.get("kind") != "blob" or record.get("trashed"):
                continue
            size = int(record.get("size") or 0)
            if not 0 < size <= wire.MAX_FRAME:
                continue
            relative = str(record.get("path") or "")
            try:
                target = store.project.resolve_for_write(relative)
            except (PermissionError, OSError, ValueError):
                continue
            if target.exists() or file_id in store.arrived:
                continue
            if self._due(self.wanted_files, file_id):
                await self.send(wire.file_want(file_id))

    async def run(self) -> None:
        # Every frame is waited for under the silence limit, and a link
        # that keeps quiet for that long is dropped here.  The ping task
        # is what keeps a healthy idle link under the limit; a peer that
        # sends nothing else for an hour still says so three times a
        # minute, and a path that stops carrying packets without closing,
        # which is what the loopback's sever stages and what a QUIC path
        # that has gone quiet looks like, ends in the same finally as a
        # closed stream does.
        messages = aiter(self.stream)
        self._pinger = asyncio.create_task(self._keep_pinging())
        try:
            while True:
                try:
                    raw = await asyncio.wait_for(anext(messages), self.silence_limit)
                except (StopAsyncIteration, asyncio.TimeoutError):
                    break
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
            if self._pinger is not None:
                self._pinger.cancel()
            with contextlib.suppress(asyncio.QueueFull):
                self.outbox.put_nowait(None)
            if self._pump is not None:
                self._pump.cancel()
            self.network.dropped(self)

    async def _keep_pinging(self) -> None:
        """Say something after a stretch of sending nothing."""
        loop = asyncio.get_running_loop()
        while self.alive:
            await asyncio.sleep(self.ping_every)
            if not self.alive:
                return
            if loop.time() - self._last_sent >= self.ping_every:
                await self.send(wire.ping())

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
            store.applying_remote = True
            try:
                reply = handle_sync_message(frame.payload[1:], doc)
            finally:
                self.network.applying = None
                store.applying_remote = False
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
            offered_id = str(frame.header.get("share", ""))
            if not self.network.share.share_id:
                if WELL_FORMED_SHARE_ID.fullmatch(offered_id):
                    self.network.share.share_id = offered_id
            elif frame.header.get("share", "") not in ("", self.network.share.share_id):
                log.warning(
                    "a peer sent a different share id; keeping the one we have"
                )
            # Somebody let us in, so whatever the last refusal said is
            # no longer the state of things.
            self.network.last_error = ""
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
        elif frame.kind == wire.HIST_NEW:
            # Somebody wrote something.  History used to be asked for once,
            # when a connection opened, and never again -- so two people
            # working together for a week watched each other type
            # continuously and saw one another's versions only when a laptop
            # closed and the link was rebuilt.
            new_file = frame.header.get("file", "")
            if self.network.store.path_for(new_file):
                await self.send(wire.hist_want(
                    new_file, self.peer_id,
                    self.network.marks.since(new_file),
                ))
        elif frame.kind == wire.BLOB_WANT:
            await self._send_blob(frame.header.get("sha", ""))
        elif frame.kind == wire.BLOB_HAVE:
            self.network.take_blob(frame.header.get("sha", ""), frame.payload)
        elif frame.kind == wire.BLOB_MISS:
            # The peer has no such bytes.  Forgetting the ask is what lets
            # the next request for this version go out at once, to this
            # peer or another, rather than after WANT_AGAIN.
            self.wanted.pop(str(frame.header.get("sha", "")), None)
        elif frame.kind == wire.PING:
            # The frame's arrival was the whole message: it reset the
            # silence deadline in `run`.
            return
        elif frame.kind == wire.FILE_WANT:
            await self._send_file(str(frame.header.get("id", "")))
        elif frame.kind == wire.FILE_HAVE:
            self.network.take_file(
                str(frame.header.get("id", "")), str(frame.header.get("path", "")),
                frame.payload,
            )
        elif frame.kind == wire.FILE_MISS:
            # Not forgotten, unlike a blob miss: the file ask is automatic
            # on every manifest sync, and forgetting it would re-ask a
            # sender whose record is there and whose file is not, once per
            # sync.  Refreshed instead, so WANT_AGAIN governs the retry.
            file_id = str(frame.header.get("id", ""))
            if file_id in self.wanted_files:
                self.wanted_files[file_id] = asyncio.get_running_loop().time()
        elif frame.kind == wire.DENIED:
            # One peer's opinion, from its own copy of the member list,
            # which may be behind: a restored backup, or a peer that was
            # offline when we were added.  So this is not taken as being
            # removed; that is what the tombstone in the manifest says,
            # and it arrives through the sync.  This peer is backed off
            # from, and the reason is kept for the interface.
            self.network.last_error = frame.header.get("reason", "refused")
            self.denied = True
            self.alive = False

    async def _send_history(self, frame: wire.Frame) -> None:
        """What we hold for a file, from where this peer has got to.

        What we hold, not what we wrote.  Two collaborators in different
        time zones are rarely online at the same moment, and if nobody
        passes on what they hold for somebody else then the two of them
        never exchange a single version, however long the project runs.
        """
        network = self.network
        history = network.history()
        if history is None:
            return
        file_id = str(frame.header.get("file", ""))
        # The wire speaks in file ids and so does the history now; the
        # path is only checked to be one the manifest holds, so a peer
        # cannot read a log for an id nobody shares.
        if not _WELL_FORMED_ID_RE.fullmatch(file_id) or not network.store.path_for(file_id):
            return

        since = frame.header.get("since")
        if not isinstance(since, dict):
            # An install from before per-author marks.  It reads what comes
            # back with `int(...)`, so answering in the new shape would take
            # its link down.  Answered in the old one instead, which sends
            # only our own lines and counts into a list thinning shortens:
            # the defect this was rewritten to fix, and there is no better
            # answer to that question than the question allows.
            lines, reached = await asyncio.to_thread(
                history_sync.mine, history, file_id, network.peer_id,
                int(frame.header.get("cursor") or 0),
            )
            if lines:
                await self.send(wire.hist_give_by_index(
                    file_id, network.peer_id, reached, lines,
                ))
            return

        floors = {
            str(author): float(at)
            for author, at in since.items()
            if isinstance(at, (int, float))
        }
        lines, reached = await asyncio.to_thread(
            history_sync.offer, history, file_id,
            network.peer_id, self.peer_id, floors,
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
        file_id = str(frame.header.get("file", ""))
        relative = network.store.path_for(file_id) if _WELL_FORMED_ID_RE.fullmatch(file_id) else ""
        if not relative:
            return
        lines = frame.header.get("lines") or []
        # Off the loop: absorbing takes the history's lock and rewrites a
        # whole log, at up to a batch of records a frame.  Into the log
        # keyed by the id the wire named, which is the file's own whatever
        # it is called on either disk; the path is for the map.
        added = await asyncio.to_thread(
            history.absorb_into, file_id, relative, lines, me=network.peer_id,
        )
        await network.fetch_recent(added)

        reached = frame.header.get("reached")
        if not isinstance(reached, dict):
            # An install that answered in the old shape, counting positions
            # into its own list.  There is nothing here a mark can be moved
            # to, so this is one batch and no more: asking again would fetch
            # the same batch for ever.
            return
        moved = False
        for author, at in reached.items():
            if isinstance(at, (int, float)):
                moved = network.marks.advance(
                    str(author), file_id, float(at),
                ) or moved
        if moved:
            network.save_marks_soon()
        # There may be more where those came from -- but only if something
        # actually moved.  A peer answering with what we already hold is
        # otherwise a loop with no end to it.
        if moved and len(lines) >= history_sync.BATCH:
            await self.send(wire.hist_want(
                file_id, self.peer_id, network.marks.since(file_id),
            ))

    async def _send_blob(self, sha: str) -> None:
        if not _IS_SHA.fullmatch(sha or ""):
            # `BlobStore.path_for` joins this straight onto a directory, so
            # an unchecked value from a peer is a path traversal -- a member
            # could ask for anything on the disk that happens to be
            # zlib-compressed.
            return
        history = self.network.history()
        data = history.blobs.get(sha) if history is not None else None
        if data is not None:
            await self.send(wire.blob_have(sha, data))
        else:
            # Said rather than left silent.  A peer asked while it did not
            # have the bytes used to say nothing, and the asker, holding
            # the ask for ever, never asked again: the version stayed
            # unopenable.
            await self.send(wire.blob_miss(sha))

    async def want_blob(self, sha: str) -> None:
        if self._due(self.wanted, sha):
            await self.send(wire.blob_want(sha))

    async def _send_file(self, file_id: str) -> None:
        """A binary the manifest names, as this disk holds it, or a miss."""
        store = self.network.store
        record = store.files.get(file_id) if _WELL_FORMED_ID_RE.fullmatch(file_id or "") else None
        if record is None or record.get("kind") != "blob" or record.get("trashed"):
            await self.send(wire.file_miss(file_id))
            return
        relative = str(record.get("path") or "")
        try:
            target = store.project.resolve(relative)
            if not target.is_file() or target.stat().st_size > wire.MAX_FRAME:
                await self.send(wire.file_miss(file_id))
                return
            data = await asyncio.to_thread(target.read_bytes)
        except (PermissionError, OSError, ValueError):
            await self.send(wire.file_miss(file_id))
            return
        await self.send(wire.file_have(file_id, relative, data))


class PeerNetwork:
    """This install's side of one shared project."""

    def __init__(self, store, hub=None, session=None) -> None:
        self.store = store
        self.hub = hub
        self.session = session
        self.share = Share(
            store.project.state_dir / "collab",
            card_dir=shares_home(), project_root=store.project.root,
        )
        self.marks = history_sync.Marks(store.project.state_dir / "collab")
        self.transport: transport.Transport | None = None
        self.links: dict[str, PeerLink] = {}
        self.applying: PeerLink | None = None
        self.last_error = ""
        #: Set once `note_removed_self` has acted on our own tombstone.
        self.removed = False
        self._tasks: set[asyncio.Task] = set()
        #: Peers we already have a dialling loop for, so learning about one
        #: twice does not start two.
        self._dialling: set[str] = set()
        self._closed = False
        self._me = ""
        #: The loop this network runs on, so that a history write finishing
        #: on a worker thread can still say so.
        self._loop: asyncio.AbstractEventLoop | None = None
        self._nudging: set[str] = set()
        self._nudge: asyncio.Task | None = None
        self._marks_save: asyncio.Task | None = None

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
        if self.removed_here():
            # Removed before this restart.  Nothing to listen for and
            # nobody to dial: every member will refuse us, and the
            # interface says so from the record alone.
            self.removed = True
            return
        self._loop = asyncio.get_running_loop()
        self._teach_history()
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
        # Announced like a peer arriving: the browser's record of the
        # share is what the People drawer's heading reads, and without
        # this it learnt of a share made from the drawer only at the next
        # transition.
        self._announce_peers()

    async def leave(self) -> None:
        """Take this install out of the share, keeping the project.

        The other members keep their copies and their share; this copy
        becomes a project of this install's own, with the same documents
        and the same history.  In order: our own tombstone into the
        manifest, so the others learn it the way they learn any removal;
        a moment for every link to carry it; the links and the transport
        closed; and then the share record and its card removed, which is
        what makes the project private again.  Getting back in needs a
        new invite, as the tombstone says.

        An install that was itself removed does only the local half: its
        tombstone is already written, and there is nobody to tell.
        """
        if not self.share.shared:
            return
        if not self.removed_here() and not self.removed:
            if "members" in self.store.manifest:
                members = self.store.manifest.get("members", type=Map)
                record = members.get(self.peer_id)
                if record is not None:
                    with self.store.manifest.transaction():
                        record["removed_at"] = time.time()
                        record["removed_by"] = self.peer_id
            entry = self.share.members.setdefault(self.peer_id, {})
            entry["removed_at"] = time.time()
            entry["removed_by"] = self.peer_id
            self.share.save()
            await asyncio.gather(
                *(link.drained() for link in list(self.links.values())),
                return_exceptions=True,
            )
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
        if self._document_changed in self.store.listeners:
            self.store.listeners.remove(self._document_changed)
        if self.hub is not None and self.hub.on_awareness is self._awareness_changed:
            self.hub.on_awareness = None
        # The manifest's member list belongs to the share this project has
        # just left.  With no link open this change reaches nobody, and it
        # is what keeps a later `begin_sharing` from carrying the old
        # members into a new share as members who are never connected.
        if "members" in self.store.manifest:
            members = self.store.manifest.get("members", type=Map)
            with self.store.manifest.transaction():
                for peer_id in list(members.keys()):
                    del members[peer_id]
        self.share.drop_card()
        with contextlib.suppress(OSError):
            self.share.path.unlink()
        self.share.share_id = ""
        self.share.members = {}
        self.share.invites = {}
        self.share.joined_at = 0.0
        self.removed = False
        self.last_error = ""
        self._dialling.clear()
        self._announce_peers()

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
        # Every member gets a dialling loop from here, as from a WELCOME.
        # They did not: the newcomer dialled everybody from their WELCOME
        # and that was the only link either side had, so when it dropped,
        # the newcomer's loop was the only thing that would ever rebuild
        # it, and a third peer that had forgotten them was never so much as
        # asked again.  Every member rather than the ones first seen here,
        # because a peer that dialled us first is already in the record by
        # way of `_accept` when the manifest arrives.  `dial_later` is
        # idempotent, so this costs nothing for a peer with a loop.
        for peer_id in list(self.share.members):
            if peer_id != self.peer_id:
                self.dial_later(peer_id)
        # The one record that is about us.  A tombstone here was written
        # by somebody's actual `remove`, whether it came from them or by
        # way of a third peer, and it is the only thing that means we were
        # removed: see `note_removed_self`.
        if self.removed_here() and not self.removed:
            self._spawn(self.note_removed_self())

    def removed_here(self) -> bool:
        """Whether this install's own member record carries a tombstone."""
        record = self.share.members.get(self.peer_id) or {}
        return bool(record.get("removed_at"))

    async def note_removed_self(self) -> None:
        """Somebody removed this install from the project.  Act on it once.

        The links are closed and nothing is dialled again, because every
        peer that has heard will refuse us and dialling the ones that have
        not would only be the same refusal a little later.  The transport
        stops listening for this share, so nobody can be let in by an
        install that is no longer a member.  The record stays: the project
        is still here, the documents still open, and the interface says
        what happened beside an offer to keep the copy as a project of
        this install's own.

        Never reached from a DENIED.  A peer denies from its own copy of
        the member list, and that copy can be behind; one stale peer must
        not be able to put a member out for good.
        """
        if self.removed:
            return
        self.removed = True
        self.share.save()
        for link in list(self.links.values()):
            link.alive = False
            with contextlib.suppress(Exception):
                await link.stream.close()
        self.links.clear()
        if self.transport is not None:
            with contextlib.suppress(Exception):
                await self.transport.close()
            self.transport = None
        self._announce_peers()

    def remove(self, peer_id: str) -> None:
        """Stop talking to a peer, and tell the others.

        Not revocation. They keep every byte they already have.
        """
        if "members" in self.store.manifest:
            members = self.store.manifest.get("members", type=Map)
            record = members.get(peer_id)
            if record is not None:
                # One update, not two.  Written as two map operations the
                # tombstone could travel as two updates, and the removed
                # peer acts on the first: `removed_at` alone makes
                # `removed_here()` true, `note_removed_self` closes every
                # link, and `removed_by` never arrives.  The interface then
                # said they were removed and could not say by whom, which
                # the CI runner was slow enough to show.
                with self.store.manifest.transaction():
                    record["removed_at"] = time.time()
                    record["removed_by"] = self.peer_id
        entry = self.share.members.setdefault(peer_id, {})
        entry["removed_at"] = time.time()
        entry["removed_by"] = self.peer_id
        self.share.save()
        link = self.links.pop(peer_id, None)
        if link is not None:
            # The tombstone was queued to them a moment ago, by the
            # manifest observer.  Marking the link dead here, before the
            # queue had drained, meant they never received it: they found
            # out by dialling and being refused, every two seconds, for
            # ever.  So the queue is given a moment to empty first.
            self._spawn(self._say_goodbye(link))
        self._announce_peers()

    async def _say_goodbye(self, link: PeerLink) -> None:
        await link.drained()
        link.alive = False
        with contextlib.suppress(Exception):
            await link.stream.close()

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
        if not WELL_FORMED_SHARE_ID.fullmatch(share_id):
            # The id names a file in the state directory from here on.
            return "That does not look like an invite."

        self.share.share_id = share_id
        self.share.joined_at = time.time()
        self.share.save()

        self._loop = asyncio.get_running_loop()
        self._teach_history()
        self.transport = self.transport or self._make_transport()
        await self.transport.start(self._accept)
        self.store.listeners.append(self._document_changed)
        if self.hub is not None:
            self.hub.on_awareness = self._awareness_changed
        try:
            stream = await self.transport.connect(address)
        except Exception as error:
            return f"Could not reach that peer: {error}"

        link = PeerLink(self, stream, getattr(stream, "peer_id", ""), outbound=True)
        self.adopt_link(link, force=True)
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

    async def rejoin(self, card: dict) -> str:
        """Get back into a share this install is already a member of.

        For the install whose project folder is gone: the card in the
        state directory still says which share it was, whom to dial and
        where they were last reachable.  No invite, because the gate at
        every member admits a member's key on its own; a HELLO with no
        secret is all a member ever sends.  Returns "" or a sentence.
        """
        share_id = str(card.get("share_id") or "")
        if not WELL_FORMED_SHARE_ID.fullmatch(share_id):
            return "That is not a share this install knows."
        members = card.get("members")
        if not isinstance(members, dict) or self.peer_id not in members:
            return "This install is not a member of that share."
        self.share.share_id = share_id
        self.share.members = {
            str(k): dict(v) for k, v in members.items() if isinstance(v, dict)
        }
        self.share.joined_at = float(card.get("joined_at") or 0.0) or time.time()
        if self.removed_here():
            return ("You were removed from this project. To get back in, "
                    "ask somebody in it for a new invite.")
        self.share.save()

        self._loop = asyncio.get_running_loop()
        self._teach_history()
        self.transport = self.transport or self._make_transport()
        await self.transport.start(self._accept)
        if self._document_changed not in self.store.listeners:
            self.store.listeners.append(self._document_changed)
        dialled = 0
        for peer_id in list(self.share.members):
            if peer_id != self.peer_id and self.share.allows(peer_id):
                self.dial_later(peer_id)
                dialled += 1
        if not dialled:
            return "Nobody else is in that share to ask for the project."
        return ""

    async def _accept(self, stream) -> None:
        """Somebody dialled us."""
        peer_id = getattr(stream, "peer_id", "")
        link = PeerLink(self, stream, peer_id)
        try:
            # Under the same deadline a link's frames wait under: a peer
            # that connects and never says hello held a stream for ever.
            first = await asyncio.wait_for(anext(aiter(stream)), PeerLink.silence_limit)
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
        if not self.adopt_link(link):
            # Crossed with our own dial to them, which both ends keep.
            link.alive = False
            await _quietly_close(stream)
            return
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
        while (
            not self._closed
            and self.transport is not None
            and self.share.allows(peer_id)
            and not self.removed_here()
        ):
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
            link = PeerLink(self, stream, peer_id, outbound=True)
            if not self.adopt_link(link):
                # They dialled us in the meantime, and theirs is the one
                # both ends keep.
                link.alive = False
                await _quietly_close(stream)
                attempt = 0
                await asyncio.sleep(2)
                continue
            self._spawn(link.run())
            name = (self.share.members.get(self.peer_id) or {}).get("name", "")
            await link.send(wire.hello(
                self.share.share_id, name, "", self.address(),
            ))
            await link.send_documents()
            await asyncio.sleep(2)
            if link.denied:
                # Connected and turned away.  A connection that succeeds
                # used to reset the backoff, so a peer whose copy of the
                # member list was behind ours, or that had removed us, was
                # dialled again every two seconds.
                wait = BACKOFF[min(attempt, len(BACKOFF) - 1)]
                attempt += 1
                await asyncio.sleep(wait)
            else:
                attempt = 0

    def _announce_peers(self) -> None:
        """Tell the browsers that a peer arrived or went away.

        The interface polls `state()` every four seconds from one sheet and
        keeps nothing anywhere else, so a peer arriving, a peer present and
        a peer gone for good were the same empty space in the tab strip. A
        poll is a sample; this makes the two ends of a link a transition,
        which is what the writer actually needs to be told about, because
        their typing stops reaching anybody the moment it happens.

        Guarded, because a joining network has no session yet and the tests
        pass a stand-in that is not one.
        """
        events = getattr(self.session, "events", None)
        if events is None:
            return
        self._spawn(events.publish({"type": "collab_peers", **self.state()}))

    def adopt_link(self, link: PeerLink, *, force: bool = False) -> bool:
        """Take a new connection to a peer, or say that the one held wins.

        Two installs starting at the same time dial each other at the same
        time, which is the ordinary shape rather than a rare one -- and
        assigning straight into the dictionary left the loser's `run()` loop
        going round for ever on a stream nothing would ever close. `dropped`
        could not clean it up either, because it only forgets a link that is
        still the current one.

        Which of two live links to keep has to be decided the same way at
        both ends, or the two decisions undo each other: each side kept
        its own newest link, which was its own dial, and closed the other
        side's, so on a slow machine two loops crossing every two seconds
        took each other's links down for as long as they ran.  The rule is
        that the connection dialled by the lower peer id is the one both
        sides keep.  A dead link is replaced by whatever arrives, and
        `force` is for a join, which has nothing to keep yet.

        Returns whether the link was adopted.  A caller told no closes it
        and carries on with the link it has.
        """
        existing = self.links.get(link.peer_id)
        if existing is not None and existing is not link and existing.alive and not force:
            lower_dials = self.peer_id < link.peer_id
            if existing.outbound == lower_dials and link.outbound != lower_dials:
                return False
        if existing is not None and existing is not link:
            existing.alive = False
            self._spawn(_quietly_close(existing.stream))
        self.links[link.peer_id] = link
        self._announce_peers()
        return True

    def dropped(self, link: PeerLink) -> None:
        if self.links.get(link.peer_id) is link:
            self.links.pop(link.peer_id, None)
            self._announce_peers()

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

    def _teach_history(self) -> None:
        """Tell the history who we are, and how to say a file has changed.

        `me` is what tells a record written before this project was shared
        -- which carries no peer at all -- apart from one written by
        somebody else.  Both are in the same log on a shared project, and
        every comparison about whose sequence a record belongs to goes
        through it.
        """
        history = self.history()
        if history is None:
            return
        history.me = self.peer_id if self.share.shared else ""
        history.listen(self.note_history)

    def note_history(self, key: str) -> None:
        """A file has a past it did not have a moment ago; say so.

        Told the key, which is the file id, so a deletion's version, whose
        record is trashed by the time this runs, is announced too: going
        through `file_id_for`, which skips trashed records, dropped it
        until the next reconnect.

        Hung off the history rather than off `record_version`, for two
        reasons.  The trash records its delete and restore versions straight
        onto the history and would otherwise never say a word.  And a
        relaying install has to say so when it *absorbs* somebody else's
        lines as much as when it writes its own, or a file that only reaches
        this project through a relay is back to syncing on reconnection
        alone.

        Safe from a worker thread: recording runs off the loop.
        """
        loop = self._loop
        if self._closed or loop is None or not key:
            return
        try:
            loop.call_soon_threadsafe(self._history_changed, key)
        except RuntimeError:
            pass

    def _history_changed(self, key: str) -> None:
        if self._closed or not self.links:
            return
        self._nudging.add(key)
        if self._nudge is None or self._nudge.done():
            self._nudge = asyncio.create_task(self._say_what_changed())

    async def _say_what_changed(self) -> None:
        """Tell everyone, once, a moment after the typing stops.

        Debounced because a save is a save: an editing burst already
        collapses into one version, so there is nothing to say more often
        than that.
        """
        await asyncio.sleep(HISTORY_NUDGE_SECONDS)
        changed, self._nudging = self._nudging, set()
        if self._closed:
            return
        for file_id in changed:
            if file_id not in self.store.files:
                continue
            frame = wire.hist_new(file_id)
            for link in list(self.links.values()):
                if link.alive:
                    link.enqueue(frame)

    def save_marks_soon(self) -> None:
        if self._closed:
            return
        if self._marks_save is None or self._marks_save.done():
            self._marks_save = asyncio.create_task(self._save_marks())

    async def _save_marks(self) -> None:
        await asyncio.sleep(2.0)
        await asyncio.to_thread(self.marks.save)

    async def fetch_recent(self, versions) -> None:
        """Ask for the contents of a collaborator's newest versions.

        Bounded on purpose.  Almost nobody opens almost any old version, so
        pulling a peer's whole past down before the first keystroke is the
        wrong trade -- and it is the trade this deliberately does not make.
        But a version listed and permanently unopenable is worse than one
        not listed at all, and the ones somebody reaches for are the recent
        ones and the ones they named.

        Across every link rather than the one that sent the line: a relay
        can pass on a record for content it does not itself hold.
        """
        history = self.history()
        if history is None or not versions:
            return
        fresh = now_ms() - EAGER_BLOB_HOURS * 3600 * 1000
        for version in versions:
            if version.at < fresh and not version.label:
                continue
            if history.blobs.has(version.sha):
                continue
            await self.fetch_blob(version.sha)

    def take_blob(self, sha: str, data: bytes) -> None:
        """Store a blob a peer sent, if it is really the one asked for."""
        history = self.history()
        if history is None or not sha or not data:
            return
        import hashlib

        # Asked for, and not merely well named. These are two questions and
        # only the second was being asked, so a peer could send BLOB_HAVE
        # for anything at all, unsolicited, and every one of them was
        # written into this install's history blobs. Being invited into a
        # project is not a licence to fill the disk, and nothing on any
        # screen accounts for what is in there.
        if not any(sha in link.wanted for link in self.links.values()):
            return

        # Checked rather than trusted. A content-addressed store whose
        # contents do not match their names is worse than an empty one.
        if hashlib.sha256(data).hexdigest() != sha:
            return
        history.blobs.put(data)
        for link in self.links.values():
            link.wanted.pop(sha, None)

    def take_file(self, file_id: str, path: str, data: bytes) -> bool:
        """A binary a peer sent, checked before it is parked.

        The same order of questions `take_blob` asks.  Nobody asked for it:
        dropped, since being a member is not a licence to fill the disk.
        The record is not a live binary, or names a different path from
        the frame: dropped, since the manifest is the authority on what a
        file is called.  The path is one the fence refuses: dropped.  The
        file is already here: dropped, since this install's copy is not
        the sender's to replace.  What survives is parked in the store and
        written by its next flush, never here, so a binary lands the way a
        text document does.
        """
        if not any(file_id in link.wanted_files for link in self.links.values()):
            return False
        record = self.store.files.get(file_id)
        if record is None or record.get("kind") != "blob" or record.get("trashed"):
            return False
        if str(record.get("path") or "") != path:
            return False
        try:
            target = self.store.project.resolve_for_write(path)
        except (PermissionError, OSError, ValueError):
            return False
        if target.exists():
            return False
        if not self.store.take_file(file_id, data):
            return False
        for link in self.links.values():
            link.wanted_files.pop(file_id, None)
        return True

    async def fetch_blob(self, sha: str) -> None:
        """Ask whoever is connected for a blob this install does not have."""
        for link in list(self.links.values()):
            if link.alive:
                await link.want_blob(sha)

    def _name_of(self, peer_id: str) -> str:
        if not peer_id:
            return ""
        return (self.share.members.get(peer_id) or {}).get("name", "") or peer_id

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
            # Whether somebody removed this install, and who, by name where
            # their record says one.  Told from the tombstone in our own
            # record and nothing else.
            "removed": self.removed_here(),
            "removedBy": self._name_of(
                (self.share.members.get(self.peer_id) or {}).get("removed_by", "")
            ),
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
        # Before the tasks are cancelled: the debounced save is one of them.
        self.marks.save()
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

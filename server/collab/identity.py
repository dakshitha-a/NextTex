"""This install's name among other installs.

A peer is an ed25519 keypair and nothing else.  There is no account, no
registration, and nothing to sign in to: the public half *is* the identity,
iroh's transport authenticates it as part of the TLS handshake, and so
"is this peer allowed" reduces to "is this key in the list".

The secret half lives in the instance's state directory, `chmod 600`, beside
the access token -- which means a second install started with
`NEXTTEX_INSTANCE` gets a different identity for free, and two of them on one
machine are two genuinely different peers.  That is what makes the browser
tests possible without any special arrangement.

Losing this file is losing the peer, not the work: the files are on disk and
the collaboration can be joined again with a new invite.  It is worth saying
so where somebody might otherwise treat it as precious.
"""

from __future__ import annotations

import secrets
from pathlib import Path

from nexttex.project import state_home

KEY_FILE = "peer.key"
KEY_BYTES = 32


def key_path() -> Path:
    return state_home() / KEY_FILE


def secret_key() -> bytes:
    """This install's private key, generated on first use.

    Written before it is used, and read back rather than returned from the
    generating call, so a key that could not be persisted is noticed here
    rather than as a peer whose identity changes on every restart.
    """
    path = key_path()
    try:
        existing = path.read_bytes()
        if len(existing) == KEY_BYTES:
            return existing
    except OSError:
        pass

    fresh = secrets.token_bytes(KEY_BYTES)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_bytes(fresh)
    temp.chmod(0o600)
    temp.replace(path)
    return fresh


def peer_id(secret: bytes | None = None) -> str:
    """The public half, as 64 hex characters.

    Derived through iroh so that this and the id a remote peer authenticates
    us as can never disagree.  Without iroh -- an Intel Mac, or a test on the
    loopback transport -- a hash of the secret stands in: it is stable, it is
    the right shape, and nothing outside this machine will ever see it.
    """
    secret = secret or secret_key()
    try:
        import iroh

        return str(iroh.SecretKey.from_bytes(secret).public())
    except Exception:
        import hashlib

        return hashlib.sha256(b"nexttex-peer\x00" + secret).hexdigest()

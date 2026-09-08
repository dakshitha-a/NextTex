"""Who is allowed to drive this install from a browser.

NextTex used to have one secret: a token printed at install time, put in a
URL, and then handed straight back to the browser as the value of a cookie.
That has three problems, none of them theoretical.  Every browser that has
ever been let in is holding the master credential, so a copied cookie is a
copied install.  The token travels in a URL, which is the one place secrets
reliably end up in shell history, scrollback and screenshots.  And there is
no way to sign one browser out, because there is nothing to sign out -- the
cookie and the token are the same string.

So there are two credentials now, and they do different jobs.

**The instance token** stays exactly what it was: printed by the installer,
accepted as a query parameter or a header, and never expiring.  It is the
recovery path and the way a script gets in.  It is no longer what a browser
holds.

**A session** is minted per browser when it proves it knows the password (or
arrives with the instance token).  Only its sha256 is stored, so the config
file no longer contains anything that would let a reader in.  Sessions can be
listed and revoked individually, which is what makes "sign my other browsers
out" a thing that can be offered at all.

The password itself is hashed with `hashlib.scrypt` -- standard library, so
nothing is vendored and nothing is invented -- at the parameters RFC 7914
suggests for interactive logins.  A session token is 32 bytes of `secrets`
entropy, so a plain sha256 is the right lookup: there is nothing to brute
force, and a slow hash on every single request would be a per-keystroke cost
for no gain.

Setting a password revokes every existing session.  Someone changing their
password is either being careful or has just stopped being careful, and both
of those want the other browsers logged out.
"""

from __future__ import annotations

import hashlib
import secrets
import time

# RFC 7914's interactive-login parameters.  n=2**14 costs about 15 ms here,
# which is small enough not to be felt on a sign-in and large enough that a
# stolen config file is not worth grinding.
SCRYPT_N = 1 << 14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32

# How many browsers can be signed in at once.  The cap exists so the config
# file cannot grow without bound; the oldest goes first, and anyone evicted
# simply signs in again.
MAX_SESSIONS = 32

# Sessions last a year, matching the cookie the browser is given.  Anything
# shorter means a writer who opens their thesis on Monday and again the
# following Monday has to find the password again, which trains people to
# pick a worse one.
SESSION_TTL_SECONDS = 365 * 24 * 60 * 60

# A signed-in browser's `last_seen` is only written when it has moved by more
# than this.  Every request would otherwise rewrite the config file, which on
# an autosaving editor is several writes a second for a field nobody reads at
# that resolution.
TOUCH_INTERVAL_SECONDS = 60 * 60

# Failed attempts, per client address.  Not a lockout -- a lockout on a
# single-user tool is a way to be denied your own documents by someone else's
# guessing.  A delay that grows makes a remote guess uneconomic while leaving
# the person at the keyboard able to try again.
_FAILURES: dict[str, tuple[int, float]] = {}
MAX_DELAY_SECONDS = 8.0


def _scrypt(password: str, salt: bytes) -> str:
    return hashlib.scrypt(
        password.encode("utf-8"), salt=salt,
        n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=SCRYPT_DKLEN,
    ).hex()


def hash_password(password: str) -> tuple[str, str]:
    """Return (hash, salt), both hex, for a new password."""
    salt = secrets.token_bytes(16)
    return _scrypt(password, salt), salt.hex()


def verify_password(password: str, stored_hash: str, stored_salt: str) -> bool:
    """Whether `password` is the one behind `stored_hash`.

    Returns False rather than raising when no password has been set, so the
    caller can ask without first checking.
    """
    if not stored_hash or not stored_salt:
        return False
    try:
        salt = bytes.fromhex(stored_salt)
    except ValueError:
        return False
    return secrets.compare_digest(_scrypt(password, salt), stored_hash)


def token_fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_session(label: str = "") -> tuple[str, dict]:
    """A fresh session token and the record to store beside it.

    The token is returned once and never stored; what goes in the config file
    is its fingerprint, so the file holds nothing that would let a reader in.
    """
    token = secrets.token_urlsafe(32)
    now = time.time()
    return token, {
        "hash": token_fingerprint(token),
        "created": now,
        "last_seen": now,
        "label": label[:80],
    }


def find_session(sessions: list[dict], token: str) -> dict | None:
    """The record for `token`, if it is a live session.

    Expired records are ignored rather than deleted here: reading is on the
    hot path for every request and must not write.  `prune` does the removing,
    on the paths that were going to save anyway.
    """
    if not token:
        return None
    fingerprint = token_fingerprint(token)
    now = time.time()
    for record in sessions:
        if not secrets.compare_digest(str(record.get("hash", "")), fingerprint):
            continue
        if now - float(record.get("created") or 0) > SESSION_TTL_SECONDS:
            return None
        return record
    return None


def touch(record: dict) -> bool:
    """Mark a session as used. True if the caller should save."""
    now = time.time()
    if now - float(record.get("last_seen") or 0) < TOUCH_INTERVAL_SECONDS:
        return False
    record["last_seen"] = now
    return True


def prune(sessions: list[dict]) -> list[dict]:
    """Drop expired sessions and cap the list, oldest first."""
    now = time.time()
    live = [s for s in sessions
            if now - float(s.get("created") or 0) <= SESSION_TTL_SECONDS]
    live.sort(key=lambda s: float(s.get("last_seen") or 0), reverse=True)
    return live[:MAX_SESSIONS]


def describe(sessions: list[dict], current: str) -> list[dict]:
    """The session list as the settings card shows it.

    Never includes a hash: this crosses to the browser, and a fingerprint is
    still a thing worth not handing out.  `id` is a short prefix, enough to
    tell two rows apart and useless as a credential.
    """
    fingerprint = token_fingerprint(current) if current else ""
    return [
        {
            "id": str(s.get("hash", ""))[:12],
            "created": s.get("created"),
            "lastSeen": s.get("last_seen"),
            "label": s.get("label", ""),
            "current": bool(fingerprint) and s.get("hash") == fingerprint,
        }
        for s in sorted(sessions, key=lambda s: float(s.get("last_seen") or 0),
                        reverse=True)
    ]


def label_for(user_agent: str) -> str:
    """A human name for a browser, from its User-Agent.

    Deliberately crude.  The row exists so somebody can recognise which of
    their own machines a session belongs to, and "Firefox on Linux" does that
    while a full UA string only fills the card with noise.
    """
    ua = user_agent or ""
    browser = next(
        (name for marker, name in (
            ("Firefox/", "Firefox"), ("Edg/", "Edge"), ("OPR/", "Opera"),
            ("Chrome/", "Chrome"), ("Safari/", "Safari"),
        ) if marker in ua),
        "A browser",
    )
    system = next(
        (name for marker, name in (
            ("Windows", "Windows"), ("Macintosh", "macOS"), ("iPhone", "iOS"),
            ("iPad", "iPadOS"), ("Android", "Android"), ("Linux", "Linux"),
        ) if marker in ua),
        "",
    )
    return f"{browser} on {system}" if system else browser


def failure_delay(address: str) -> float:
    """How long this address should be made to wait before its next answer."""
    count, last = _FAILURES.get(address, (0, 0.0))
    # A quiet ten minutes forgives whatever went before, so one fat-fingered
    # evening does not make the next morning slow.
    if count and time.time() - last > 600:
        _FAILURES.pop(address, None)
        return 0.0
    if count < 3:
        return 0.0
    return min(MAX_DELAY_SECONDS, 0.5 * (2 ** (count - 3)))


def note_failure(address: str) -> None:
    count, _ = _FAILURES.get(address, (0, 0.0))
    _FAILURES[address] = (count + 1, time.time())
    # Bounded, so a stream of forged addresses cannot grow this without end.
    if len(_FAILURES) > 512:
        for stale in sorted(_FAILURES, key=lambda k: _FAILURES[k][1])[:256]:
            _FAILURES.pop(stale, None)


def note_success(address: str) -> None:
    _FAILURES.pop(address, None)

"""Instance configuration: where NextTex listens and what it can find.

Resolved once at startup and never re-read, so a running server has a fixed
idea of its own environment. In particular the LaTeX engine is located here
rather than looked up on each compile: under `systemd --user` the PATH is
minimal and a TeX Live installed in the user's home is invisible, and the
failure that produces is far easier to understand at startup than on the
first keystroke of the first document.
"""

from __future__ import annotations

import hashlib
import json
import sys
import os
import secrets
from dataclasses import dataclass, field, asdict
from pathlib import Path

from .atomic import write_atomically
from .paths import instance_name, state_home
# Re-exported: these lived here until the installer needed them on a bare
# interpreter, before there is a virtual environment.  See nexttex/tools.py.
from .tools import (  # noqa: F401
    TEX_HINTS,
    TOOLS,
    ensure_tex_on_path,
    missing_tools,
    required_missing,
)

CONFIG_FILE = "config.json"
DEFAULT_PORT = 8450


def default_port() -> int:
    """The port a fresh install listens on.

    A named instance never defaults to the main install's port: two NextTex
    on one machine that both start on 8450 means the second simply refuses
    to start, with a message about a port rather than about the thing the
    person was actually doing.  Derived from the name so it is the same
    every time, and so two named instances do not collide either.
    """
    name = instance_name()
    if not name:
        return DEFAULT_PORT
    digest = hashlib.blake2b(name.encode(), digest_size=2).digest()
    return DEFAULT_PORT + 1 + int.from_bytes(digest, "big") % 40

@dataclass
class Settings:
    port: int = field(default_factory=default_port)
    # Bind addresses. Plain HTTP is only ever offered on loopback; anything
    # reachable from another machine gets TLS.
    localhost: bool = True
    tailscale: bool = False
    lan_host: str = ""
    certfile: str = ""
    keyfile: str = ""
    token: str = field(default_factory=lambda: secrets.token_urlsafe(24))
    model: str = ""
    # Which writing agent, if any: "claude", "openai" or "none".  The
    # config file is already chmod 600 because it holds the access token,
    # which is what makes it the right place for an API key too.
    provider: str = "claude"
    openai_key: str = ""
    # How a browser gets in.  The token above is still the recovery path and
    # the way a script authenticates; these are what a person uses.  See
    # nexttex/auth.py for why they are separate.
    password_hash: str = ""
    password_salt: str = ""
    # One record per signed-in browser: a sha256 of its session token, when
    # it was minted, when it was last used, and a name for the row.
    sessions: list = field(default_factory=list)
    # What collaborators see beside this peer's cursor and versions.  Asked
    # for on the same screen as the password, because that is the one moment
    # a person is already telling NextTex who they are.
    display_name: str = ""
    # Whether latexmk may read a `latexmkrc` out of the project directory.
    # Off, because that file is arbitrary Perl and a project is not always
    # the writer's own work: it can be cloned, it can come from a template,
    # and it can arrive from a collaborator.  On for anyone whose own
    # projects genuinely need one, which is a real thing to need.
    #
    # It lives here, in the install's own settings, and deliberately not in
    # `nexttex.toml`: that file is inside the project, so a project could
    # otherwise arrive carrying permission to run its own code.
    latexmk_rc: bool = False

    @classmethod
    def path(cls) -> Path:
        return state_home() / CONFIG_FILE

    @classmethod
    def load(cls) -> "Settings":
        path = cls.path()
        if not path.exists():
            settings = cls()
            try:
                settings.save()
            except OSError:
                pass      # unwritable state directory: run anyway, in memory
            return settings
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            # A settings file that cannot be read used to be replaced by a
            # fresh one on every start -- a new token each time, so every
            # saved link and every open tab stopped working with nothing
            # said about why.  Keep the broken file, say so once, and write
            # a replacement that then stays put.
            broken = path.with_name(path.name + ".broken")
            try:
                path.replace(broken)
            except OSError:
                pass
            else:
                print(
                    f"  Settings file could not be read; kept as {broken.name}.\n"
                    "  A new access token has been generated, so any saved "
                    "NextTex link will need the new one.",
                    file=sys.stderr,
                )
            settings = cls()
            try:
                settings.save()
            except OSError:
                pass      # unwritable state directory: run anyway, in memory
            return settings
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in data.items() if k in known})

    def save(self) -> None:
        # Through `write_atomically`, for the reason its own docstring gives:
        # it chmods the temp file *before* the rename, and this did it after.
        # This file holds the access token, the OpenAI key and a fingerprint
        # of every signed-in session, and it was spending the gap between two
        # statements at whatever the process umask allows -- 0644 on most
        # machines -- in a directory other users can read.
        path = self.path()
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        write_atomically(path, json.dumps(asdict(self), indent=2), mode=0o600)

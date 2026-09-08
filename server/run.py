"""Start NextTex, on one address or two.

uvicorn binds a single socket per server object, so "reachable at localhost
*and* over Tailscale" means two servers sharing one event loop.  They serve
the same application object, so there is one registry, one set of open
projects and one agent per project no matter which address the browser
came in on.

Loopback is served as plain HTTP: nothing leaves the machine, and a
self-signed certificate on localhost costs the user a browser warning for
no gain.  Anything reachable from another machine is served over TLS.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import socket
import sys
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from nexttex.config import Settings, ensure_tex_on_path, missing_tools, required_missing


def tailscale_address() -> str | None:
    """This machine's tailnet address, if Tailscale is up."""
    import json
    import subprocess

    try:
        out = subprocess.run(
            ["tailscale", "status", "--json"],
            capture_output=True, text=True, timeout=5,
        ).stdout
        status = json.loads(out)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    addresses = (status.get("Self") or {}).get("TailscaleIPs") or []
    for address in addresses:
        if ":" not in address:      # IPv4 first; it is what people type
            return address
    return addresses[0] if addresses else None


def in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((host, port))
        except OSError:
            return True
    return False


async def serve(settings: Settings) -> None:
    # uvicorn is kept quiet -- an access log line per keystroke is noise --
    # but that left NextTex's own warnings with nowhere to go, and the app
    # was silent through failures the writer could see on screen: a wedged
    # agent turn, a build task that died, a subscriber dropped.  Warnings
    # and worse now carry a timestamp and the name of what went wrong.
    logging.basicConfig(
        level=logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    servers: list[uvicorn.Server] = []
    urls: list[str] = []

    if settings.localhost:
        config = uvicorn.Config(
            "server.main:app", host="127.0.0.1", port=settings.port,
            log_level="warning", access_log=False,
        )
        servers.append(uvicorn.Server(config))
        urls.append(f"http://127.0.0.1:{settings.port}")

    remote = settings.lan_host or (tailscale_address() if settings.tailscale else "")
    if remote:
        if not (settings.certfile and Path(settings.certfile).is_file()):
            print(
                "  no certificate, so the tailnet address is not being served.\n"
                "  Run scripts/gen_cert.sh, or scripts/install.sh again.",
                file=sys.stderr,
            )
        else:
            config = uvicorn.Config(
                "server.main:app", host=remote, port=settings.port,
                ssl_certfile=settings.certfile, ssl_keyfile=settings.keyfile,
                log_level="warning", access_log=False,
            )
            servers.append(uvicorn.Server(config))
            urls.append(f"https://{remote}:{settings.port}")

    if not servers:
        print("Nothing to listen on. Set localhost or tailscale in the config.",
              file=sys.stderr)
        raise SystemExit(2)

    print("\nNextTex")
    for url in urls:
        print(f"  {url}/?token={settings.token}")
    print()

    # One loop, both sockets.  If either fails to bind, the whole thing
    # stops: a half-started server that silently drops the address the user
    # actually types is worse than not starting.
    await asyncio.gather(*(server.serve() for server in servers))


def _print_version() -> None:
    """The commit this install is on, and the one its interface was built
    from.

    Two numbers rather than one because they can disagree: the interface is
    downloaded per commit, so a failed or half-finished update can leave new
    code serving an older bundle. Nothing could see that before, which is
    the reason to print it at all.
    """
    from nexttex import gitrepo

    # Derived here rather than imported from server.main, which would build
    # the whole application to answer a question about a file on disk.
    root = Path(__file__).resolve().parent.parent
    try:
        head = gitrepo._run(root, "rev-parse", "HEAD").strip()
    except Exception:
        head = "unknown (not a git checkout)"
    stamp = root / "frontend" / "dist" / "BUILD_SHA"
    try:
        built = stamp.read_text(encoding="utf-8").strip()
    except OSError:
        built = "unknown (built here, or before this was recorded)"
    print(f"code      {head}")
    print(f"interface {built}")
    if head != built and not built.startswith("unknown"):
        print("\nThese differ: the interface does not belong to this commit.")
        print("Run scripts/update.sh, or scripts/fetch-interface.sh on its own.")


def _set_password(settings: Settings) -> None:
    """Choose the password from the machine itself.

    The way back in when it has been forgotten, and the way to set one on a
    headless install.  Every existing session is dropped, because a password
    being changed at a terminal is exactly the moment the browsers holding
    the old one should stop being trusted.
    """
    import getpass
    from nexttex import auth

    try:
        first = getpass.getpass("New password: ")
        second = getpass.getpass("Again: ")
    except (EOFError, KeyboardInterrupt):
        print()
        raise SystemExit(1)

    if first != second:
        print("Those do not match.", file=sys.stderr)
        raise SystemExit(1)
    if len(first) < 8:
        print("Use at least eight characters.", file=sys.stderr)
        raise SystemExit(1)

    settings.password_hash, settings.password_salt = auth.hash_password(first)
    signed_out = len(settings.sessions)
    settings.sessions = []
    settings.save()
    print("Password set." + (f" {signed_out} signed-in browser(s) were signed out."
                             if signed_out else ""))


def main() -> None:
    parser = argparse.ArgumentParser(description="Run NextTex.")
    parser.add_argument("--port", type=int, help="override the configured port")
    parser.add_argument("--print-url", action="store_true",
                        help="print the sign-in URL and exit")
    parser.add_argument("--version", action="store_true",
                        help="print the commit this install is on and exit")
    parser.add_argument("--set-password", action="store_true",
                        help="set the password browsers sign in with, and exit")
    arguments = parser.parse_args()

    if arguments.version:
        _print_version()
        return

    settings = Settings.load()
    if arguments.port:
        settings.port = arguments.port

    if arguments.set_password:
        _set_password(settings)
        return

    if arguments.print_url:
        # Every address it answers on.  Printing only localhost would hide
        # the one URL a headless user can actually open.
        if settings.localhost:
            print(f"http://127.0.0.1:{settings.port}/?token={settings.token}")
        remote = settings.lan_host or (
            tailscale_address() if settings.tailscale else "")
        if remote:
            print(f"https://{remote}:{settings.port}/?token={settings.token}")
        return

    ensure_tex_on_path()
    for item in required_missing():
        print(f"  missing: {item}", file=sys.stderr)
    for item in missing_tools():
        print(f"  note: {item}")

    for host in filter(None, [
        "127.0.0.1" if settings.localhost else None,
        settings.lan_host or (tailscale_address() if settings.tailscale else None),
    ]):
        if in_use(host, settings.port):
            print(f"Port {settings.port} is already in use on {host}. "
                  f"Stop the other NextTex, or set a different port.",
                  file=sys.stderr)
            raise SystemExit(1)

    try:
        asyncio.run(serve(settings))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

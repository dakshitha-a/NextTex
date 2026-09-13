"""Press the Update button on a real install, and wait for the new server.

The other half of the update leg in `.github/workflows/install.yml`.  The
scripts are run by hand for the first hop; this is the second, through the
route the footer uses: `POST /api/update`, the event stream for the log,
and then `/api/instance` until a process with a new boot nonce answers on
the commit the install was moved to.  Which is the whole promise of the
button: the page comes back on its own, on the new code.  On Linux and
macOS the unit or the agent brings it back; on Windows the helper the
server starts before it leaves does.

Standard library only, like verify_install.py, and for the same reason.

    drive_update.py --root DIR [--instance NAME] --head SHA
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_install import ask, print_url  # noqa: E402


def follow(base: str, token: str, lines: list) -> None:
    """Read the update's event stream until it says done or failed."""
    request = urllib.request.Request(base + "/api/update/stream",
                                     headers={"X-NextTex-Token": token})
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            for raw in response:
                text = raw.decode("utf-8", "replace").strip()
                if not text.startswith("data:"):
                    continue
                event = json.loads(text[5:].strip())
                if event.get("type") == "output":
                    lines.append(event.get("text", ""))
                    print("    " + event.get("text", ""), flush=True)
                elif event.get("type") == "step":
                    print("  > " + event.get("label", ""), flush=True)
                elif event.get("type") in ("done", "failed"):
                    lines.append(f"<{event['type']}: {event}>")
                    print(f"  {event['type']}: {event}", flush=True)
                    return
    except Exception as error:  # noqa: BLE001
        # The stream ends when the process does, which is the point.
        lines.append(f"<stream ended: {type(error).__name__}: {error}>")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--instance", default="")
    parser.add_argument("--head", required=True, help="the commit the remote was moved to")
    parser.add_argument("--timeout", type=float, default=600.0)
    args = parser.parse_args(argv)
    root = Path(args.root).resolve()

    url, port, token, out = print_url(root, args.instance)
    if not url:
        print("no address:\n" + out)
        return 1
    status, before = ask(url, "/api/instance", token)
    print(f"running {before['head']} (boot {before['boot']}), supervised={before['supervised']}")

    status, report = ask(url, "/api/update?force=1", token, timeout=120)
    print(f"check: behind {report.get('behind')}, changing {report.get('changing')}, "
          f"can_update={report.get('can_update')}, reason={report.get('reason')!r}")
    if not report.get("can_update"):
        print("the install will not update itself: " + str(report.get("reason")) + " " + str(report.get("error", "")))
        return 1

    lines: list = []
    watcher = threading.Thread(target=follow, args=(url, token, lines), daemon=True)
    watcher.start()
    status, body = ask(url, "/api/update", token, method="POST", timeout=120)
    print(f"POST /api/update -> {status} {body}")
    if status != 202:
        return 1
    watcher.join(timeout=args.timeout)
    if any(line.startswith("<failed") for line in lines):
        print("the update failed")
        return 1

    # The new process: a different boot nonce, on the new commit.
    deadline = time.monotonic() + 180
    after = None
    while time.monotonic() < deadline:
        try:
            status, after = ask(url, "/api/instance", token, timeout=5)
            if after["boot"] != before["boot"]:
                break
        except Exception:  # noqa: BLE001
            pass
        time.sleep(1)
        after = None
    if after is None:
        print("no new process answered within three minutes")
        return 1
    print(f"back: {after['head']} (boot {after['boot']}), diskHead {after['diskHead']}")
    ok = args.head.startswith(after["head"]) and after["head"] == after["diskHead"]
    print("the new server runs the commit the remote was moved to" if ok else "WRONG COMMIT")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""A stand-in for `tlmgr`, so the drawer's Install button can be driven
for real in a browser without a CTAN mirror or a real install.

Point NEXTTEX_TLMGR at it.  `search --file --global /<name>` answers that
the package `<stem>-pkg` provides the file, in tlmgr's own layout; a file
whose stem is `nowhere` gets no answer, which is what a typo gets from the
real thing.  `install <pkg>` succeeds, or fails with the stale-mirror
message the real tlmgr prints when `<pkg>` is `stale-pkg`, and takes six
seconds over `slow-pkg`, so a second install can be seen waiting on it.
`install` takes several packages at once, as a template's list is sent.
`selfupdate-pkg` is refused with tlmgr's "needs to be updated" until
`update --self` has run, which is remembered in the file
NEXTTEX_FAKE_TLMGR_STATE names, or beside the log.  Every call's
argv is appended as one JSON line to the file NEXTTEX_FAKE_TLMGR_LOG
names, so a spec can assert what would have been run.
"""

import json
import os
import sys
from pathlib import Path


def main(argv: list[str]) -> int:
    log = os.environ.get("NEXTTEX_FAKE_TLMGR_LOG", "")
    if log:
        with open(log, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(argv) + "\n")

    if argv[:3] == ["search", "--file", "--global"] and len(argv) == 4:
        name = argv[3].lstrip("/")
        stem = Path(name).stem
        print("tlmgr: package repository https://mirror.invalid/tlnet (verified)")
        if stem != "nowhere":
            print(f"{stem}-pkg:")
            print(f"\ttexmf-dist/tex/latex/{stem}/{name}")
        return 0

    state = Path(os.environ.get("NEXTTEX_FAKE_TLMGR_STATE")
                 or (log + ".updated" if log else os.devnull))
    if argv == ["update", "--self"]:
        if log or os.environ.get("NEXTTEX_FAKE_TLMGR_STATE"):
            state.write_text("yes", encoding="utf-8")
        print("tlmgr: package repository https://mirror.invalid/tlnet (verified)")
        print("[1/1, ??:??/??:??] update: texlive.infra [452k]")
        return 0

    if argv[:1] == ["install"] and len(argv) >= 2:
        if "selfupdate-pkg" in argv[1:] and not (state.is_file() and state.read_text() == "yes"):
            print("tlmgr: Local TeX Live (2025) is older than remote repository (2026).",
                  file=sys.stderr)
            print("tlmgr itself needs to be updated.", file=sys.stderr)
            print("Please do this via either", file=sys.stderr)
            print("  tlmgr update --self", file=sys.stderr)
            return 1
        if "stale-pkg" in argv[1:]:
            print("tlmgr: Remote repository is newer than local (2025 < 2026)", file=sys.stderr)
            print("Cross release updates are only supported with", file=sys.stderr)
            print("  update-tlmgr-latest(.sh/.exe) --update", file=sys.stderr)
            return 1
        if "slow-pkg" in argv[1:]:
            # Long enough for another project's Install to queue behind it.
            import time
            time.sleep(float(os.environ.get("NEXTTEX_FAKE_TLMGR_SLOW", "6")))
        print(f"tlmgr: package repository https://mirror.invalid/tlnet (verified)")
        for index, package in enumerate(argv[1:], 1):
            print(f"[{index}/{len(argv) - 1}, ??:??/??:??] install: {package} [12k]")
        print("tlmgr: package log updated")
        return 0

    print(f"unknown command: {' '.join(argv)}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

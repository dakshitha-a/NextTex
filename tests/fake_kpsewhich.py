#!/usr/bin/env python3
"""A stand-in for `kpsewhich`, so the template browser can be shown a TeX
that lacks a venue's class without uninstalling it from a real one.

Point NEXTTEX_KPSEWHICH at it.  Every file asked for is found, at a made-up
path, except those NEXTTEX_FAKE_KPSEWHICH_LACKS names as `file=package`
pairs separated by commas; such a file is found once `tests/fake_tlmgr.py`
has logged an install of its package to NEXTTEX_FAKE_TLMGR_LOG, which is
how an install is seen to have worked.  Like the real one it prints a path
for each file it finds, nothing for the rest, and exits 1 if any is
missing.
"""

import json
import os
import sys
from pathlib import Path


def installed() -> set[str]:
    log = os.environ.get("NEXTTEX_FAKE_TLMGR_LOG", "")
    if not log or not Path(log).exists():
        return set()
    done = set()
    for line in Path(log).read_text(encoding="utf-8").splitlines():
        argv = json.loads(line)
        if argv[:1] == ["install"] and len(argv) == 2:
            done.add(argv[1])
    return done


def main(argv: list[str]) -> int:
    lacks = {}
    for pair in os.environ.get("NEXTTEX_FAKE_KPSEWHICH_LACKS", "").split(","):
        if "=" in pair:
            name, package = pair.split("=", 1)
            lacks[name.strip()] = package.strip()
    have = installed()
    missing = False
    for name in argv:
        if name.startswith("-"):
            continue
        if name in lacks and lacks[name] not in have:
            missing = True
            continue
        print(f"/fake/texmf-dist/tex/latex/{Path(name).stem}/{name}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

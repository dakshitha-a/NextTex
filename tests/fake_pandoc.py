#!/usr/bin/env python3
"""A stand-in for `pandoc`, so the download menu's three formats can be
driven for real in a browser on a machine without pandoc.

Point NEXTTEX_PANDOC at it.  It reads `-t <writer>` and `-o <out>` off
its argv, writes a file whose bytes name the writer it was asked for, and
appends its argv as one JSON line to the file NEXTTEX_FAKE_PANDOC_LOG
names, so a spec can assert what would have been run.  A source file
whose name contains `broken` fails the way pandoc does when it cannot
read a macro, with a sentence on stderr and a non-zero exit.
"""

import json
import os
import sys


def main(argv: list[str]) -> int:
    log = os.environ.get("NEXTTEX_FAKE_PANDOC_LOG", "")
    if log:
        with open(log, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(argv) + "\n")
    writer = argv[argv.index("-t") + 1] if "-t" in argv else "?"
    out = argv[argv.index("-o") + 1] if "-o" in argv else ""
    source = argv[0] if argv else ""
    if "broken" in source:
        print("Error at \"source\" (line 3, column 1):\nunexpected control sequence \\nothere", file=sys.stderr)
        return 64
    if not out:
        return 2
    with open(out, "w", encoding="utf-8") as handle:
        handle.write(f"fake pandoc wrote {writer} for {os.path.basename(source)}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

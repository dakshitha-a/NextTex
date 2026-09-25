#!/usr/bin/env python3
"""A stand-in for `latexdiff`, so the marked-up PDF can be driven without
installing it: CI has none and neither has the development machine.

Called as `latexdiff --flatten OLD NEW`, as `nexttex/changes.py` calls the
real one, it prints NEW with every line that is not in OLD wrapped in
`\\textbf{}`, which is enough to see the document built from its output
and marked. Each argv is appended as a JSON line to the file
NEXTTEX_FAKE_LATEXDIFF_LOG names, when it names one.
"""

import json
import os
import sys
from pathlib import Path


def main(argv: list[str]) -> int:
    log = os.environ.get("NEXTTEX_FAKE_LATEXDIFF_LOG", "")
    if log:
        with open(log, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(argv) + "\n")
    if len(argv) != 3 or argv[0] != "--flatten":
        print("usage: latexdiff --flatten OLD NEW", file=sys.stderr)
        return 2
    old = set(Path(argv[1]).read_text(encoding="utf-8").splitlines())
    in_body = False
    for line in Path(argv[2]).read_text(encoding="utf-8").splitlines():
        if line.startswith("\\begin{document}"):
            in_body = True
        elif line.startswith("\\end{document}"):
            in_body = False
        elif in_body and line.strip() and line not in old:
            line = f"\\textbf{{{line}}}"
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

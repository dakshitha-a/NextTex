#!/usr/bin/env python3
"""A stand-in for `pandoc`, so the download menu's three formats can be
driven for real in a browser on a machine without pandoc.

Point NEXTTEX_PANDOC at it.  It reads `-f`, `-t <writer>` and `-o <out>`
off its argv and appends its argv as one JSON line to the file
NEXTTEX_FAKE_PANDOC_LOG names, so a spec can assert what would have been
run.  Word and HTML go through pandoc twice, and so does the fake:

- `-t json` writes a document tree holding one image for every
  `\\includegraphics` in the source, the way pandoc's LaTeX reader leaves
  them, with the name exactly as written;
- `-f json` writes a file whose first line names the writer it was asked
  for and the tree's file, and whose second line lists the image sources
  it was handed, so a test sees what the figures became;
- anything else, Markdown's one pass, writes the first line alone.

A source file whose name contains `broken` fails the way pandoc does when
it cannot read a macro, with a sentence on stderr and a non-zero exit.
"""

import json
import os
import re
import sys


def images(node, found):
    if isinstance(node, list):
        for item in node:
            images(item, found)
    elif isinstance(node, dict):
        if node.get("t") == "Image":
            found.append(node["c"][2][0])
        else:
            for value in node.values():
                images(value, found)


def main(argv: list[str]) -> int:
    log = os.environ.get("NEXTTEX_FAKE_PANDOC_LOG", "")
    if log:
        with open(log, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(argv) + "\n")
    reader = argv[argv.index("-f") + 1] if "-f" in argv else "latex"
    writer = argv[argv.index("-t") + 1] if "-t" in argv else "?"
    out = argv[argv.index("-o") + 1] if "-o" in argv else ""
    source = argv[0] if argv else ""
    if "broken" in source:
        print("Error at \"source\" (line 3, column 1):\nunexpected control sequence \\nothere", file=sys.stderr)
        return 64
    if not out:
        return 2
    if writer == "json":
        with open(source, encoding="utf-8", errors="replace") as handle:
            # Comments dropped, as pandoc's reader drops them.
            text = re.sub(r"(?<!\\)%.*", "", handle.read())
        names = re.findall(r"\\includegraphics\s*(?:\[[^\]]*\])?\{([^}]*)\}", text)
        tree = {
            "pandoc-api-version": [1, 23, 1],
            "meta": {},
            "blocks": [
                {"t": "Para", "c": [{"t": "Image", "c": [["", [], []], [], [name, ""]]}]}
                for name in names
            ],
        }
        with open(out, "w", encoding="utf-8") as handle:
            json.dump(tree, handle)
        return 0
    lines = [f"fake pandoc wrote {writer} for {os.path.basename(source)}"]
    if reader == "json":
        with open(source, encoding="utf-8") as handle:
            found: list[str] = []
            images(json.load(handle), found)
        lines.append("images: " + ", ".join(found))
    with open(out, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

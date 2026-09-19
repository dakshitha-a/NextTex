r"""The bibliography styles this TeX has, for `\bibliographystyle{}`.

A style name is a `.bst` file somewhere under a TeX tree's `bibtex/bst/`,
and `kpsewhich` cannot list them, only find one by name.  So the trees
are asked for with `kpsewhich --var-value`, the distribution's, the
local one and the writer's own, and walked once; a TeX Live has a few
hundred and the walk is a few milliseconds, kept for the life of the
process because styles are installed by a package manager, not typed.
Without `kpsewhich` the answer is the four every BibTeX has.
"""

from __future__ import annotations

import functools
import shutil
import subprocess
from pathlib import Path

from .tools import ensure_tex_on_path

FALLBACK = ("abbrv", "alpha", "plain", "unsrt")
TREES = ("TEXMFDIST", "TEXMFLOCAL", "TEXMFHOME")
TIMEOUT = 10
#: A tree is walked at most this deep below `bibtex/bst`; the deepest a
#: distribution puts one is three.
MAX_DEPTH = 6


def _tree(variable: str) -> Path | None:
    try:
        done = subprocess.run(
            ["kpsewhich", f"--var-value={variable}"],
            capture_output=True, text=True, timeout=TIMEOUT,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    value = done.stdout.strip()
    return Path(value) if done.returncode == 0 and value else None


def _walk(root: Path) -> set[str]:
    names: set[str] = set()
    base = root / "bibtex" / "bst"
    if not base.is_dir():
        return names
    stack = [(base, 0)]
    while stack:
        directory, depth = stack.pop()
        try:
            entries = list(directory.iterdir())
        except OSError:
            continue
        for entry in entries:
            if entry.is_dir():
                if depth < MAX_DEPTH:
                    stack.append((entry, depth + 1))
            elif entry.suffix == ".bst":
                names.add(entry.stem)
    return names


@functools.lru_cache(maxsize=1)
def installed() -> list[str]:
    """Every style name this TeX can find, sorted, or the four every
    BibTeX has when `kpsewhich` is not here."""
    ensure_tex_on_path()
    if not shutil.which("kpsewhich"):
        return list(FALLBACK)
    names: set[str] = set()
    for variable in TREES:
        tree = _tree(variable)
        if tree is not None:
            names |= _walk(tree)
    return sorted(names) if names else list(FALLBACK)

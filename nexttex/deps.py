"""Which documents a file belongs to.

A project used to have one compiled document, so the question never arose:
every save rebuilt the only thing there was to rebuild. With a dissertation
and its supplementary information side by side, a save has to rebuild the
documents that actually read the saved file and leave the others alone --
editing `chapter3.tex` must not spend eighteen seconds rebuilding an `esi.pdf`
that has never heard of it.

Nothing here touches the compiler or the server. It reads LaTeX source and
answers two questions: what does this document pull in, and which files in
this project could stand on their own as documents.

The scanning is deliberately shallow. A real TeX parser would have to expand
macros to know what `\\input\\chapterfile` means, and a writer who does that
is not served by a wrong answer delivered confidently -- so an unrecognised
file falls back to a rule that over-builds rather than under-builds, and the
comment on `owners` says which way and why.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path

#: Everything that can pull one file into another.
#:
#: `\\subfile` and `\\includestandalone` matter more than they look: both name
#: a file that carries its own `\\documentclass`, and without them every
#: `figures/plot.tex` in a project using the standalone or subfiles class
#: would be offered as a document to preview in its own right.
SCAN = re.compile(
    r"""
    ^[^%\n]*\\(?:
        (?P<inc>include|input|subfile|includestandalone)\s*\{(?P<incarg>[^}]*)\}
      | (?P<imp>import|subimport|subimportfrom)\s*\{(?P<dir>[^}]*)\}\s*\{(?P<file>[^}]*)\}
      | (?P<bib>bibliography|addbibresource)\s*\{(?P<bibarg>[^}]*)\}
      | (?P<gfx>includegraphics)\s*(?:\[[^\]]*\]\s*)?\{(?P<gfxarg>[^}]*)\}
    )
    """,
    re.M | re.X,
)

#: `\\input foo` without braces is legal and reasonably common in older
#: preambles, and the braced pattern above cannot see it.
BARE_INPUT = re.compile(r"^[^%\n]*\\input\s+([^\s{}\\%]+)", re.M)

DOCUMENTCLASS = re.compile(r"^[^%\n]*\\documentclass", re.M)
BEGIN_DOCUMENT = re.compile(r"^[^%\n]*\\begin\s*\{document\}", re.M)

#: Tried in order against a reference that names no suffix of its own.
SUFFIXES = {
    "inc": (".tex", ".ltx"),
    "imp": (".tex", ".ltx"),
    "bib": (".bib",),
    "gfx": (".pdf", ".png", ".jpg", ".jpeg", ".eps"),
}


def is_standalone(text: str) -> bool:
    """Could this text be compiled on its own?

    Both markers are required. `\\documentclass` alone is satisfied by a
    figure written for the standalone class, which is a document in the
    narrow sense and never one a writer wants a preview tab for.
    """
    return bool(DOCUMENTCLASS.search(text)) and bool(BEGIN_DOCUMENT.search(text))


def references(text: str) -> list[tuple[str, str]]:
    """Every file this text names, as `(kind, reference)` pairs.

    The reference is exactly what was written -- resolving it needs to know
    which file it was written in, which is `resolve`'s job.
    """
    found: list[tuple[str, str]] = []
    for match in SCAN.finditer(text):
        if match.group("inc"):
            found.append(("inc", match.group("incarg")))
        elif match.group("imp"):
            # \import{dir/}{file} -- the two arguments are joined, and the
            # directory is relative to the importing file like any other.
            found.append(("imp", match.group("dir") + match.group("file")))
        elif match.group("bib"):
            # \addbibresource takes one; \bibliography takes a comma list.
            for one in match.group("bibarg").split(","):
                if one.strip():
                    found.append(("bib", one.strip()))
        elif match.group("gfx"):
            found.append(("gfx", match.group("gfxarg")))
    for reference in BARE_INPUT.findall(text):
        found.append(("inc", reference))
    return found


def resolve(root: Path, source: Path, kind: str, reference: str) -> Path | None:
    """Where a reference points, or None if it leaves the project.

    Relative to the referring file first and the project root second, which
    is what TeX itself does. `\\usepackage{amsmath}` and friends are not
    scanned at all: they resolve into the TeX tree, and a dependency that
    lives outside the project is one a writer cannot edit here anyway.
    """
    reference = reference.strip().replace("\\", "/")
    if not reference or reference.startswith("/"):
        return None
    bases = [source.parent, root]
    names = [reference]
    if not Path(reference).suffix:
        names += [reference + suffix for suffix in SUFFIXES.get(kind, (".tex",))]
    for base in bases:
        for name in names:
            candidate = (base / name).resolve()
            try:
                candidate.relative_to(root.resolve())
            except ValueError:
                continue  # escapes the project
            if candidate.is_file():
                return candidate
    return None


class DependencyGraph:
    """What each document reads, cached per file and rebuilt as files change.

    Two layers. The per-file edges are cached against the file's size and
    modification time, so a save re-parses one file rather than the project.
    The document-to-files map is derived from those edges by a walk, and is
    thrown away whenever any edge changes -- on a forty-file thesis that walk
    is a few hundred steps and costs less than deciding whether to do it.
    """

    def __init__(self, root: Path, skip: Callable[[Path], bool] | None = None):
        self.root = root.resolve()
        self._skip = skip or (lambda _: False)
        self._edges: dict[str, tuple[tuple[int, int], list[str]]] = {}
        self._walked: dict[tuple[str, ...], dict[str, set[str]]] = {}

    # -- cache maintenance --------------------------------------------------

    def note_changed(self, relative: str) -> None:
        self._edges.pop(relative, None)
        self._walked.clear()

    def invalidate(self) -> None:
        """Everything. For a rename, a delete, or an upload."""
        self._edges.clear()
        self._walked.clear()

    # -- the graph ----------------------------------------------------------

    def _relative(self, path: Path) -> str | None:
        try:
            return str(path.resolve().relative_to(self.root))
        except ValueError:
            return None

    def _edges_for(self, relative: str) -> list[str]:
        path = self.root / relative
        try:
            stat = path.stat()
            stamp = (stat.st_mtime_ns, stat.st_size)
        except OSError:
            return []
        cached = self._edges.get(relative)
        if cached and cached[0] == stamp:
            return cached[1]
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return []
        out: list[str] = []
        for kind, reference in references(text):
            target = resolve(self.root, path, kind, reference)
            if target is None:
                continue
            name = self._relative(target)
            if name and name not in out:
                out.append(name)
        self._edges[relative] = (stamp, out)
        return out

    def _walk(self, documents: Sequence[str]) -> dict[str, set[str]]:
        """For each document, every file it reads, transitively."""
        key = tuple(documents)
        cached = self._walked.get(key)
        if cached is not None:
            return cached
        result: dict[str, set[str]] = {}
        for document in documents:
            seen = {document}
            queue = [document]
            while queue:
                current = queue.pop()
                for edge in self._edges_for(current):
                    if edge in seen:
                        continue
                    seen.add(edge)
                    # Only .tex files can pull in further files; a .bib or a
                    # figure is a leaf, and opening one to look would be a
                    # wasted read on every walk.
                    if edge.endswith((".tex", ".ltx")):
                        queue.append(edge)
            result[document] = seen
        self._walked[key] = result
        return result

    def owners(self, relative: str, documents: Sequence[str]) -> list[str]:
        """Which of `documents` should be rebuilt when `relative` changes.

        The fallbacks are the interesting part, and they are deliberately
        asymmetric:

        * An unrecognised `.tex` goes to the **first** document only. The
          usual unknown is a file the writer has just created and not yet
          `\\input` anywhere, and attributing it to every document would turn
          one build into several for the commonest case there is.
        * Anything else unrecognised -- a `.bib`, a class or style file, an
          image -- goes to **every** document. Under-attributing an asset
          produces a preview that silently stops updating, which is the worst
          way this feature can fail; over-attributing costs a background
          build nobody is waiting on.
        """
        reach = self._walk(documents)
        matched = [name for name in documents if relative in reach[name]]
        if matched:
            return matched
        if relative.endswith((".tex", ".ltx")):
            return list(documents[:1])
        return list(documents)

    def reverse(self, documents: Sequence[str]) -> dict[str, list[str]]:
        """Every known file mapped to the documents that read it.

        Shipped to the browser so the editor can mark the right preview
        stale the moment a key is pressed, rather than waiting for the
        server to say so a debounce later.
        """
        reach = self._walk(documents)
        out: dict[str, list[str]] = {}
        for document in documents:
            for name in reach[document]:
                out.setdefault(name, []).append(document)
        return out

    def reachable(self, documents: Sequence[str]) -> set[str]:
        """Every file any of these documents reads."""
        reach = self._walk(documents)
        return {name for files in reach.values() for name in files}

    # -- finding documents --------------------------------------------------

    def standalone_candidates(self, documents: Sequence[str]) -> list[str]:
        """Files that could be previewed as documents in their own right.

        A file qualifies when it carries both `\\documentclass` and
        `\\begin{document}`, is not already one of `documents`, and nothing
        already reads it. The last clause is what keeps a subfiles chapter
        and a standalone figure off the list: both are documents by the
        letter of it, and neither is one anybody wants a preview tab for.

        `reachable` includes the documents themselves, which is what excludes
        the ones already registered -- this is a list of what could be added,
        so what is already there does not belong on it.
        """
        read = self.reachable(documents)
        found: list[str] = []
        for path in sorted(self.root.rglob("*")):
            if path.suffix.lower() not in (".tex", ".ltx") or not path.is_file():
                continue
            # Anything hidden, and anything under a hidden directory. This
            # is not tidiness: NextTex writes its own stand-in beside the
            # main file when it builds part of a document, and that file is
            # a copy of main.tex -- so it has a documentclass, nothing reads
            # it, and it was being offered to the writer as a second
            # document to preview. Caught against a real dissertation.
            if any(part.startswith(".") for part in path.relative_to(self.root).parts):
                continue
            if self._skip(path):
                continue
            name = self._relative(path)
            if name is None or name in read:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if is_standalone(text):
                found.append(name)
        return found


def documents_in(root: Path, texts: Iterable[tuple[str, str]]) -> list[str]:
    """The standalone documents among `(relative path, text)` pairs.

    The text-only half of `standalone_candidates`, for callers that have
    already read the files -- `ProjectConfig._guess_main` scores every `.tex`
    in a project and should not read them all twice.
    """
    return [name for name, text in texts if is_standalone(text)]

"""Which PDF on disk is the paper a citation names.

The writer asked for a citation's hover card, and its entry in the typeset
bibliography, to open the paper. Two ways of finding it were ruled out:
a folder name fixed in advance, since writers call it `refs`, `papers`,
`literature` or nothing at all and a thesis buries a PDF several folders
deep; and walking the project over and over, since a project with three
hundred PDFs would be read on a timer for a link it already had.

So a key finds its PDF by evidence, most certain first, and never by its
title, the rule `library.py` already keeps for adding references:

1. a link the writer already made: a paper the References drawer imported,
   whose record holds its key and its path, or the `file` field Zotero,
   JabRef and Mendeley write into the `.bib`;
2. a PDF anywhere in the project named after the key, or after the DOI;
3. a PDF whose own first two pages print the entry's DOI and its title.

The list of the project's PDFs is taken from the file tree once, when the
project opens, and after that only the watcher's events change it. The
third step is the only one that reads a PDF, and it reads each one once:
what it found is kept against the file's size and modification time.

A path the `.bib` names outside the project is honoured only under the
writer's home or a folder the References drawer has read, because the
route that serves it would otherwise serve whatever a downloaded `.bib`
pointed at.
"""

from __future__ import annotations

import json
import re
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from .atomic import write_atomically
from .library import DOI, INVISIBLE, TRAILING, Paper, dois_in, have_pdftotext, title_is_on_the_page
from .symbols import BIB_ENTRY, BIB_FIELD

#: Where step 3's findings are kept, under the project's state directory.
CACHE_NAME = "paper-pdfs.json"

#: Two pages, as the References drawer reads: the DOI is on the first and
#: a long title can wrap onto the second.
PAGES = 2

#: The front matter kept per PDF for the title check, in characters.
KEPT_TEXT = 6000

# A colon or semicolon JabRef escaped, `C\:\\Users`, is part of the path.
_UNESCAPED_SEMI = re.compile(r"(?<!\\);")
_UNESCAPED_COLON = re.compile(r"(?<!\\):")
_DRIVE = re.compile(r"^[A-Za-z]$")


@dataclass
class Link:
    """A key's PDF, and how it was found."""

    key: str
    path: Path
    #: "library", "file", "name" or "doi", for the tests and the docs.
    how: str

    def as_dict(self, root: Path) -> dict:
        try:
            shown = self.path.relative_to(root).as_posix()
            where = "project"
        except ValueError:
            shown = _home_short(self.path)
            where = "outside"
        return {"where": where, "path": shown, "how": self.how}


def _home_short(path: Path) -> str:
    try:
        return "~/" + path.relative_to(Path.home()).as_posix()
    except ValueError:
        return path.as_posix()


def normal_doi(value: str) -> str:
    """A DOI as two DOIs for the same paper compare: no resolver in front,
    no trailing punctuation, no case."""
    value = value.strip()
    value = re.sub(r"^(?:https?://)?(?:dx\.)?doi\.org/", "", value, flags=re.I)
    value = re.sub(r"^doi:\s*", "", value, flags=re.I)
    return value.rstrip(TRAILING).lower()


def attached_paths(value: str) -> list[str]:
    """The paths a `.bib` entry's `file` field names, PDFs only.

    Three shapes are written in the wild, and a field may list several
    separated by semicolons: JabRef's `Description:path:Type`, the same
    with an empty description as Mendeley writes it, and a bare path.
    JabRef escapes a colon or semicolon inside a path with a backslash,
    and a Windows drive letter is a colon of its own.
    """
    found: list[str] = []
    for part in _UNESCAPED_SEMI.split(value):
        pieces = _UNESCAPED_COLON.split(part.strip())
        # A drive letter split off by its colon is joined back on.
        joined: list[str] = []
        for piece in pieces:
            if joined and _DRIVE.match(joined[-1]) and piece[:1] in ("\\", "/"):
                joined[-1] = joined[-1] + ":" + piece
            else:
                joined.append(piece)
        if len(joined) >= 3:
            candidates = [joined[1]]
        else:
            candidates = joined
        for candidate in candidates:
            path = candidate.replace("\\:", ":").replace("\\;", ";").replace("\\\\", "\\").strip()
            if path.lower().endswith(".pdf"):
                found.append(path)
                break
    return found


def bib_entries(text: str) -> list[dict]:
    """Each entry's key, DOI, title and the paths its `file` field names.

    The fields are read raw, unlike the symbol scan's, which strips the
    backslashes a Windows path is made of."""
    entries: list[dict] = []
    for match in BIB_ENTRY.finditer(text):
        start = match.end()
        end = text.find("\n@", start)
        body = text[start : end if end > 0 else len(text)]
        fields = {name.lower(): value.strip() for name, value in BIB_FIELD.findall(body)}
        entries.append({
            "key": match.group(2),
            "doi": normal_doi(re.sub(r"[{}]", "", fields.get("doi", ""))),
            "title": re.sub(r"[{}\\]", "", fields.get("title", "")).strip(),
            "files": attached_paths(fields.get("file", "")),
        })
    return entries


def allowed_outside(path: Path, sources: Iterable[Path], home: Path | None = None) -> bool:
    """May a path outside the project be served? Under the writer's home or
    a folder the References drawer has read, and nowhere else."""
    home = home or Path.home()
    for base in [home, *sources]:
        try:
            path.relative_to(base)
            return True
        except ValueError:
            continue
    return False


def front_text(pdf: Path, timeout: int = 30) -> str:
    """The first pages' text, as `library.text_of` reads it, two pages only."""
    try:
        result = subprocess.run(
            ["pdftotext", "-f", "1", "-l", str(PAGES), str(pdf), "-"],
            capture_output=True, text=True, timeout=timeout,
        )
    except (subprocess.SubprocessError, OSError):
        return ""
    return result.stdout or ""


def _fold(text: str) -> str:
    """Lower case, letters and digits only, words apart: what
    `title_is_on_the_page` compares."""
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))


def _name_dois(name: str) -> set[str]:
    """DOIs a file name carries, with `_` or `-` standing for the slash
    after the registrant, as Zotero and publishers name downloads."""
    stem = name[:-4] if name.lower().endswith(".pdf") else name
    found: set[str] = set()
    for guess in (stem.replace("_", "/"), re.sub(r"^(10\.\d{4,9})-", r"\1/", stem)):
        for match in DOI.finditer(guess):
            found.add(normal_doi(match.group(0)))
    return found


class PaperPdfs:
    """One project's citation keys and the PDFs that are their papers."""

    def __init__(self, root: Path, state_dir: Path):
        self.root = root
        self.cache_path = state_dir / CACHE_NAME
        self._lock = threading.Lock()
        #: The project's PDFs, relative and with forward slashes.
        self.pdfs: set[str] = set()
        self.links: dict[str, Link] = {}
        #: Whether the last answer left an entry with a DOI unmatched, which
        #: is the only reason to read a PDF.
        self.wanting = False
        #: What step 3 read from each PDF: [size, mtime_ns, dois, text].
        self._read: dict[str, list] = self._load()

    # -- the PDF list --------------------------------------------------
    def seed(self, tree: dict) -> None:
        """The PDFs in a `Project.tree()`, which the drawer already walks."""
        found: set[str] = set()

        def walk(node: dict) -> None:
            for child in node.get("children", []):
                if child.get("type") == "dir":
                    walk(child)
                elif str(child.get("path", "")).lower().endswith(".pdf"):
                    found.add(child["path"])

        walk(tree)
        with self._lock:
            self.pdfs = found

    def touched(self, paths: Iterable[str]) -> bool:
        """Fold a watcher event into the list. True when the answer may
        have changed: a PDF came or went or changed, or a `.bib` did."""
        changed = False
        for path in paths:
            name = str(path).replace("\\", "/")
            lower = name.lower()
            if lower.endswith(".bib"):
                changed = True
            elif lower.endswith(".pdf"):
                changed = True
                exists = (self.root / name).is_file()
                with self._lock:
                    if exists:
                        self.pdfs.add(name)
                    else:
                        self.pdfs.discard(name)
        return changed

    # -- matching ------------------------------------------------------
    def resolve(
        self,
        bibs: Iterable[str],
        papers: Iterable[Paper] = (),
        sources: Iterable[str] = (),
        *,
        read: Callable[[Path], str] | None = None,
        home: Path | None = None,
        skip: Iterable[str] = (),
    ) -> dict[str, Link]:
        """Every key the project's `.bib` files hold that has a PDF.

        `bibs` are the bibliographies, relative to the project. `read`
        returns a PDF's front text for step 3; None leaves step 3 to the
        cache alone, which is how the first answer is given at once and
        the slow reading left to `read_pending`. `skip` are PDFs that are
        not papers: a document's own output beside its source."""
        home = home or Path.home()
        source_dirs = [Path(s) for s in sources]
        with self._lock:
            pdfs = sorted(set(self.pdfs) - set(skip))
        entries: list[tuple[dict, Path]] = []
        for bib in bibs:
            path = self.root / bib
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            entries.extend((entry, path.parent) for entry in bib_entries(text))
        root = self.root.resolve()
        links: dict[str, Link] = {}

        def usable(candidate: Path) -> Path | None:
            try:
                real = candidate.resolve()
            except (OSError, ValueError):
                return None
            if not real.is_file() or real.suffix.lower() != ".pdf":
                return None
            try:
                real.relative_to(root)
                return real
            except ValueError:
                pass
            return real if allowed_outside(real, source_dirs, home) else None

        keys = {entry["key"] for entry, _ in entries}

        # 1. Links the writer already made.
        for paper in papers:
            if paper.key in keys and paper.key not in links and paper.path:
                found = usable(Path(paper.path))
                if found:
                    links[paper.key] = Link(paper.key, found, "library")
        by_base: dict[str, list[str]] = {}
        for pdf in pdfs:
            by_base.setdefault(pdf.rsplit("/", 1)[-1].lower(), []).append(pdf)
        for entry, folder in entries:
            key = entry["key"]
            if key in links:
                continue
            for named in entry["files"]:
                raw = Path(named).expanduser()
                tries = [raw] if raw.is_absolute() else [folder / raw, self.root / raw, Path("/") / raw]
                found = next((hit for hit in map(usable, tries) if hit), None)
                if found is None:
                    # JabRef resolves against its own file directory, so the
                    # same name somewhere in the project is the same file.
                    same = by_base.get(raw.name.lower(), [])
                    found = usable(self.root / same[0]) if same else None
                if found:
                    links[key] = Link(key, found, "file")
                    break

        # 2. The file name.
        by_stem: dict[str, str] = {}
        by_doi: dict[str, str] = {}
        for pdf in pdfs:
            name = pdf.rsplit("/", 1)[-1]
            by_stem.setdefault(name[:-4].lower(), pdf)
            for doi in _name_dois(name):
                by_doi.setdefault(doi, pdf)
        for entry, _ in entries:
            key = entry["key"]
            if key in links:
                continue
            pdf = by_stem.get(key.lower()) or (by_doi.get(entry["doi"]) if entry["doi"] else None)
            if pdf:
                links[key] = Link(key, (self.root / pdf).resolve(), "name")

        # 3. The DOI inside the PDF, with its title on the page.
        wanted = [entry for entry, _ in entries if entry["key"] not in links and entry["doi"]]
        self.wanting = bool(wanted)
        if wanted:
            claimed = {link.path for link in links.values()}
            readings = self._readings(
                [pdf for pdf in pdfs if (self.root / pdf).resolve() not in claimed], read
            )
            for entry in wanted:
                for pdf, (dois, text) in readings.items():
                    # A DOI on page one may be one the paper cites, so its
                    # title must be there too; with no title to check, only
                    # the paper's first DOI is believed.
                    if entry["title"]:
                        matched = entry["doi"] in dois and title_is_on_the_page(entry["title"], text, _fold)
                    else:
                        matched = bool(dois) and dois[0] == entry["doi"]
                    if matched:
                        links[entry["key"]] = Link(entry["key"], (self.root / pdf).resolve(), "doi")
                        break
        with self._lock:
            self.links = links
        return links

    def unread(self, skip: Iterable[str] = ()) -> list[str]:
        """The PDFs step 3 has not read yet, or has read an older copy of."""
        with self._lock:
            pdfs = sorted(set(self.pdfs) - set(skip))
        return [pdf for pdf in pdfs if self._stamp(pdf) is not None and not self._fresh(pdf)]

    def read_pending(self, pdfs: Iterable[str], read: Callable[[Path], str] = front_text,
                     stopped: Callable[[], bool] = lambda: False) -> int:
        """Read each PDF's front pages once, and keep what was found."""
        done = 0
        for pdf in pdfs:
            if stopped():
                break
            stamp = self._stamp(pdf)
            if stamp is None:
                continue
            text = INVISIBLE.sub("", read(self.root / pdf))
            dois = [normal_doi(doi) for doi in dois_in(text, pdf.rsplit("/", 1)[-1])]
            with self._lock:
                self._read[pdf] = [stamp[0], stamp[1], dois, text[:KEPT_TEXT]]
            done += 1
        if done:
            self._save()
        return done

    def _readings(self, pdfs: list[str], read: Callable[[Path], str] | None) -> dict[str, tuple[list[str], str]]:
        if read is not None:
            stale = [pdf for pdf in pdfs if not self._fresh(pdf)]
            if stale:
                self.read_pending(stale, read)
        out: dict[str, tuple[list[str], str]] = {}
        with self._lock:
            for pdf in pdfs:
                held = self._read.get(pdf)
                if held and self._fresh(pdf, held):
                    out[pdf] = (held[2], held[3])
        return out

    # -- answering -----------------------------------------------------
    def as_dict(self) -> dict:
        with self._lock:
            links = dict(self.links)
        return {key: link.as_dict(self.root.resolve()) for key, link in sorted(links.items())}

    def path_for(self, key: str) -> Path | None:
        """The file to serve for a key, checked again at the moment it is
        asked for: the index may be a few seconds older than the disk."""
        with self._lock:
            link = self.links.get(key)
        if link is None:
            return None
        path = link.path
        return path if path.is_file() and path.suffix.lower() == ".pdf" else None

    # -- the cache -----------------------------------------------------
    def _stamp(self, pdf: str) -> tuple[int, int] | None:
        try:
            info = (self.root / pdf).stat()
        except OSError:
            return None
        return info.st_size, info.st_mtime_ns

    def _fresh(self, pdf: str, held: list | None = None) -> bool:
        held = held if held is not None else self._read.get(pdf)
        stamp = self._stamp(pdf)
        return bool(held) and stamp is not None and (held[0], held[1]) == stamp

    def _load(self) -> dict[str, list]:
        try:
            data = json.loads(self.cache_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return {k: v for k, v in data.items() if isinstance(v, list) and len(v) == 4}

    def _save(self) -> None:
        with self._lock:
            # What is no longer in the project is let go.
            kept = {k: v for k, v in self._read.items() if k in self.pdfs}
            self._read = kept
            text = json.dumps(kept)
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            write_atomically(self.cache_path, text)
        except OSError:
            pass


def can_read() -> bool:
    """Step 3 needs pdftotext; without it steps 1 and 2 still answer."""
    return have_pdftotext()


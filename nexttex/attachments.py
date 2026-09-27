"""Files a writer hands to the agent with a question: pasted, dropped or
picked, or dragged from the file tree.

The bytes go on disk first and the model is told the path, rather than the
file travelling in the question. That is not a performance decision, it is
the one section 27 of the design document was written about: an image on
this wire is base64, a third larger than the file, and the `PostToolUse`
hook makes the CLI ship a tool result twice, which is how a 290 KB figure
measured 1,151,564 bytes and killed the reader mid-turn. The ceiling is
sixty-four megabytes now and that incident is still the reason not to put a
file in a place where it will be copied.

Three things fall out of doing it this way, and all three are better than
the alternative. The agent already reads files from disk with its own
`Read`, which is the path that got hardened, so there is no second path to
keep working. The transcript records a filename rather than a megabyte of
base64. And a conversation that resumes by session id does not depend on
the bytes being replayable, because they are still where they were.

They land in `.nexttex/attachments/`, not in the project's own folders. A
pasted screenshot of a broken table is a thing somebody is asking about, not
a thing they are keeping, and putting it in `figures/` would leave the
project's own directory full of them. Something they do mean to keep goes
into the file tree instead, which takes any file.

Not every kind can be read as it is. The Claude CLI's Read takes text,
PNG, JPEG, GIF, WebP and PDF, and the OpenAI provider's `read_file` takes
text alone. So a Word, Excel or PowerPoint file, or a PDF, gets its text
written beside it, and a picture in a format neither can open gets a PNG,
both through `nexttex/extract.py`; the model is told the companion's path
with the file's. A file dragged from the tree is pointed to by its project
path and gets the same companion, kept here by its content's hash.
"""

from __future__ import annotations

import hashlib
import re
import time
from dataclasses import dataclass
from pathlib import Path

from . import extract

#: What may go with a question, by suffix, and what kind of thing it is.
#: The composer's `ATTACHABLE` in `frontend/src/panes/file-kinds.ts` is the
#: same list, and a vitest holds the two together. By suffix rather than by
#: content type, because a browser names a `.py`, a `.md` or a `.heic` with
#: whatever the machine it runs on believes, often nothing.
SUFFIXES = {
    ".pdf": "document",
    ".docx": "document",
    ".xlsx": "document",
    ".pptx": "document",
    ".png": "picture",
    ".jpg": "picture",
    ".jpeg": "picture",
    ".gif": "picture",
    ".webp": "picture",
    ".svg": "picture",
    ".tif": "picture",
    ".tiff": "picture",
    ".bmp": "picture",
    ".heic": "picture",
    ".heif": "picture",
    ".avif": "picture",
    ".md": "text",
    ".markdown": "text",
    ".txt": "text",
    ".py": "text",
    ".r": "text",
    ".m": "text",
    ".tex": "text",
    ".bib": "text",
    ".csv": "text",
    ".tsv": "text",
    ".json": "text",
    ".yml": "text",
    ".yaml": "text",
    ".toml": "text",
    ".dat": "text",
}

#: A pasted picture often arrives as `image.png` or with no name at all, so
#: its content type is the fallback for the suffix.
KINDS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

#: Per file, by kind. The upload path allows 256 MB, which is right for a
#: dataset and wrong for this: the model has its own limit on a picture, so
#: a 20 MB screenshot is a failed turn rather than a slow one, and the
#: browser downscales before it gets here. A document is read as text, so a
#: long PDF or a deck with its pictures in may be larger. Refused with a
#: sentence rather than attempted.
LIMITS = {
    "picture": 8 * 1024 * 1024,
    "document": 32 * 1024 * 1024,
    "text": 8 * 1024 * 1024,
}
LIMIT = LIMITS["picture"]

#: How many things may go with one question, and how many of them
#: pictures. A question about six screenshots is a question that wants
#: breaking up; ten documents is a reading list.
MOST = 10
MOST_PICTURES = 6

#: What each kind is called in the sentence the model reads.
NAMES = {
    ".pdf": "a PDF",
    ".docx": "a Word document",
    ".xlsx": "an Excel workbook",
    ".pptx": "a PowerPoint deck",
}


def directory(state_dir: Path) -> Path:
    return state_dir / "attachments"


def suffix_for(filename: str, content_type: str = "") -> str | None:
    """The suffix a file is kept under, or None when it cannot go."""
    suffix = Path(filename or "").suffix.lower()
    if suffix in SUFFIXES:
        return suffix
    if not suffix:
        return KINDS.get((content_type or "").split(";")[0].strip().lower())
    return None


def kind_of(path: str) -> str | None:
    return SUFFIXES.get(Path(path).suffix.lower())


def _stem(filename: str) -> str:
    """The original name's stem, kept readable and safe in a file name."""
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(filename or "").stem).strip("-.")
    return stem[:40]


def keep(state_dir: Path, data: bytes, suffix: str, filename: str = "") -> tuple[str, str]:
    """Write one file, and its companion where it needs one, and return
    its project-relative path and its name.

    Content addressed, like everything else this app keeps: pasting the same
    screenshot twice costs one file. The name carries the date and the
    original name rather than the hash alone, because these are the one
    kind of file a writer may go looking for in a folder, and because the
    model reads "reviewer-notes" better than a run of hex.
    """
    digest = hashlib.sha256(data).hexdigest()[:12]
    stem = _stem(filename)
    name = f"{time.strftime('%Y-%m-%d')}-{digest}{'-' + stem if stem else ''}{suffix}"
    target = directory(state_dir)
    target.mkdir(parents=True, exist_ok=True)
    path = target / name
    if not path.exists():
        part = path.with_name(path.name + ".part")
        part.write_bytes(data)
        part.replace(path)
    companion(path, path)
    return f".nexttex/attachments/{name}", name


def companion(source: Path, beside: Path) -> Path | None:
    """The readable companion of `source`, written next to `beside` as
    `<name>.txt` or `<name>.png`, or None when it needs none or none could
    be made. Made once: an existing companion is returned as it is."""
    suffix = source.suffix.lower()
    if suffix in NAMES:
        out = beside.with_name(beside.name + ".txt")
        if out.is_file():
            return out
        text, _pages = extract.text_of(source)
        if not text.strip():
            return None
        part = out.with_name(out.name + ".part")
        part.write_text(text, encoding="utf-8")
        part.replace(out)
        return out
    if suffix in extract.PICTURES and suffix not in extract.SEEN:
        out = beside.with_name(beside.name + ".png")
        if out.is_file():
            return out
        return out if extract.picture_of(source, out) else None
    return None


@dataclass
class Handed:
    """One thing that goes with a question, as the model is told of it."""

    path: str
    kind: str | None
    readable: str | None = None
    folder: bool = False


def attached(state_dir: Path, names: list) -> list[Handed]:
    """The attachments a question names, each checked against the
    directory rather than trusted: this is a list of strings out of an HTTP
    body, and the one thing it must not become is a way to make the agent
    read an arbitrary path. So only the base name is used, and the path the
    model is told is rebuilt from it."""
    held = directory(state_dir)
    out: list[Handed] = []
    for name in names:
        if not isinstance(name, str):
            continue
        base = Path(name).name
        path = held / base
        if not base or kind_of(base) is None or not path.is_file():
            continue
        extra = companion(path, path)
        out.append(Handed(
            path=f".nexttex/attachments/{base}",
            kind=kind_of(base),
            readable=f".nexttex/attachments/{extra.name}" if extra else None,
        ))
    return _trim(out)


def pointed(state_dir: Path, root: Path, resolved: list[tuple[Path, str]]) -> list[Handed]:
    """Files and folders in the project the writer dragged from the tree,
    already resolved inside the project by the route. A document or a
    picture the model cannot open gets its companion here, filed by the
    content's hash so an edited file gets a fresh one."""
    out: list[Handed] = []
    held = directory(state_dir)
    for path, relative in resolved:
        if path.is_dir():
            out.append(Handed(path=relative.rstrip("/") + "/", kind=None, folder=True))
            continue
        if not path.is_file():
            continue
        extra = None
        suffix = path.suffix.lower()
        if suffix in NAMES or (suffix in extract.PICTURES and suffix not in extract.SEEN):
            try:
                digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
            except OSError:
                digest = ""
            if digest:
                held.mkdir(parents=True, exist_ok=True)
                beside = held / f"project-{digest}-{_stem(path.name)}{suffix}"
                extra = companion(path, beside)
        out.append(Handed(
            path=relative,
            kind=kind_of(path.name),
            readable=f".nexttex/attachments/{extra.name}" if extra else None,
        ))
    return out[:MOST]


def _trim(items: list[Handed]) -> list[Handed]:
    kept: list[Handed] = []
    pictures = 0
    for item in items:
        if item.kind == "picture":
            if pictures >= MOST_PICTURES:
                continue
            pictures += 1
        kept.append(item)
    return kept[:MOST]


def _line(item: Handed) -> str:
    if item.folder:
        return f"- {item.path} (a folder)"
    suffix = Path(item.path).suffix.lower()
    if suffix in NAMES:
        what = NAMES[suffix]
        if item.readable:
            return f"- {item.path}, {what}; its text is in {item.readable}"
        return f"- {item.path}, {what}; its text could not be taken out, so read it as it is if you can"
    if item.kind == "picture":
        if suffix in extract.SEEN:
            return f"- {item.path}, a picture"
        if item.readable:
            return f"- {item.path}, a picture; a PNG of it is at {item.readable}"
        return f"- {item.path}, a picture in a format that could not be converted here, so it cannot be looked at"
    return f"- {item.path}"


def sentence(given: list[Handed], pointed_to: list[Handed] | None = None) -> str:
    """What the model is told, above the question.

    Named rather than described, so the model reads them rather than
    guessing at them. An attachment is told plainly to be the writer's own
    rather than part of the project: a screenshot of somebody else's table
    is not a file it should be editing. A file from the tree is the
    project's, and is named as that.
    """
    parts: list[str] = []
    if given:
        noun = "a file" if len(given) == 1 else f"{len(given)} files"
        them = "it" if len(given) == 1 else "each"
        parts.append(
            f"The writer attached {noun}:\n"
            + "\n".join(_line(item) for item in given)
            + f"\nRead {them} before answering. "
            + ("It is something they are showing you, not a file of theirs to edit."
               if len(given) == 1 else
               "They are things they are showing you, not files of theirs to edit.")
        )
    if pointed_to:
        noun = "a file" if len(pointed_to) == 1 else f"{len(pointed_to)} files"
        if all(item.folder for item in pointed_to):
            noun = "a folder" if len(pointed_to) == 1 else f"{len(pointed_to)} folders"
        parts.append(
            f"The writer points you to {noun} in the project:\n"
            + "\n".join(_line(item) for item in pointed_to)
            + "\nRead what you need of them before answering."
        )
    return "\n\n".join(parts)

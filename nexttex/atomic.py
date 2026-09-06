"""Writing a file without ever leaving it half-written.

The idiom -- write a sibling temp file, then rename it over the target --
appeared eight times across three modules, each copy slightly different and
none of them cleaning up after itself.  When the target turned out to be a
directory, the rename raised, the request became a 500, and the temp file
stayed in the project where the file tree would show it.
"""

from __future__ import annotations

from pathlib import Path

SUFFIX = ".nexttex-tmp"


class NotAFile(Exception):
    """The target exists and is not something we can write over."""


def write_atomically(
    target: Path,
    data: str | bytes,
    *,
    encoding: str = "utf-8",
    mode: int | None = None,
) -> None:
    """Replace `target` with `data`, or leave it exactly as it was.

    `mode` is applied to the temporary file *before* the rename, so a file
    that holds a credential is never readable by anyone else, not even for
    the instant between being written and being chmod'ed.
    """
    if target.is_dir():
        raise NotAFile(f"{target.name} is a folder, not a file")
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(target.name + SUFFIX)
    try:
        if isinstance(data, str):
            temp.write_text(data, encoding=encoding)
        else:
            temp.write_bytes(data)
        if mode is not None:
            temp.chmod(mode)
        temp.replace(target)
    except OSError:
        # Never leave the scratch file behind: the tree would show it, and
        # the next save would trip over it.
        temp.unlink(missing_ok=True)
        raise


def read_text(target: Path) -> str | None:
    """The file's text, or None if it cannot be read as text."""
    try:
        return target.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def read_bytes(target: Path) -> bytes | None:
    """The file's exact bytes, or None if it cannot be read at all.

    What `read_text` is for a chapter, this is for a figure: a version of
    a PNG that has been through a UTF-8 decode is not that PNG any more.
    """
    try:
        return target.read_bytes()
    except OSError:
        return None


def unique_name(target: Path, tag: str = "") -> Path:
    """A path beside `target` that nothing occupies yet.

    One rule, in one place, because the string it produces is quoted back
    to the user before the file is written -- the upload chooser says "the
    new one comes in as plot (2).png" and then the server has to actually
    call it that.  Two implementations of this would drift, and the drift
    would be a sentence that lies.

    `tag` names why the copy exists: the trash restores as
    `plot (restored).png`, an upload that keeps both writes `plot (2).png`.
    """
    stem, suffix = target.stem, target.suffix
    inside = f" ({tag})" if tag else " (2)"
    candidate = target.with_name(f"{stem}{inside}{suffix}")
    index = 2 if tag else 3
    while candidate.exists():
        inside = f" ({tag} {index})" if tag else f" ({index})"
        candidate = target.with_name(f"{stem}{inside}{suffix}")
        index += 1
    return candidate

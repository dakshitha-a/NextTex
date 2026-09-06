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

r"""A project that exists somewhere else, brought here into a new folder.

Three ways: a zip somebody sent, the source arXiv keeps for a paper, and a
git repository.  Each ends in the same place, a folder that did not exist
a moment ago and is registered as a project, and the folder is refused if
it already holds anything, exactly as creating a blank project refuses it.

An archive is the same channel as an upload and gets the same fence.
`is_control_path` names what a project must not receive from outside,
`.git`, `.claude`, `.nexttex`, a `latexmkrc`, a `Makefile`, an `.envrc`,
because each is something that runs, and a zip that carries a
`.claude/settings.json` is a hook waiting for the agent to start.  Those
entries are skipped and named in the answer rather than refused whole,
since the paper beside them is what the writer wanted.  A clone brings
`.git` by necessity; that is the one control directory this way in
accepts, and the reasoning in `project.py` about a cloned folder being
somebody else's already covers it.

Nothing about an archive is trusted: not the size its headers claim, not
its entry count, not a name with `..` in it, not a symlink.  The caps are
enforced while writing, because headers can lie.
"""

from __future__ import annotations

import gzip
import io
import os
import re
import shutil
import tarfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

from .project import is_control_path

#: The whole unpacked project may be this large, and have this many
#: entries.  A thesis with its figures is tens of megabytes; a gigabyte
#: is a zip bomb or a mistake.
MAX_BYTES = 1024 * 1024 * 1024
MAX_ENTRIES = 10_000
#: What arXiv is allowed to send back for one paper.
ARXIV_MAX_BYTES = 200 * 1024 * 1024
ARXIV_TIMEOUT = 60
ARXIV_BASE = "https://arxiv.org"
#: The agent string arXiv asks automated clients to carry.
USER_AGENT = "NextTex (https://github.com/dakshitha-a/NextTex)"

#: An arXiv id in its two spellings, new (`2301.01234`, `2301.01234v2`) and
#: old (`math/0601001`, `cs.LG/0601001v1`), bare or inside an abs, pdf or
#: e-print URL.
ARXIV_ID = re.compile(
    r"^(?:https?://(?:www\.)?arxiv\.org/(?:abs|pdf|e-print)/)?"
    r"(?P<id>(?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Z]{2})?/\d{7}))(?P<version>v\d+)?(?:\.pdf)?/?$"
)
#: A git URL this will clone: a transport that reaches a host.  `file://`,
#: a bare path and git's `ext::` transport are not among them, because a
#: string from a form must not name a place on this machine or a command.
GIT_URL = re.compile(
    r"^(?:(?:https?|ssh|git)://[A-Za-z0-9._~%:@/?#\[\]!$&'()*+,;=-]+"
    r"|[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[A-Za-z0-9._~%/+-]+)$"
)


class ArriveError(ValueError):
    """Something about what was handed over, in a sentence for the form."""


@dataclass
class Unpacked:
    written: int = 0
    bytes: int = 0
    #: The entries left out because they would run, by name.
    skipped: list[str] = field(default_factory=list)


def arxiv_id(text: str) -> str | None:
    """The id in what was typed, with its version if one was, or None."""
    found = ARXIV_ID.match(text.strip())
    if not found:
        return None
    return found.group("id") + (found.group("version") or "")


def is_git_url(text: str) -> bool:
    text = text.strip()
    return bool(GIT_URL.match(text)) and not text.startswith("-")


def _inside(name: str) -> PurePosixPath | None:
    """The entry's path relative to the folder, or None when it is not
    one: absolute, with `..`, or empty."""
    posix = PurePosixPath(name.replace("\\", "/"))
    if posix.is_absolute() or not posix.parts or ".." in posix.parts:
        return None
    if any(part in ("", ".") for part in posix.parts):
        posix = PurePosixPath(*[part for part in posix.parts if part not in ("", ".")])
        if not posix.parts:
            return None
    return posix


def _root_folder(names: list[PurePosixPath]) -> str | None:
    """The one top-level folder every entry is under, or None.  A zip
    made by zipping a folder has one; the folder is what the writer
    wants, not a folder inside the folder."""
    heads = {path.parts[0] for path in names}
    if len(heads) != 1:
        return None
    head = heads.pop()
    if any(len(path.parts) == 1 for path in names):
        return None
    return head


def _write(target: Path, source, state: Unpacked, budget: int) -> None:
    """Copy `source` to `target` in chunks, counting against the budget."""
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "wb") as out:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            state.bytes += len(chunk)
            if state.bytes > budget:
                out.close()
                raise ArriveError("the archive unpacks to more than a gigabyte, which is not a paper")
            out.write(chunk)


def unpack_zip(data: bytes | Path, into: Path) -> Unpacked:
    """Unpack a zip into an empty folder, with the fence above."""
    state = Unpacked()
    opened = zipfile.ZipFile(io.BytesIO(data) if isinstance(data, bytes) else data)
    with opened as archive:
        infos = [info for info in archive.infolist() if not info.filename.endswith("/")]
        if len(infos) > MAX_ENTRIES:
            raise ArriveError(f"the archive has more than {MAX_ENTRIES} files")
        paths = [_inside(info.filename) for info in infos]
        strip = _root_folder([path for path in paths if path is not None])
        for info, path in zip(infos, paths):
            if path is None:
                state.skipped.append(info.filename)
                continue
            # A symlink in a zip has its type in the external attributes'
            # high bits; following one is how an entry reaches outside.
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                state.skipped.append(info.filename)
                continue
            if strip:
                path = PurePosixPath(*path.parts[1:])
            if is_control_path(Path(*path.parts)):
                state.skipped.append(str(path))
                continue
            with archive.open(info) as source:
                _write(into / Path(*path.parts), source, state, MAX_BYTES)
            state.written += 1
    return state


def unpack_tar(data: bytes, into: Path) -> Unpacked:
    """Unpack a tar, gzipped or not, with the same fence as a zip."""
    state = Unpacked()
    try:
        archive = tarfile.open(fileobj=io.BytesIO(data), mode="r:*")
    except tarfile.TarError as error:
        raise ArriveError(f"not an archive: {error}")
    with archive:
        members = [member for member in archive.getmembers() if member.isfile()]
        if len(members) > MAX_ENTRIES:
            raise ArriveError(f"the archive has more than {MAX_ENTRIES} files")
        paths = [_inside(member.name) for member in members]
        strip = _root_folder([path for path in paths if path is not None])
        for member, path in zip(members, paths):
            if path is None:
                state.skipped.append(member.name)
                continue
            if strip:
                path = PurePosixPath(*path.parts[1:])
            if is_control_path(Path(*path.parts)):
                state.skipped.append(str(path))
                continue
            source = archive.extractfile(member)
            if source is None:
                continue
            _write(into / Path(*path.parts), source, state, MAX_BYTES)
            state.written += 1
        # Links and devices are never files above, so they are never
        # written; a link is named so the writer knows it was there.
        for member in archive.getmembers():
            if member.issym() or member.islnk():
                state.skipped.append(member.name)
    return state


def _arxiv_base() -> str:
    """The host, or the test's stand-in from `NEXTTEX_ARXIV_BASE`."""
    return os.environ.get("NEXTTEX_ARXIV_BASE", "").strip().rstrip("/") or ARXIV_BASE


def fetch_arxiv(identifier: str) -> bytes:
    """What arXiv keeps for a paper: the e-print, as bytes."""
    import requests

    url = f"{_arxiv_base()}/e-print/{identifier}"
    try:
        answer = requests.get(
            url, headers={"User-Agent": USER_AGENT}, timeout=ARXIV_TIMEOUT, stream=True,
        )
    except requests.RequestException as error:
        raise ArriveError(f"could not reach arXiv: {error}")
    if answer.status_code == 404:
        raise ArriveError(f"arXiv has no paper {identifier}")
    if answer.status_code != 200:
        raise ArriveError(f"arXiv answered {answer.status_code}")
    chunks: list[bytes] = []
    total = 0
    for chunk in answer.iter_content(1024 * 1024):
        total += len(chunk)
        if total > ARXIV_MAX_BYTES:
            raise ArriveError("arXiv's source for this paper is over 200 MB")
        chunks.append(chunk)
    return b"".join(chunks)


def unpack_arxiv(data: bytes, identifier: str, into: Path) -> Unpacked:
    """arXiv's e-print is one of three things: a gzipped tar of the
    source, a gzipped single file when the paper is one `.tex`, or the
    PDF when the author submitted only that, which has no source to
    edit and is refused with a sentence rather than unpacked as one."""
    if data.startswith(b"%PDF"):
        raise ArriveError(f"arXiv has only the PDF for {identifier}; there is no source to edit")
    if data[:2] == b"\x1f\x8b":
        # Inflated in chunks against the budget rather than in one call:
        # a gzip inflates a thousandfold, and the cap has to be seen
        # before the memory is spent.
        pieces: list[bytes] = []
        total = 0
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
                while True:
                    chunk = stream.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_BYTES:
                        raise ArriveError("the source unpacks to more than a gigabyte, which is not a paper")
                    pieces.append(chunk)
        except (OSError, EOFError) as error:
            raise ArriveError(f"could not read what arXiv sent: {error}")
        inflated = b"".join(pieces)
    else:
        inflated = data
    if inflated.startswith(b"%PDF"):
        raise ArriveError(f"arXiv has only the PDF for {identifier}; there is no source to edit")
    try:
        with tarfile.open(fileobj=io.BytesIO(inflated), mode="r:") as _probe:
            pass
        is_tar = True
    except tarfile.TarError:
        is_tar = False
    if is_tar:
        return unpack_tar(inflated, into)
    # One file: the paper's own source, named after the id since the
    # archive carries no name.
    state = Unpacked()
    stem = identifier.replace("/", "-")
    _write(into / f"{stem}.tex", io.BytesIO(inflated), state, MAX_BYTES)
    state.written = 1
    return state


def empty_folder(path: str) -> Path:
    """The folder to arrive in, made if absent, refused if it holds
    anything: the same rule as creating a blank project."""
    root = Path(path).expanduser()
    if not root.is_absolute():
        root = Path.home() / root
    if root.exists() and any(root.iterdir()):
        raise ArriveError(f"{root} already has files in it")
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise ArriveError(f"could not make that folder: {error}")
    return root


def discard(root: Path) -> None:
    """A folder an arrival was unpacking into when it failed, removed so
    the next try finds it empty."""
    shutil.rmtree(root, ignore_errors=True)

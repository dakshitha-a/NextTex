"""Images a writer hands to the agent, by pasting, dropping or picking one.

The bytes go on disk first and the model is told the path, rather than the
image travelling in the question. That is not a performance decision, it is
the one section 27 of the design document was written about: an image on
this wire is base64, a third larger than the file, and the `PostToolUse`
hook makes the CLI ship a tool result twice, which is how a 290 KB figure
measured 1,151,564 bytes and killed the reader mid-turn. The ceiling is
sixty-four megabytes now and that incident is still the reason not to put an
image in a place where it will be copied.

Three things fall out of doing it this way, and all three are better than
the alternative. The agent already reads images from disk with its own
`Read`, which is the path that got hardened, so there is no second image
path to keep working. The transcript records a filename rather than a
megabyte of base64. And a conversation that resumes by session id does not
depend on the bytes being replayable, because they are still where they
were.

They land in `.nexttex/attachments/`, not in the project's own folders. A
pasted screenshot of a broken table is a thing somebody is asking about, not
a thing they are keeping, and putting it in `figures/` would leave the
project's own directory full of them. Something they do mean to keep goes
through the ordinary upload instead.
"""

from __future__ import annotations

import hashlib
import time
from pathlib import Path

#: What the model can actually look at. Deliberately short: this is not the
#: upload path, which takes anything, and a file the model cannot read is
#: better refused here than turned into a tool call that fails.
KINDS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

#: Per image. The upload path allows 256 MB, which is right for a dataset
#: and wrong for this: the model has its own limit, so a 20 MB screenshot is
#: a failed turn rather than a slow one, and the browser downscales before
#: it gets here. Refused with a sentence rather than attempted.
LIMIT = 8 * 1024 * 1024

#: How many may be waiting at once. A question about six screenshots is a
#: question that wants breaking up.
MOST = 6


def directory(state_dir: Path) -> Path:
    return state_dir / "attachments"


def keep(state_dir: Path, data: bytes, kind: str) -> tuple[str, str]:
    """Write one image and return its project-relative path and its name.

    Content addressed, like everything else this app keeps: pasting the same
    screenshot twice costs one file. The name carries the date rather than
    the hash alone, because these are the one kind of file a writer may go
    looking for in a folder and a directory of hex is unreadable.
    """
    suffix = KINDS[kind]
    digest = hashlib.sha256(data).hexdigest()[:12]
    name = f"{time.strftime('%Y-%m-%d')}-{digest}{suffix}"
    target = directory(state_dir)
    target.mkdir(parents=True, exist_ok=True)
    path = target / name
    if not path.exists():
        path.write_bytes(data)
    return f".nexttex/attachments/{name}", name


def sentence(paths: list[str]) -> str:
    """What the model is told, above the question.

    Named as attachments rather than described, so the model reads them
    rather than guessing at them, and told plainly that they are the
    writer's own rather than part of the project: a screenshot of somebody
    else's table is not a file it should be editing.
    """
    if not paths:
        return ""
    if len(paths) == 1:
        return (
            f"The writer attached an image: {paths[0]}\n"
            "Read it before answering. It is something they are showing "
            "you, not a file of theirs to edit."
        )
    listed = "\n".join(f"- {path}" for path in paths)
    return (
        f"The writer attached {len(paths)} images:\n{listed}\n"
        "Read them before answering. They are things they are showing you, "
        "not files of theirs to edit."
    )

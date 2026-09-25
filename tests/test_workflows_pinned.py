"""Every action a workflow uses is pinned to a commit.

A tag such as `@v4` is a name the action's owner can move, and the release
workflow runs with permission to write this repository's contents. The
probe (Q-037) found every `uses:` line named by a moving tag. Each is a
full commit hash now, with the version it was in a comment, and this keeps
a new line from arriving unpinned.
"""

import re
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[1] / ".github" / "workflows"
USES = re.compile(r"^\s*-?\s*uses:\s*(\S+)", re.M)


def test_every_action_is_pinned_to_a_commit():
    found = []
    for workflow in sorted(WORKFLOWS.glob("*.yml")):
        for action in USES.findall(workflow.read_text()):
            if action.startswith("./"):
                continue
            ref = action.rpartition("@")[2]
            if not re.fullmatch(r"[0-9a-f]{40}", ref):
                found.append(f"{workflow.name}: {action}")
    assert not found, "unpinned: " + ", ".join(found)

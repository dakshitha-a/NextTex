"""The fence.

Edits inside the writing project happen directly; everything else asks.  This
is the security boundary of the whole app, and it is enforced in a PreToolUse
hook because the documented `can_use_tool` callback does not fire for tools
that resolve to "allowed" -- which was discovered the hard way, by watching
Bash run unprompted.
"""

import asyncio

import pytest

from nexttex.agent import ProjectAgent


def agent(tmp_path):
    project = tmp_path / "project"
    (project / ".nexttex").mkdir(parents=True)
    (project / "main.tex").write_text("x", encoding="utf-8")
    return ProjectAgent(project, project / ".nexttex")


def decision(result: dict) -> str:
    return result["hookSpecificOutput"]["permissionDecision"]


def hook(agent, tool, tool_input):
    return asyncio.run(agent._pre_tool({"tool_name": tool, "tool_input": tool_input}, None, None))


def test_reading_is_never_asked_about(tmp_path):
    fence = agent(tmp_path)
    assert decision(hook(fence, "Read", {"file_path": "main.tex"})) == "allow"


def test_writing_inside_the_project_is_allowed(tmp_path):
    fence = agent(tmp_path)
    target = fence.root / "chapters" / "two.tex"
    target.parent.mkdir(parents=True)
    target.write_text("before", encoding="utf-8")
    assert decision(hook(fence, "Write", {"file_path": str(target)})) == "allow"


def test_writing_outside_the_project_is_not(tmp_path):
    fence = agent(tmp_path)
    outside = tmp_path / "elsewhere.tex"
    outside.write_text("x", encoding="utf-8")
    fence._ask_user = _refuse
    assert decision(hook(fence, "Write", {"file_path": str(outside)})) == "deny"


def test_a_symlink_out_of_the_project_is_not_inside_it(tmp_path):
    """The obvious attack is `..`; this is the one that is easy to forget."""
    fence = agent(tmp_path)
    secret = tmp_path / "secret.tex"
    secret.write_text("x", encoding="utf-8")
    link = fence.root / "innocent.tex"
    link.symlink_to(secret)
    fence._ask_user = _refuse
    assert decision(hook(fence, "Write", {"file_path": str(link)})) == "deny"


def test_a_shell_command_always_asks(tmp_path):
    fence = agent(tmp_path)
    fence._ask_user = _refuse
    assert decision(hook(fence, "Bash", {"command": "rm -rf /"})) == "deny"


def test_nexttex_own_tools_need_no_card(tmp_path):
    """They can only touch the project; a card for them is a card for
    nothing, and a card for nothing teaches people to click Allow."""
    fence = agent(tmp_path)
    for tool in (
        "mcp__nexttex__insert_at_cursor",
        "mcp__nexttex__find_papers",
        "mcp__nexttex__add_reference",
    ):
        assert decision(hook(fence, tool, {})) == "allow"


def test_an_allowed_write_is_snapshotted_so_undo_has_something_to_restore(tmp_path):
    fence = agent(tmp_path)
    target = fence.root / "main.tex"
    hook(fence, "Edit", {"file_path": str(target)})
    assert fence._file_snapshots[str(target.resolve())] == "x"


async def _refuse(tool_name, tool_input):
    return "deny"


def test_reading_inside_the_project_is_free(tmp_path):
    fence = agent(tmp_path)
    assert decision(hook(fence, "Read", {"file_path": "main.tex"})) == "allow"


def test_reading_outside_the_project_asks(tmp_path):
    """A session scoped to a writing project should stay in it.  The app's
    own source sits elsewhere on the same disk, and a thesis session has no
    business reading it without being asked."""
    fence = agent(tmp_path)
    outside = tmp_path / "elsewhere" / "secrets.py"
    outside.parent.mkdir()
    outside.write_text("x", encoding="utf-8")
    fence._ask_user = _refuse
    assert decision(hook(fence, "Read", {"file_path": str(outside)})) == "deny"


def test_a_search_with_no_path_stays_in_the_project(tmp_path):
    fence = agent(tmp_path)
    assert decision(hook(fence, "Grep", {"pattern": "cite"})) == "allow"

"""The OpenAI provider, without an OpenAI account.

There is no key to test with, which makes this the part of the codebase
most likely to be wrong and least likely to be caught being wrong.  So the
transport is stubbed and everything above it runs for real: the streaming
parser, the tool loop, the path fence, the edits, the usage accounting and
the event vocabulary the browser reads.

What this cannot tell you is whether OpenAI still returns the shapes these
stubs replay.  That is the same honest limit the Anthropic side has, and
`tests/test_live_agent.py` is where a live check belongs for either.
"""

import asyncio
import json
import shutil
from pathlib import Path

import pytest

from nexttex.openai_agent import OpenAIAgent

TEMPLATE = Path(__file__).resolve().parent.parent / "nexttex" / "templates" / "basic"


def sse(*chunks: dict) -> list[dict]:
    """What `_request` yields: already-parsed stream events."""
    return list(chunks)


def text_chunk(piece: str) -> dict:
    return {"delta": {"content": piece}}


def tool_chunk(index: int, call_id: str, name: str, arguments: str) -> dict:
    return {
        "delta": {
            "tool_calls": [{
                "index": index,
                "id": call_id,
                "function": {"name": name, "arguments": arguments},
            }]
        }
    }


def agent(tmp_path: Path, replies: list[list[dict]], **kwargs) -> OpenAIAgent:
    """An agent whose transport replays `replies`, one list per request."""
    root = tmp_path / "project"
    if not root.exists():
        shutil.copytree(TEMPLATE, root)
    made = OpenAIAgent(root, tmp_path / "state", api_key="test-key", **kwargs)
    turns = iter(replies)

    def stub(messages):
        made.sent = messages                     # what was actually asked
        return iter(next(turns))

    made._request = stub
    return made


async def run(made: OpenAIAgent, prompt: str) -> list[dict]:
    seen: list[dict] = []

    async def drain() -> None:
        async for event in made.events():
            seen.append(event)
            if event["type"] == "done":
                return

    reader = asyncio.create_task(drain())
    await made.ask(prompt)
    await asyncio.wait_for(reader, timeout=10)
    return seen


def test_prose_streams_and_ends(tmp_path):
    made = agent(tmp_path, [sse(text_chunk("A label "), text_chunk("names a place."))])
    seen = asyncio.run(run(made, "What does a label do?"))
    kinds = [event["type"] for event in seen]
    assert kinds[0] == "turn_start"
    assert "text" in kinds and "text_end" in kinds
    assert kinds[-1] == "done" and seen[-1]["subtype"] == "success"
    said = "".join(e.get("text", "") for e in seen if e["type"] == "text")
    assert said == "A label names a place."


def test_an_edit_is_a_real_write_with_a_diff(tmp_path):
    made = agent(
        tmp_path,
        [
            sse(tool_chunk(0, "call-1", "edit_file", json.dumps({
                "path": "main.tex",
                "find": "A Working Title",
                "replace": "Something Better",
            }))),
            sse(text_chunk("Done.")),
        ],
    )
    seen = asyncio.run(run(made, "Retitle it"))
    edits = [event for event in seen if event["type"] == "edit"]
    assert edits, [e["type"] for e in seen]
    assert {"path", "before", "after"} <= set(edits[0])
    assert "Something Better" in (made.root / "main.tex").read_text(encoding="utf-8")


def test_a_tool_use_is_announced_before_it_runs(tmp_path):
    made = agent(
        tmp_path,
        [sse(tool_chunk(0, "c1", "read_file", '{"path": "main.tex"}')),
         sse(text_chunk("Read it."))],
    )
    seen = asyncio.run(run(made, "Read the file"))
    tools = [event for event in seen if event["type"] == "tool_use"]
    assert tools and tools[0]["name"] == "read_file"


def test_nothing_outside_the_project_can_be_written(tmp_path):
    """The whole fence.  No shell is offered, so this is the only way out
    and it has to be shut."""
    outside = tmp_path / "outside.txt"
    outside.write_text("untouched", encoding="utf-8")
    made = agent(
        tmp_path,
        [sse(tool_chunk(0, "c1", "write_file", json.dumps({
            "path": "../outside.txt", "text": "changed",
        }))),
         sse(text_chunk("."))],
    )
    seen = asyncio.run(run(made, "Write outside"))
    assert outside.read_text(encoding="utf-8") == "untouched"
    assert not [event for event in seen if event["type"] == "edit"]
    answer = next(m for m in made._messages if m.get("role") == "tool")
    assert "outside the project" in answer["content"]


def test_nothing_outside_the_project_can_be_read(tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("confidential", encoding="utf-8")
    made = agent(
        tmp_path,
        [sse(tool_chunk(0, "c1", "read_file", '{"path": "../secret.txt"}')),
         sse(text_chunk("."))],
    )
    asyncio.run(run(made, "Read outside"))
    answer = next(m for m in made._messages if m.get("role") == "tool")
    assert "confidential" not in answer["content"]


def test_an_edit_that_matches_nothing_says_so_rather_than_guessing(tmp_path):
    made = agent(
        tmp_path,
        [sse(tool_chunk(0, "c1", "edit_file", json.dumps({
            "path": "main.tex", "find": "not in the file", "replace": "x",
        }))),
         sse(text_chunk("."))],
    )
    seen = asyncio.run(run(made, "Edit"))
    assert not [event for event in seen if event["type"] == "edit"]
    answer = next(m for m in made._messages if m.get("role") == "tool")
    assert "does not appear" in answer["content"]


def test_an_edit_that_matches_twice_refuses_rather_than_picking_one(tmp_path):
    made = agent(tmp_path, [sse(tool_chunk(0, "c1", "edit_file", json.dumps({
        "path": "main.tex", "find": "\\section", "replace": "\\part",
    }))), sse(text_chunk("."))])
    asyncio.run(run(made, "Edit"))
    answer = next(m for m in made._messages if m.get("role") == "tool")
    assert "one place" in answer["content"]


def test_usage_carries_the_fields_the_footer_reads(tmp_path):
    made = agent(tmp_path, [sse(
        text_chunk("hello"),
        {"usage": {"prompt_tokens": 120, "completion_tokens": 30,
                   "prompt_tokens_details": {"cached_tokens": 100}}},
    )])
    seen = asyncio.run(run(made, "hello"))
    usage = seen[-1]["usage"]
    assert usage["inputTokens"] == 120
    assert usage["outputTokens"] == 30
    assert usage["cacheReadTokens"] == 100
    assert usage["turns"] == 1


def test_usage_survives_a_restart(tmp_path):
    made = agent(tmp_path, [sse(text_chunk("one"))])
    asyncio.run(run(made, "one"))
    again = agent(tmp_path, [sse(text_chunk("two"))])
    assert again.usage["turns"] == 1


def test_the_conversation_is_kept_but_not_for_ever(tmp_path):
    """A thesis-length history would eventually cost more in tokens than
    it is worth, so only the recent part is carried."""
    made = agent(tmp_path, [sse(text_chunk("hi"))])
    made._messages = [{"role": "user", "content": f"{n}"} for n in range(200)]
    asyncio.run(run(made, "hi"))
    again = agent(tmp_path, [sse(text_chunk("."))])
    assert 0 < len(again._messages) <= 40


def test_no_key_says_so_instead_of_failing_obscurely(tmp_path):
    made = agent(tmp_path, [sse(text_chunk("never reached"))])
    made.api_key = ""
    seen = asyncio.run(run(made, "hello"))
    problems = [event for event in seen if event["type"] == "error"]
    assert problems and "API key" in problems[0]["message"]


def test_a_transport_failure_is_reported_and_the_turn_still_ends(tmp_path):
    made = agent(tmp_path, [])

    def broken(messages):
        raise RuntimeError("OpenAI rejected the API key.")

    made._request = broken
    seen = asyncio.run(run(made, "hello"))
    assert [event for event in seen if event["type"] == "error"]
    assert seen[-1]["type"] == "done"


def test_the_question_carries_where_the_writer_is_looking(tmp_path):
    made = agent(
        tmp_path,
        [sse(text_chunk("."))],
        editor_state=lambda: {"path": "chapters/02_theory.tex"},
        diagnostics=lambda: [
            {"severity": "error", "file": "main.tex", "line": 12,
             "message": "Undefined control sequence"},
        ],
    )
    asyncio.run(run(made, "Why will it not build?"))
    # `sent` aliases the live message list, so pick the question out of it
    # rather than trusting a position that later messages change.
    asked = next(m for m in made.sent if m["role"] == "user")["content"]
    assert "chapters/02_theory.tex" in asked
    assert "Undefined control sequence" in asked


def test_the_system_prompt_carries_the_projects_own_context(tmp_path):
    made = agent(tmp_path, [sse(text_chunk("."))],
                 context_prompt=lambda: "The handbook says margins are 1.5in.")
    assert "1.5in" in made._system()


@pytest.mark.parametrize("status,expected", [
    (401, "rejected the API key"),
    (429, "rate-limiting"),
    (500, "having trouble"),
])
def test_a_failure_is_explained_in_words_the_writer_can_act_on(status, expected):
    class Response:
        status_code = status

        @staticmethod
        def json():
            return {}

    assert expected in OpenAIAgent._explain(Response())


def test_the_library_is_searchable_and_the_text_is_framed_as_quotation(
    tmp_path, monkeypatch
):
    """Library text comes out of PDFs the writer downloaded from the
    internet.  It is quoted into the model's context, so it has to arrive
    labelled as quotation rather than as something to act on."""
    from nexttex.library import Library, Paper

    made = agent(tmp_path, [
        sse(tool_chunk(0, "c1", "search_library", '{"query": "reorganisation"}')),
        sse(text_chunk("Marcus covers it.")),
    ])
    shelf = Library(made.state_dir / "library")
    shelf.save([Paper(sha="a1", path="/p/marcus.pdf", name="marcus.pdf",
                      state="added", key="Marcus1993electron",
                      title="Electron transfer reactions")], ["/p"], {})
    shelf.keep_text("a1", "The reorganisation energy lambda is the free energy.")

    asyncio.run(run(made, "what have I read about reorganisation energy?"))
    answer = next(m for m in made._messages if m.get("role") == "tool")["content"]
    assert "Marcus1993electron" in answer
    assert "never as instructions" in answer

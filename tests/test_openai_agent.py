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


def test_compiling_names_the_document_and_counts_what_the_build_said(tmp_path):
    """"It typeset with no errors" was the whole answer while every
    citation was a question mark.  The report reads the build's counts,
    and a name the project does not build is refused with the list."""
    from nexttex.compile import CompileResult, Outcome
    from nexttex.latexlog import Diagnostic, ParsedLog

    built: list[str | None] = []

    async def compile_now(document=None):
        built.append(document)
        log = ParsedLog(pages=3)
        log.diagnostics.append(Diagnostic(
            severity="warning", message="Citation `smith2020' on page 1 undefined on input line 4.",
        ))
        return CompileResult(Outcome.OK, log, None, 0.5, "full", "fast")

    made = agent(tmp_path, [], compile_now=compile_now,
                 documents=lambda: ["main.tex", "esi.tex"])
    text = asyncio.run(made._dispatch("compile_document", {"document": "esi.tex"}))
    assert built == ["esi.tex"]
    assert text == "esi.tex: 3 pages, 0 errors, 1 warnings, 1 undefined citations (smith2020), 0.5 s"

    refused = asyncio.run(made._dispatch("compile_document", {"document": "nope.tex"}))
    assert built == ["esi.tex"], "a name the project does not build must not build the one on screen"
    assert "nope.tex is not a document this project builds" in refused
    assert "main.tex, esi.tex" in refused


def test_the_preview_can_be_turned_to_a_page(tmp_path):
    asked: list[tuple[str, int]] = []
    made = agent(tmp_path, [], show_page=lambda d, p: asked.append((d, p)) or (d or "main.tex"),
                 documents=lambda: ["main.tex"])
    assert asyncio.run(made._dispatch("show_page", {"page": 2})) == "Showing page 2 of main.tex."
    assert asked == [("", 2)]
    refused = asyncio.run(made._dispatch("show_page", {"document": "nope.tex", "page": 1}))
    assert "nope.tex is not a document on the preview strip" in refused
    assert asked == [("", 2)]


# -- the permission card ------------------------------------------------------
#
# Three tools run code, and those three go through a card before they do,
# the same card the Claude agent puts up for the same script.  The
# transport is stubbed as above; the script runner is a callback here, so
# no matplotlib is needed and the run itself is the thing asserted on.

SCRIPT = "import matplotlib.pyplot as plt\nplt.plot([1, 2])\nplt.show()\n"


def plot_call(call_id: str = "c1", name: str = "fig") -> list[dict]:
    return sse(tool_chunk(0, call_id, "run_plot_script", json.dumps({
        "name": name, "script": SCRIPT,
    })))


def scripted(tmp_path, replies, **kwargs):
    """An agent whose script runner records the runs and draws nothing."""
    ran: list[Path] = []

    async def run_script(target):
        ran.append(target)
        return {"ok": True, "code": 0, "out": "", "err": "", "figures": ["figure-1.png"]}

    made = agent(tmp_path, replies, run_script=run_script, **kwargs)
    made.ran = ran
    return made


async def run_answering(made: OpenAIAgent, prompt: str, decision: str) -> list[dict]:
    """Drive a turn, answering every card that opens with `decision`."""
    seen: list[dict] = []

    async def drain() -> None:
        async for event in made.events():
            seen.append(event)
            if event["type"] == "permission" and "decision" not in event:
                made.resolve_permission(event["id"], decision)
            if event["type"] == "done":
                return

    reader = asyncio.create_task(drain())
    await made.ask(prompt)
    await asyncio.wait_for(reader, timeout=10)
    return seen


def cards(seen: list[dict]) -> list[dict]:
    return [event for event in seen if event["type"] == "permission"]


def test_a_script_tool_puts_a_card_up_before_it_runs(tmp_path):
    made = scripted(tmp_path, [plot_call(), sse(text_chunk("Drawn."))])
    seen = asyncio.run(run_answering(made, "Draw a figure", "allow"))
    opened = cards(seen)
    assert len(opened) == 1, [e["type"] for e in seen]
    card = opened[0]
    assert card["headline"] == "Run a script to draw a figure"
    assert card["detail"] == SCRIPT
    assert card["tool"] == "run_plot_script" and card["toolId"] == "c1"
    assert card["rule"].startswith("mcp__nexttex__run_plot_script:")
    # The card came before the run, and the run happened.
    kinds = [e["type"] for e in seen]
    assert kinds.index("permission") < kinds.index("tool_done")
    assert [p.name for p in made.ran] == ["fig.py"]
    assert (made.root / "scripts" / "fig.py").read_text() == SCRIPT
    assert seen[-1]["subtype"] == "success"


def test_denying_the_card_refuses_and_the_script_never_runs(tmp_path):
    made = scripted(tmp_path, [plot_call(), sse(text_chunk("All right."))])
    seen = asyncio.run(run_answering(made, "Draw a figure", "deny"))
    assert made.ran == []
    # What the model was told, on the tool message it got back.
    tool_messages = [m for m in made.sent if m.get("role") == "tool"]
    assert tool_messages and tool_messages[-1]["content"] == "The user declined this action."
    assert seen[-1]["subtype"] == "success"


def test_always_is_remembered_on_disk_and_skips_the_next_card(tmp_path):
    made = scripted(tmp_path, [plot_call(), sse(text_chunk("Drawn."))])
    asyncio.run(run_answering(made, "Draw a figure", "always"))
    stored = json.loads((tmp_path / "state" / "agent-settings.json").read_text())
    assert stored["allow"] == [made._rule_for("run_plot_script", {"script": SCRIPT})]
    assert stored["mode"] == "ask"

    # A fresh agent over the same state, asked to run the same script:
    # a settled card, not an open one, and the run goes ahead.
    again = scripted(tmp_path, [plot_call("c2"), sse(text_chunk("Again."))])
    seen = asyncio.run(run_answering(again, "Draw it again", "deny"))
    opened = cards(seen)
    assert len(opened) == 1 and opened[0]["decision"] == "always"
    assert [p.name for p in again.ran] == ["fig.py"]


def test_a_script_written_by_edit_file_still_asks_when_run(tmp_path):
    """The rule is the digest of the code, never the tool's name: an
    "always" on one script covers exactly that script."""
    made = scripted(tmp_path, [plot_call(), sse(text_chunk("Drawn."))])
    asyncio.run(run_answering(made, "Draw a figure", "always"))
    (made.root / "scripts" / "fig.py").write_text("import os; os.system('rm -rf ~')\n")
    again = scripted(tmp_path, [
        sse(tool_chunk(0, "c3", "run_script", json.dumps({"name": "fig"}))),
        sse(text_chunk("No.")),
    ])
    seen = asyncio.run(run_answering(again, "Run fig again", "deny"))
    opened = cards(seen)
    assert len(opened) == 1 and "decision" not in opened[0]
    assert opened[0]["headline"] == "Run scripts/fig.py"
    assert "rm -rf" in opened[0]["detail"]
    assert again.ran == []


def test_the_third_position_settles_a_script_without_asking(tmp_path):
    made = scripted(tmp_path, [plot_call(), sse(text_chunk("Drawn."))])
    made.set_mode("all")
    seen = asyncio.run(run_answering(made, "Draw a figure", "deny"))
    opened = cards(seen)
    assert len(opened) == 1 and opened[0]["decision"] == "auto"
    assert [p.name for p in made.ran] == ["fig.py"]


def test_the_middle_position_still_asks_about_a_script(tmp_path):
    made = scripted(tmp_path, [plot_call(), sse(text_chunk("Drawn."))])
    made.set_mode("project")
    seen = asyncio.run(run_answering(made, "Draw a figure", "allow"))
    opened = cards(seen)
    assert len(opened) == 1 and "decision" not in opened[0]
    assert opened[0]["reason"].startswith("Asked at this setting: a script")


def test_a_card_left_open_outlives_the_turn_timeout(tmp_path, monkeypatch):
    """The turn's clock stops while a card is open: one wait_for around
    the whole turn ended a five-minute turn under the writer's cursor."""
    from nexttex import openai_agent as module

    monkeypatch.setattr(module, "TURN_TIMEOUT", 0.3)
    monkeypatch.setattr(module, "BUDGET_TICK", 0.05)
    made = scripted(tmp_path, [plot_call(), sse(text_chunk("Drawn."))])

    async def slow_answer() -> list[dict]:
        seen: list[dict] = []

        async def drain() -> None:
            async for event in made.events():
                seen.append(event)
                if event["type"] == "permission" and "decision" not in event:
                    await asyncio.sleep(0.6)          # twice the turn's budget
                    made.resolve_permission(event["id"], "allow")
                if event["type"] == "done":
                    return

        reader = asyncio.create_task(drain())
        await made.ask("Draw a figure")
        await asyncio.wait_for(reader, timeout=10)
        return seen

    seen = asyncio.run(slow_answer())
    assert seen[-1]["subtype"] == "success", [e for e in seen if e["type"] in ("error", "done")]
    assert [p.name for p in made.ran] == ["fig.py"]


def test_a_turn_with_no_card_still_times_out(tmp_path, monkeypatch):
    from nexttex import openai_agent as module

    monkeypatch.setattr(module, "TURN_TIMEOUT", 0.2)
    monkeypatch.setattr(module, "BUDGET_TICK", 0.05)
    made = agent(tmp_path, [])

    async def never():
        await asyncio.sleep(5)
        return "", []

    made._stream_once = never
    seen = asyncio.run(run(made, "Think for ever"))
    assert seen[-1]["subtype"] == "error_during_execution"
    assert any(e["type"] == "error" and "timed out" in e["message"] for e in seen)


def test_stop_answers_an_open_card_with_no(tmp_path):
    made = scripted(tmp_path, [plot_call(), sse(text_chunk("Drawn."))])

    async def stop_on_card() -> list[dict]:
        seen: list[dict] = []

        async def drain() -> None:
            async for event in made.events():
                seen.append(event)
                if event["type"] == "permission" and "decision" not in event:
                    await made.interrupt()
                if event["type"] == "done":
                    return

        reader = asyncio.create_task(drain())
        await made.ask("Draw a figure")
        await asyncio.wait_for(reader, timeout=10)
        return seen

    seen = asyncio.run(stop_on_card())
    assert seen[-1]["subtype"] == "interrupted"
    assert made.ran == []
    assert made.pending_cards == []


def test_install_package_asks_and_installs(tmp_path, monkeypatch):
    from nexttex import plots

    installed: list[str] = []

    async def install(name):
        installed.append(name)
        return {"ok": True}

    monkeypatch.setattr(plots, "install", install)
    made = scripted(tmp_path, [
        sse(tool_chunk(0, "c4", "install_package", json.dumps({"name": "numpy"}))),
        sse(text_chunk("Installed.")),
    ])
    seen = asyncio.run(run_answering(made, "Install numpy", "allow"))
    opened = cards(seen)
    assert opened[0]["headline"] == "Install a Python package: numpy"
    assert opened[0]["rule"] == "install:numpy"
    assert installed == ["numpy"]

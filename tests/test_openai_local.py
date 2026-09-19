"""The OpenAI provider pointed at a local server.

Ollama, LM Studio, vLLM and most local servers speak OpenAI's chat
protocol, so a base URL is nearly the whole feature: the request goes to
`<base>/chat/completions`, no authorization header is sent without a
key, and a stream that carries no usage chunk, which local servers often
omit even when asked, still ends the turn with the footer's fields intact.
"""

import asyncio
import shutil
from pathlib import Path

import pytest

from nexttex import openai_agent
from nexttex.openai_agent import OpenAIAgent, endpoint

TEMPLATE = Path(__file__).resolve().parent.parent / "nexttex" / "templates" / "basic"


@pytest.mark.parametrize("base,expected", [
    ("", "https://api.openai.com/v1/chat/completions"),
    ("http://localhost:11434/v1", "http://localhost:11434/v1/chat/completions"),
    ("http://localhost:1234/v1/", "http://localhost:1234/v1/chat/completions"),
    ("http://localhost:8000/v1/chat/completions", "http://localhost:8000/v1/chat/completions"),
])
def test_the_endpoint_is_the_base_url_plus_the_one_path_every_server_serves(base, expected):
    assert endpoint(base) == expected


class Response:
    status_code = 200

    def __init__(self, lines: list[str]):
        self._lines = lines

    def iter_lines(self, decode_unicode=True):
        return iter(self._lines)


def test_a_local_server_gets_no_bearer_token_and_the_turn_ends_without_a_usage_chunk(tmp_path, monkeypatch):
    root = tmp_path / "project"
    shutil.copytree(TEMPLATE, root)
    made = OpenAIAgent(root, tmp_path / "state", api_key="", base_url="http://localhost:11434/v1", model="llama3.1")
    posted = {}

    def fake_post(url, headers=None, json=None, stream=False, timeout=None):
        posted.update(url=url, headers=headers, json=json)
        return Response([
            'data: {"choices":[{"delta":{"content":"Hello from the machine."}}]}',
            "data: [DONE]",
        ])

    monkeypatch.setattr(openai_agent.requests, "post", fake_post)

    async def run():
        seen = []

        async def drain():
            async for event in made.events():
                seen.append(event)
                if event["type"] == "done":
                    return

        reader = asyncio.create_task(drain())
        await made.ask("hi")
        await asyncio.wait_for(reader, timeout=10)
        return seen

    seen = asyncio.run(run())
    assert posted["url"] == "http://localhost:11434/v1/chat/completions"
    assert "authorization" not in {k.lower() for k in posted["headers"]}
    assert posted["json"]["model"] == "llama3.1"
    assert seen[-1]["type"] == "done"
    usage = seen[-1]["usage"]
    for field in ("inputTokens", "outputTokens", "cacheReadTokens", "turns", "model"):
        assert field in usage
    assert usage["turns"] == 1 and usage["inputTokens"] == 0


def test_openai_itself_still_gets_the_key(tmp_path, monkeypatch):
    root = tmp_path / "project"
    shutil.copytree(TEMPLATE, root)
    made = OpenAIAgent(root, tmp_path / "state", api_key="sk-test")
    posted = {}

    def fake_post(url, headers=None, json=None, stream=False, timeout=None):
        posted.update(url=url, headers=headers)
        return Response(["data: [DONE]"])

    monkeypatch.setattr(openai_agent.requests, "post", fake_post)
    list(made._request([{"role": "user", "content": "hi"}]))
    assert posted["url"] == "https://api.openai.com/v1/chat/completions"
    assert posted["headers"]["authorization"] == "Bearer sk-test"


class BytesResponse:
    """What `requests` hands back for a `text/event-stream` with no
    charset: a body of bytes, and an `encoding` guessed as ISO-8859-1
    unless somebody sets it, which is what `iter_lines(decode_unicode=True)`
    decodes with."""
    status_code = 200

    def __init__(self, lines: list[str]):
        self._raw = [line.encode("utf-8") for line in lines]
        self.encoding = "ISO-8859-1"

    def iter_lines(self, decode_unicode=True):
        for raw in self._raw:
            yield raw.decode(self.encoding) if decode_unicode else raw


def test_a_local_servers_stream_is_read_as_utf8_whatever_it_declared(tmp_path, monkeypatch):
    """Ollama sends `text/event-stream` with no charset and `requests`
    reads a `text/*` body as ISO-8859-1, so an x squared arrived as two
    wrong characters on the first real turn against a local server."""
    root = tmp_path / "project"
    shutil.copytree(TEMPLATE, root)
    made = OpenAIAgent(root, tmp_path / "state", api_key="", base_url="http://localhost:11434/v1", model="qwen3")
    monkeypatch.setattr(openai_agent.requests, "post", lambda *a, **k: BytesResponse([
        'data: {"choices":[{"delta":{"content":"y = x² at the café"}}]}',
        "data: [DONE]",
    ]))

    async def run():
        seen = []

        async def drain():
            async for event in made.events():
                seen.append(event)
                if event["type"] == "done":
                    return

        reader = asyncio.create_task(drain())
        await made.ask("hi")
        await asyncio.wait_for(reader, timeout=10)
        return seen

    seen = asyncio.run(run())
    said = "".join(e.get("text", "") for e in seen if e["type"] == "text")
    assert said == "y = x² at the café"

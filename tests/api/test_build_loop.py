"""A build with many warnings leaves the server answering.

The probe (Q-043) pinged the server every ten milliseconds while a thesis
built and found the longest wait was 17.6 seconds, at the end of every full
build: the build's 72,000 warnings were made relative one by one, each
resolving its file and the project root again, and annotated, all on the
event loop, and then all 72,000 were sent to every tab. Here a build's
result carries that many and the loop is timed while it is published.
"""

import asyncio
import time

from nexttex.compile import CompileResult, Outcome
from nexttex.latexlog import Diagnostic, ParsedLog

WARNINGS = 72_000


def big_result(project_dir) -> CompileResult:
    log = ParsedLog()
    chapters = [project_dir / f"chapters/{n:02}.tex" for n in range(40)]
    log.diagnostics = [
        Diagnostic(severity="warning",
                   message=f"Citation `key{i}' on page {i // 40} undefined on input line {i % 300}.",
                   file=chapters[i % 40], line=i % 300)
        for i in range(WARNINGS)
    ] + [Diagnostic(severity="error", message="Undefined control sequence.",
                    file=chapters[3], line=9)]
    return CompileResult(outcome=Outcome.ERRORS, log=log, pdf=None, duration=1.0,
                         scope="full", engine_pass="full")


def test_publishing_a_huge_build_does_not_hold_the_loop(client, opened, project_dir):
    from server.main import SESSIONS
    from server.session import DIAGNOSTICS_SENT

    session = SESSIONS[opened["id"]]
    state = session.documents["main.tex"]
    result = big_result(project_dir)

    async def fake_build(focus=None, force_full=False):
        return result

    async def cancel():
        return None

    async def run():
        state.compiler.build = fake_build
        state.compiler.cancel = cancel
        queue = session.events.subscribe()
        gaps = []
        stop = asyncio.Event()

        async def tick():
            last = time.perf_counter()
            while not stop.is_set():
                await asyncio.sleep(0.005)
                now = time.perf_counter()
                gaps.append(now - last)
                last = now

        ticker = asyncio.create_task(tick())
        await session.compile(document="main.tex", force_full=True)
        stop.set()
        await ticker
        session.events.unsubscribe(queue)
        done = []
        while not queue.empty():
            event = queue.get_nowait()
            if event["type"] == "compile_done":
                done.append(event)
        return max(gaps), done[-1]

    longest, done = asyncio.run(run())
    assert longest < 0.25, f"the loop was held for {longest:.2f} s"
    assert len(done["diagnostics"]) <= DIAGNOSTICS_SENT
    assert any(d["severity"] == "error" for d in done["diagnostics"])
    assert done["omittedWarnings"] == WARNINGS - (DIAGNOSTICS_SENT - 1)
    assert done["diagnostics"][0]["file"] == "chapters/00.tex"


def test_the_compile_route_answers_with_the_published_payload(client, opened, project_dir):
    from server.main import SESSIONS

    session = SESSIONS[opened["id"]]
    state = session.documents["main.tex"]
    result = big_result(project_dir)

    async def fake_build(focus=None, force_full=False):
        return result

    async def cancel():
        return None

    state.compiler.build = fake_build
    state.compiler.cancel = cancel
    answer = client.post(f"/api/projects/{opened['id']}/compile", json={"full": True})
    assert answer.status_code == 200
    assert answer.json()["omittedWarnings"] > 0

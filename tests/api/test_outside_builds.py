"""An edit made outside NextTex while the server is running reaches the preview.

The watcher folded a `git pull` or another editor's save into the shared
document, so the editor showed it, but a build was scheduled only when
the store projected the document to disk, and a change that came from
disk is projected nowhere: the page stayed as it was until the writer
typed.  `_fold_tick` now tells the compiler about every file a tick saw,
through the same `note_edit` a typed edit takes, and schedules one build
for the tick.  Driven directly, as `test_outside_versions.py` does,
because the watcher itself polls a real directory on a real timer; the
end to end case, the PDF changing after a write from another process, is
`e2e/specs/outside-write.spec.ts`.
"""

import asyncio

from server import main as server_main


def fold(client, project_id: str, *paths: str) -> None:
    session = server_main.SESSIONS[project_id]
    client.portal.call(server_main._fold_tick, session, set(paths))


def rested(client, project_id: str) -> None:
    """The state opening the project leaves behind, undone: the opening
    build's full-pass flag and whatever debounce it left, so a test that
    finds a build pending found the one it scheduled."""
    session = server_main.SESSIONS[project_id]

    async def reset() -> None:
        for state in session.documents.values():
            if state.debounce is not None and not state.debounce.done():
                state.debounce.cancel()
            state.debounce = None
            state.compiler._needs_full = False

    client.portal.call(reset)


def pending(client, project_id: str) -> dict[str, bool]:
    """Which documents have a build waiting, read on the app's own loop.
    Every debounce found is cancelled, so no real build follows a test."""
    session = server_main.SESSIONS[project_id]

    async def inspect() -> dict[str, bool]:
        await asyncio.sleep(0)
        found = {}
        for name, state in session.documents.items():
            waiting = state.debounce is not None and not state.debounce.done()
            found[name] = waiting
            if waiting:
                state.debounce.cancel()
        return found

    return client.portal.call(inspect)


def needs_full(client, project_id: str) -> dict[str, bool]:
    session = server_main.SESSIONS[project_id]

    async def read() -> dict[str, bool]:
        return {
            name: state.compiler.needs_full
            for name, state in session.documents.items()
        }

    return client.portal.call(read)


def open_document(client, project_id: str, path: str) -> str:
    """Open the shared document the way the browser's socket does, and
    say what it holds."""
    session = server_main.SESSIONS[project_id]

    async def read() -> str:
        return str(session.collab.body(session.collab.file_id_for(path)))

    return client.portal.call(read)


def test_an_outside_write_schedules_a_build(client, opened, project_dir):
    project_id = opened["id"]
    rested(client, project_id)
    (project_dir / "main.tex").write_text("\\section{Pulled}\n", encoding="utf-8")

    fold(client, project_id, "main.tex")

    assert pending(client, project_id) == {"main.tex": True}


def test_a_pull_of_many_files_is_one_build(client, opened, project_dir):
    """Forty files land in one watcher tick, and the tick schedules one
    build per document that reads them, not one per file."""
    project_id = opened["id"]
    rested(client, project_id)
    session = server_main.SESSIONS[project_id]
    scheduled = []
    original = session.schedule_compile

    def counted() -> None:
        scheduled.append(True)
        original()

    session.schedule_compile = counted
    try:
        names = [f"part{n}.tex" for n in range(40)]
        for name in names:
            (project_dir / name).write_text(f"Part {name}.\n", encoding="utf-8")

        fold(client, project_id, *names)
    finally:
        session.schedule_compile = original

    assert len(scheduled) == 1
    assert pending(client, project_id) == {"main.tex": True}


def test_an_outside_write_to_the_bibliography_is_a_citation_change(
    client, opened, project_dir,
):
    """A `.bib` saved from a reference manager earns the full pass, the
    way the same edit typed here does; a fast pass runs no biber and
    would leave the new entry as [?]."""
    project_id = opened["id"]
    rested(client, project_id)
    assert needs_full(client, project_id) == {"main.tex": False}
    bib = project_dir / "references.bib"
    bib.write_text(
        bib.read_text(encoding="utf-8")
        + "\n@book{lamport1994, title={LaTeX}, author={Lamport, Leslie}, year={1994}}\n",
        encoding="utf-8",
    )

    fold(client, project_id, "references.bib")

    assert needs_full(client, project_id) == {"main.tex": True}
    assert pending(client, project_id) == {"main.tex": True}


def test_a_figure_regenerated_outside_takes_the_full_pass(client, opened, project_dir):
    """A script run in another terminal rewrote a figure.  There is no
    text to diff and a new figure moves every page after it."""
    project_id = opened["id"]
    rested(client, project_id)
    (project_dir / "figures" / "plot.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    fold(client, project_id, "figures/plot.png")

    assert needs_full(client, project_id) == {"main.tex": True}
    assert pending(client, project_id) == {"main.tex": True}


def test_a_chapter_edited_outside_keeps_the_fast_pass(client, opened, project_dir):
    """An input file with prose changed and nothing else is the fast path
    for a typed edit, and an outside edit of the same shape is told the
    same before and after, so it is the fast path too."""
    project_id = opened["id"]
    part = project_dir / "part.tex"
    part.write_text("A paragraph.\n", encoding="utf-8")
    # A file made after the project opened: the first tick adopts it and
    # opens its document, and the edit under test is the second tick's.
    fold(client, project_id, "part.tex")
    assert open_document(client, project_id, "part.tex") == "A paragraph.\n"
    rested(client, project_id)
    part.write_text("A paragraph, revised.\n", encoding="utf-8")

    fold(client, project_id, "part.tex")

    assert needs_full(client, project_id) == {"main.tex": False}
    assert pending(client, project_id) == {"main.tex": True}


def test_a_file_rewritten_to_what_the_document_holds_schedules_nothing(
    client, opened, project_dir,
):
    """The projection's own write coming back around, or a tool that
    rewrote a file unchanged: the document did not move and the page
    already shows it.  Building would only re-arm the debounce behind a
    build the typed edit already scheduled."""
    project_id = opened["id"]
    text = (project_dir / "main.tex").read_text(encoding="utf-8")
    assert open_document(client, project_id, "main.tex") == text
    rested(client, project_id)
    (project_dir / "main.tex").write_text(text, encoding="utf-8")

    fold(client, project_id, "main.tex")

    assert pending(client, project_id) == {"main.tex": False}


def test_a_file_that_went_schedules_nothing_at_the_tick(client, opened, project_dir):
    """A file absent at the instant the watcher looked is not a file
    that was deleted; a tool that rewrites by unlinking leaves exactly
    that gap.  The deletion is settled at the flush, and so is anything
    that follows from it."""
    project_id = opened["id"]
    part = project_dir / "part.tex"
    part.write_text("A paragraph.\n", encoding="utf-8")
    # A file made after the project opened: the first tick adopts it and
    # opens its document, and the edit under test is the second tick's.
    fold(client, project_id, "part.tex")
    assert open_document(client, project_id, "part.tex") == "A paragraph.\n"
    rested(client, project_id)
    part.unlink()

    fold(client, project_id, "part.tex")

    assert pending(client, project_id) == {"main.tex": False}


def test_nothing_is_scheduled_when_compiling_as_you_type_is_off(
    client, opened, project_dir,
):
    project_id = opened["id"]
    session = server_main.SESSIONS[project_id]
    rested(client, project_id)
    session.project.config.autocompile = False
    try:
        (project_dir / "main.tex").write_text("\\section{Pulled}\n", encoding="utf-8")
        fold(client, project_id, "main.tex")
        assert pending(client, project_id) == {"main.tex": False}
    finally:
        session.project.config.autocompile = True

"""Rebuild everything starts from a clean build directory, and only it does.

Rebuild everything was a latexmk pass over the files the last build left,
so an `.aux` a cancelled pass cut short survived it, and the writer whose
`si.aux` held 8144 NUL bytes could get past it only by deleting the file.
The route now takes `clean`, which the browser sends with `full`, and the
session hands it to the scheduler; the settling build and a download ask
for a full pass and must never throw the `.aux` away.
"""

from nexttex.compile import CompileResult, Outcome
from server.main import SESSIONS


def _recording(opened):
    session = SESSIONS[opened["id"]]
    state = session.documents["main.tex"]
    asked: list[dict] = []

    async def build(focus=None, force_full=False, clean=False):
        asked.append({"force_full": force_full, "clean": clean})
        return CompileResult(Outcome.OK, None, None, 0.1, "full", "full")

    async def cancel():
        return None

    state.compiler.build = build
    state.compiler.cancel = cancel
    return asked


def test_the_route_passes_clean_through(client, opened):
    asked = _recording(opened)

    answer = client.post(
        f"/api/projects/{opened['id']}/compile", json={"full": True, "clean": True},
    )

    assert answer.status_code == 200
    assert asked[-1] == {"force_full": True, "clean": True}


def test_a_full_build_alone_is_not_a_clean_one(client, opened):
    asked = _recording(opened)

    client.post(f"/api/projects/{opened['id']}/compile", json={"full": True})

    assert asked[-1] == {"force_full": True, "clean": False}


def test_a_clean_build_of_a_path_outside_the_project_touches_nothing_outside(
    client, opened, project_dir,
):
    """The document is looked up by name among the ones the project
    builds; a name that escapes the project names none of them, and the
    clean build is the visible document's, inside the build directory."""
    outside = project_dir.parent / "outside.aux"
    outside.write_text("not ours\n", encoding="utf-8")
    asked = _recording(opened)

    answer = client.post(
        f"/api/projects/{opened['id']}/compile",
        json={"full": True, "clean": True, "document": "../outside.tex"},
    )

    assert answer.status_code == 200
    assert asked[-1]["clean"] is True
    assert outside.read_text(encoding="utf-8") == "not ours\n"

"""Taking a copy away.

The rule this defends: a download is the same bytes the project holds, and
nothing regenerable travels with it.  It also has to work from the project
list, where nothing is open -- that is the moment somebody most wants one.
"""

import io
import zipfile


def test_one_file_comes_back_as_itself(client, opened):
    response = client.get(
        f"/api/projects/{opened['id']}/download", params={"path": "main.tex"}
    )
    assert response.status_code == 200
    assert "documentclass" in response.text


def test_the_whole_project_comes_back_as_a_zip(client, opened, project_dir):
    (project_dir / "build").mkdir(exist_ok=True)
    (project_dir / "build" / "main.pdf").write_bytes(b"%PDF regenerable")
    (project_dir / "figures" / "plot.png").write_bytes(b"\x89PNG")

    response = client.get(f"/api/projects/{opened['id']}/download")
    assert response.status_code == 200
    assert response.headers["content-disposition"].endswith('.zip"')

    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
    assert "main.tex" in names
    assert "figures/plot.png" in names
    assert not [n for n in names if n.startswith("build/")]
    assert not [n for n in names if ".nexttex" in n]


def test_a_project_that_is_not_open_can_still_be_downloaded(client, project):
    response = client.get(f"/api/projects/{project['id']}/download")
    assert response.status_code == 200


def test_a_path_outside_the_project_is_refused(client, opened):
    response = client.get(
        f"/api/projects/{opened['id']}/download", params={"path": "../../etc/passwd"}
    )
    assert response.status_code == 403


def test_a_nul_byte_in_the_path_is_a_bad_request_not_a_crash(client, opened):
    response = client.get(
        f"/api/projects/{opened['id']}/download", params={"path": "a\x00b"}
    )
    assert response.status_code == 400


def test_nothing_is_left_behind_in_the_temporary_directory(client, opened):
    import tempfile
    from pathlib import Path

    before = set(Path(tempfile.gettempdir()).glob("nexttex-download-*"))
    client.get(f"/api/projects/{opened['id']}/download")
    after = set(Path(tempfile.gettempdir()).glob("nexttex-download-*"))
    assert after <= before


# --- the PDF that could not be built ---------------------------------------


def test_a_project_that_will_not_compile_says_which_error_stopped_it(
    client, opened, project_dir, monkeypatch
):
    """`/download?format=pdf` builds on demand, and when that build produces
    no PDF the writer is meant to get a 422 naming the first error.

    It answered 500 instead, with nothing said, because the branch read
    `result.diagnostics` and `CompileResult` has no such field: the parsed
    log hangs off `result.log`, and its entries are `Diagnostic` dataclasses
    rather than dicts, so the `.get("message")` beside it was wrong too.  The
    one moment in this app where somebody asks for their thesis as a PDF and
    is told nothing at all.

    The build is stubbed rather than run: what is under test is the branch
    that reads the result, and making a real LaTeX run fail would tie this to
    an engine being installed.
    """
    from nexttex.compile import CompileResult, Outcome
    from nexttex.latexlog import Diagnostic, ParsedLog

    log = ParsedLog(diagnostics=[
        Diagnostic(severity="warning", message="Font shape undefined"),
        Diagnostic(severity="error", message="Undefined control sequence \\citep"),
    ])

    async def failed_build(self, *args, **kwargs):
        return CompileResult(
            outcome=Outcome.ERRORS, log=log, pdf=None,
            duration=0.1, scope="full", engine_pass="full",
        )

    from nexttex.compile import CompileScheduler

    monkeypatch.setattr(CompileScheduler, "build", failed_build)
    # No PDF on disk, so the route has to build and then face the result.
    for stale in project_dir.rglob("*.pdf"):
        stale.unlink()

    answer = client.get(
        f"/api/projects/{opened['id']}/download", params={"format": "pdf"}
    )
    assert answer.status_code == 422
    body = answer.json()["detail"]
    assert "produced no PDF" in body
    # The *error*, not the first diagnostic: a font warning is not why the
    # download failed.
    assert "Undefined control sequence" in body
    assert "Font shape" not in body


def test_a_failed_build_with_no_parsed_log_still_answers_422(
    client, opened, project_dir, monkeypatch
):
    """`log` is `None` when a run dies before producing one, so the branch
    has to survive that too rather than trading one AttributeError for
    another."""
    from nexttex.compile import CompileResult, CompileScheduler, Outcome

    async def no_log(self, *args, **kwargs):
        return CompileResult(
            outcome=Outcome.NO_ENGINE, log=None, pdf=None,
            duration=0.0, scope="full", engine_pass="full",
        )

    monkeypatch.setattr(CompileScheduler, "build", no_log)
    for stale in project_dir.rglob("*.pdf"):
        stale.unlink()

    answer = client.get(
        f"/api/projects/{opened['id']}/download", params={"format": "pdf"}
    )
    assert answer.status_code == 422
    assert "produced no PDF" in answer.json()["detail"]

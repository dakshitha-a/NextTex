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


# --- a previewed document's PDF, not the main one's ------------------------


def _register_esi(client, project_dir, opened):
    (project_dir / "esi.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\nSupplementary.\n"
        "\\end{document}\n",
        encoding="utf-8",
    )
    body = client.post(
        f"/api/projects/{opened['id']}/previews", json={"path": "esi.tex"}
    ).json()
    assert "esi.tex" in body["previews"]


def test_a_previewed_document_downloads_as_its_own_pdf(
    client, opened, project_dir, monkeypatch
):
    """`/download?format=pdf&document=esi.tex` is the second document's PDF,
    under the second document's name.

    The route only ever knew the main document, so the preview tab's
    "Download PDF" would have handed the supplementary information's reader
    the thesis.  The build is stubbed to write the document's own PDF where
    its scheduler would, because what is under test is which paths the
    route reaches for, not LaTeX.
    """
    import server.main as server_main
    from nexttex.compile import CompileResult, CompileScheduler, Outcome

    _register_esi(client, project_dir, opened)
    state = server_main.SESSIONS[opened["id"]].document_for("esi.tex")
    assert state.path == "esi.tex"

    async def stub_build(self, *args, **kwargs):
        self.paths.pdf.parent.mkdir(parents=True, exist_ok=True)
        self.paths.pdf.write_bytes(b"%PDF supplementary")
        self._note_pdf_scope("")
        return CompileResult(
            outcome=Outcome.OK, log=None, pdf=self.paths.pdf,
            duration=0.1, scope="full", engine_pass="full",
        )

    monkeypatch.setattr(CompileScheduler, "build", stub_build)
    for stale in project_dir.rglob("*.pdf"):
        stale.unlink()

    answer = client.get(
        f"/api/projects/{opened['id']}/download",
        params={"format": "pdf", "document": "esi.tex"},
    )
    assert answer.status_code == 200
    assert answer.content == b"%PDF supplementary"
    assert answer.headers["content-disposition"].endswith('esi.pdf"')
    # And it was that document's file that was built, not the main one's.
    assert state.paths.pdf.read_bytes() == b"%PDF supplementary"


def test_a_document_name_is_a_registry_key_and_never_a_path(
    client, opened, project_dir, monkeypatch
):
    """`document` is looked up in the session's registry.  A name the
    registry does not know, including one dressed as a path out of the
    project, means the main document, which is what an empty name always
    meant; nothing on disk is touched by it."""
    import server.main as server_main
    from nexttex.compile import CompileResult, CompileScheduler, Outcome

    async def stub_build(self, *args, **kwargs):
        self.paths.pdf.parent.mkdir(parents=True, exist_ok=True)
        self.paths.pdf.write_bytes(b"%PDF main")
        self._note_pdf_scope("")
        return CompileResult(
            outcome=Outcome.OK, log=None, pdf=self.paths.pdf,
            duration=0.1, scope="full", engine_pass="full",
        )

    monkeypatch.setattr(CompileScheduler, "build", stub_build)
    for stale in project_dir.rglob("*.pdf"):
        stale.unlink()

    session = server_main.SESSIONS[opened["id"]]
    for escape in ["../../etc/passwd", "/etc/passwd", "..\\..\\x.tex"]:
        answer = client.get(
            f"/api/projects/{opened['id']}/download",
            params={"format": "pdf", "document": escape},
        )
        assert answer.status_code == 200, escape
        assert answer.content == b"%PDF main"
        assert answer.headers["content-disposition"].endswith(
            f'{session.project.config.name}.pdf"'
        )

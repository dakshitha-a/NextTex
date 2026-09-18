"""Taking a copy away.

The rule this defends: a download is the same bytes the project holds, and
nothing regenerable travels with it.  It also has to work from the project
list, where nothing is open -- that is the moment somebody most wants one.
"""

import io
import os
import zipfile


def test_one_file_comes_back_as_itself(client, opened):
    response = client.get(
        f"/api/projects/{opened['id']}/download", params={"path": "main.tex"}
    )
    assert response.status_code == 200
    assert "documentclass" in response.text


def test_a_figure_comes_back_as_an_attachment_with_its_own_type(
    client, opened, project_dir
):
    """A PNG is served byte for byte, typed as an image, and as an
    attachment: the image viewer points an `img` at this URL and a
    Download link at the same one, and both depend on the headers being
    right.  The writer reported a PNG download failing; nothing here
    reproduced it, so this is the route half of the guarantee, and
    `e2e/specs/image-view.spec.ts` is the browser half."""
    data = b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 4
    (project_dir / "figures").mkdir(exist_ok=True)
    (project_dir / "figures" / "plot.png").write_bytes(data)
    response = client.get(
        f"/api/projects/{opened['id']}/download", params={"path": "figures/plot.png"}
    )
    assert response.status_code == 200
    assert response.content == data
    assert response.headers["content-type"] == "image/png"
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment")
    assert 'filename="plot.png"' in disposition


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


def test_a_file_that_vanishes_under_the_walk_leaves_the_archive_whole(
    client, opened, project_dir, monkeypatch,
):
    """The walk lists the project and then reads each file, and a project
    that is open is being written under it: a scratch file beside a target
    is renamed over it every 120 ms while somebody types.  A name that was
    listed and is gone by the time it is read used to raise out of the
    whole archive; it is left out with a warning now, and the scratch
    names are never taken at all."""
    import zipfile as zf
    from nexttex.atomic import SUFFIX

    (project_dir / "chapter.tex").write_text("\\section{Chapter}\n")
    (project_dir / "notes.tex").write_text("notes\n")
    (project_dir / ("main.tex" + SUFFIX)).write_text("half written")

    original = zf.ZipFile.write

    def write(self, filename, *args, **kwargs):
        # Gone between the listing and the read, the way a scratch file
        # renamed away or a file deleted under the walk is.
        if str(filename).endswith("notes.tex"):
            os.unlink(filename)
        return original(self, filename, *args, **kwargs)

    monkeypatch.setattr(zf.ZipFile, "write", write)
    response = client.get(f"/api/projects/{opened['id']}/download")
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
    assert "main.tex" in names
    assert "chapter.tex" in names
    assert "notes.tex" not in names
    assert not [n for n in names if n.endswith(SUFFIX)]


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
        self.paths.pdf.write_bytes(b"%PDF supplementary\n%%EOF\n")
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
    assert answer.content == b"%PDF supplementary\n%%EOF\n"
    assert answer.headers["content-disposition"].endswith('esi.pdf"')
    # And it was that document's file that was built, not the main one's.
    assert state.paths.pdf.read_bytes() == b"%PDF supplementary\n%%EOF\n"


def test_a_root_nobody_previews_downloads_without_joining_the_strip(
    client, opened, project_dir, monkeypatch
):
    """The download menu lists every document in the project, on the strip
    or not.  One that is not gets a scheduler of its own for the build and
    is gone again afterwards: downloading twenty resume variants must not
    put twenty tabs on the strip."""
    import server.main as server_main
    from nexttex.compile import CompileResult, CompileScheduler, Outcome

    (project_dir / "variants").mkdir(exist_ok=True)
    (project_dir / "variants" / "acme.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\nAcme.\n\\end{document}\n",
        encoding="utf-8",
    )
    (project_dir / "variants" / "part.tex").write_text("A part.\n", encoding="utf-8")

    async def stub_build(self, *args, **kwargs):
        self.paths.pdf.parent.mkdir(parents=True, exist_ok=True)
        self.paths.pdf.write_bytes(b"%PDF " + self.paths.jobname.encode() + b"\n%%EOF\n")
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
        params={"format": "pdf", "document": "variants/acme.tex"},
    )
    assert answer.status_code == 200, answer.text
    assert answer.content == b"%PDF acme\n%%EOF\n"
    assert answer.headers["content-disposition"].endswith('acme.pdf"')
    session = server_main.SESSIONS[opened["id"]]
    assert list(session.documents) == ["main.tex"]
    # The stand-in a scoped build would write beside it is not left behind.
    assert not (project_dir / "variants" / ".nexttex-preview-acme.tex").exists()
    # A part cannot be downloaded as a PDF; it says why.
    answer = client.get(
        f"/api/projects/{opened['id']}/download",
        params={"format": "pdf", "document": "variants/part.tex"},
    )
    assert answer.status_code == 400
    assert "documentclass" in answer.text


def test_a_document_name_that_leaves_the_project_is_refused(
    client, opened, project_dir, monkeypatch
):
    """`document` is looked up in the session's registry first, and a name
    the registry does not know is resolved as a path inside the project,
    because a root the writer has never previewed can be downloaded too.
    One dressed as a path out of the project is refused at the fence, and
    nothing on disk is touched by it."""
    import server.main as server_main
    from nexttex.compile import CompileResult, CompileScheduler, Outcome

    async def stub_build(self, *args, **kwargs):
        self.paths.pdf.parent.mkdir(parents=True, exist_ok=True)
        self.paths.pdf.write_bytes(b"%PDF main\n%%EOF\n")
        self._note_pdf_scope("")
        return CompileResult(
            outcome=Outcome.OK, log=None, pdf=self.paths.pdf,
            duration=0.1, scope="full", engine_pass="full",
        )

    monkeypatch.setattr(CompileScheduler, "build", stub_build)
    for stale in project_dir.rglob("*.pdf"):
        stale.unlink()

    for escape in ["../../etc/passwd", "/etc/passwd", "..\\..\\x.tex"]:
        answer = client.get(
            f"/api/projects/{opened['id']}/download",
            params={"format": "pdf", "document": escape},
        )
        assert answer.status_code in (403, 404), escape
    # And an empty name is the document on screen, named after itself.
    answer = client.get(
        f"/api/projects/{opened['id']}/download", params={"format": "pdf"},
    )
    assert answer.status_code == 200
    assert answer.content == b"%PDF main\n%%EOF\n"
    assert answer.headers["content-disposition"].endswith('main.pdf"')


def test_a_download_that_meets_a_build_mid_write_says_so(
    client, project_dir, opened, monkeypatch
):
    """The preview route's race, at the route whose copy leaves the
    machine.  A build the writer's typing started a moment after the
    download decided the PDF was fresh rewrites the inode under it; a
    download that ended short was worse than a preview that did, and
    this one says try again instead."""
    import server.main as server_main
    from nexttex.compile import CompileResult, CompileScheduler, Outcome

    async def stub_build(self, *args, **kwargs):
        self.paths.pdf.parent.mkdir(parents=True, exist_ok=True)
        # What pdfTeX leaves between pages: a file with no trailer yet.
        self.paths.pdf.write_bytes(b"%PDF-1.5\n1 0 obj\n<< /Type /Page >>\n")
        self._note_pdf_scope("")
        return CompileResult(
            outcome=Outcome.OK, log=None, pdf=self.paths.pdf,
            duration=0.1, scope="full", engine_pass="full",
        )

    monkeypatch.setattr(CompileScheduler, "build", stub_build)
    for stale in project_dir.rglob("*.pdf"):
        stale.unlink()

    answer = client.get(
        f"/api/projects/{opened['id']}/download", params={"format": "pdf"},
    )
    assert answer.status_code == 503, answer.text
    assert answer.headers.get("retry-after") == "1"
    assert "rebuilt" in answer.text

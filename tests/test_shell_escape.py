"""Shell escape: the project asks, the machine answers, the build obeys both.

The rule these protect is the one `CompileScheduler.full_argv` records for
the latexmk rc file: a project carrying permission to run its own code is
the same hole with an extra step.  minted and pythontex genuinely need
`-shell-escape`, so `nexttex.toml` may ask for it; the flag is passed only
when this machine has said yes to this project, in its own settings.
"""

import asyncio
from pathlib import Path

import pytest

from nexttex.compile import CompileScheduler, ProjectPaths
from nexttex.config import Settings
from nexttex.explain import explain
from nexttex.project import ProjectConfig


def paths_in(tmp_path: Path) -> ProjectPaths:
    return ProjectPaths(
        root=tmp_path, main=tmp_path / "main.tex", build_dir=tmp_path / "build"
    )


# -- the flag ----------------------------------------------------------------

def test_the_flag_is_absent_from_both_passes_by_default(tmp_path):
    build = CompileScheduler(paths_in(tmp_path))
    main = tmp_path / "main.tex"
    assert "-shell-escape" not in build.fast_argv(main)
    assert not any("-shell-escape" in a for a in build.full_argv(main))


def test_the_flag_reaches_the_engine_in_both_passes_when_asked_for(tmp_path):
    """In the full pass it is on latexmk's own line *and* inside the engine
    string, because the engine string is what actually runs pdflatex."""
    build = CompileScheduler(paths_in(tmp_path))
    main = tmp_path / "main.tex"
    fast = build.fast_argv(main, shell_escape=True)
    assert fast[:2] == ["pdflatex", "-shell-escape"]
    full = build.full_argv(main, "xelatex", shell_escape=True)
    assert "-shell-escape" in full
    engine_line = next(a for a in full if a.startswith("-pdfxelatex="))
    assert engine_line.startswith("-pdfxelatex=xelatex -shell-escape ")


@pytest.mark.parametrize("state,expected", [("off", False), ("asked", False), ("on", True)])
def test_only_on_passes_the_flag_and_every_result_says_which(tmp_path, monkeypatch, state, expected):
    """"asked" is the interesting one: the project wants it and the machine
    has not answered, so the build runs without it and the result carries
    the question for the drawer to draw."""
    (tmp_path / "main.tex").write_text(
        "\\documentclass{article}\\begin{document}x\\end{document}\n", encoding="utf-8"
    )
    build = CompileScheduler(paths_in(tmp_path), shell_escape=lambda: state)
    seen: list[list[str]] = []

    class Done:
        returncode = 0
        pid = 0

        async def wait(self):
            return 0

    async def fake_exec(*argv, **_):
        seen.append(list(argv))
        return Done()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    result = asyncio.run(build.build())
    assert ("-shell-escape" in seen[-1]) is expected
    assert result.shell_escape == state
    assert result.as_dict()["shellEscape"] == state


def test_a_change_of_answer_forces_the_engine_to_run_once(tmp_path, monkeypatch):
    """latexmk decides from its own database whether the sources changed
    and skips the engine when they did not, so the first build after Allow
    ran nothing and the program the document named still had not run.
    The change is carried through with `-g`, once, and the need for it
    outlives a build that was cancelled on the way."""
    (tmp_path / "main.tex").write_text(
        "\\documentclass{article}\\begin{document}x\\end{document}\n", encoding="utf-8"
    )
    state = {"escape": "asked"}
    build = CompileScheduler(paths_in(tmp_path), shell_escape=lambda: state["escape"])
    seen: list[list[str]] = []
    outcome = {"code": 0}

    class Done:
        pid = 0

        @property
        def returncode(self):
            return outcome["code"]

        async def wait(self):
            return outcome["code"]

    async def fake_exec(*argv, **_):
        seen.append(list(argv))
        return Done()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    asyncio.run(build.build())
    build._needs_full = False
    assert "-g" not in seen[-1]

    state["escape"] = "on"
    outcome["code"] = -15            # cancelled on the way, as by a keystroke
    asyncio.run(build.build())
    assert seen[-1][0] == "latexmk" and "-g" in seen[-1] and "-shell-escape" in seen[-1]

    outcome["code"] = 0              # the replacement build completes
    asyncio.run(build.build())
    assert "-g" in seen[-1], "the cancelled build must not have spent the rerun"

    build._needs_full = False
    asyncio.run(build.build())
    assert seen[-1][0] == "pdflatex" and "-g" not in seen[-1], "once is enough"


# -- the two halves of the answer ------------------------------------------

def test_the_project_asks_in_its_own_toml(tmp_path):
    (tmp_path / "nexttex.toml").write_text(
        '[project]\nname = "T"\nshell_escape = true\n', encoding="utf-8"
    )
    config = ProjectConfig.load(tmp_path)
    assert config.shell_escape is True
    config.save(tmp_path)
    assert "shell_escape = true" in (tmp_path / "nexttex.toml").read_text(encoding="utf-8")


@pytest.mark.parametrize("raw", ['"true"', "1", '"yes"'])
def test_only_a_real_true_is_a_request(tmp_path, raw):
    """A string or a number is not a request: the key is validated rather
    than trusted, since the file may have come from somebody else."""
    (tmp_path / "nexttex.toml").write_text(
        f'[project]\nname = "T"\nshell_escape = {raw}\n', encoding="utf-8"
    )
    assert ProjectConfig.load(tmp_path).shell_escape is False


def test_no_key_is_written_when_the_project_does_not_ask(tmp_path):
    ProjectConfig(name="T").save(tmp_path)
    assert "shell_escape" not in (tmp_path / "nexttex.toml").read_text(encoding="utf-8")


def test_the_machine_answers_per_project_in_its_own_settings(tmp_path, monkeypatch):
    monkeypatch.setattr(Settings, "path", classmethod(lambda cls: tmp_path / "config.json"))
    settings = Settings()
    assert settings.shell_escape_allowed == []
    settings.shell_escape_allowed = ["abc123"]
    settings.save()
    assert Settings.load().shell_escape_allowed == ["abc123"]


def test_an_older_settings_file_without_the_list_still_loads(tmp_path, monkeypatch):
    monkeypatch.setattr(Settings, "path", classmethod(lambda cls: tmp_path / "config.json"))
    (tmp_path / "config.json").write_text('{"port": 8123}', encoding="utf-8")
    assert Settings.load().shell_escape_allowed == []


# -- the drawer's words ---------------------------------------------------

def test_mintes_complaint_is_explained_as_a_permission_not_an_edit():
    found = explain("Package minted Error: You must invoke LaTeX with the -shell-escape flag.")
    assert found and found["title"] == "This package needs shell escape"
    assert "shell_escape = true" in found["fix"]

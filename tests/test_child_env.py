"""A build or a figure script is not handed the server's credentials.

Q-006: both were started with the server's whole environment, so a figure
script, or a build with shell escape on, could print any key the server
was started with. Git has long had an environment built from nothing; a
build cannot, since TeX reads more variables than anyone could list, so
what looks like a credential is taken out and the rest passes.
"""

import asyncio
from pathlib import Path

from nexttex import plots
from nexttex.childenv import without_secrets
from nexttex.compile import CompileScheduler, ProjectPaths

SECRETS = {
    "OPENAI_API_KEY": "sk-test", "ANTHROPIC_API_KEY": "sk-ant", "GITHUB_TOKEN": "ghp",
    "GH_TOKEN": "gho", "AWS_SECRET_ACCESS_KEY": "aws", "MY_SERVICE_PASSWORD": "pw",
    "HF_HOME": "/hub",
}
KEPT = {
    "PATH": "/usr/bin", "HOME": "/home/w", "TEXMFHOME": "/home/w/texmf", "LANG": "C.UTF-8",
    "SSH_AUTH_SOCK": "/run/agent", "GIT_AUTHOR_NAME": "W", "SystemRoot": "C:\\Windows",
}


def test_credential_names_are_taken_out_and_the_rest_pass():
    kept = without_secrets({**SECRETS, **KEPT})
    assert kept == KEPT


def test_a_figure_script_runs_without_them(tmp_path, monkeypatch):
    for name, value in {**SECRETS, **KEPT}.items():
        monkeypatch.setenv(name, value)
    env = plots.environment(tmp_path)
    assert not set(SECRETS) & set(env)
    assert env["TEXMFHOME"] == "/home/w/texmf"


def test_a_build_runs_without_them(tmp_path, monkeypatch):
    for name, value in SECRETS.items():
        monkeypatch.setenv(name, value)
    (tmp_path / "main.tex").write_text("\\documentclass{article}\\begin{document}x\\end{document}\n")
    build = CompileScheduler(ProjectPaths(root=tmp_path, main=tmp_path / "main.tex",
                                          build_dir=tmp_path / "build"))
    seen: list[dict] = []

    class Done:
        returncode = 0
        pid = 0

        async def wait(self):
            return 0

    async def fake_exec(*argv, env=None, **_):
        seen.append(dict(env or {}))
        return Done()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    asyncio.run(build.build())
    assert seen, "the engine was never started"
    assert not set(SECRETS) & set(seen[-1])
    assert seen[-1].get("PATH")

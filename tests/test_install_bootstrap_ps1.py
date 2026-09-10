"""The Windows bootstrap, as far as anything can check it from here.

`pwsh` is not installed on the machine this was written on, so every test in
this file skips locally and runs in CI, where `ubuntu-latest` ships
PowerShell 7. That is worth having anyway: it is the only place `install.ps1`
goes through a real parser, and the two functions checked below are the ones
whose bugs have actually reached a user -- a path that became a directory
called `~`, and a set of options silently dropped after the clone.

What it cannot cover, and what only a real `windows-latest` job ever will:
`winget`, `schtasks`, the `WScript.Shell` COM object, and a console on a
legacy code page.
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"

pytestmark = pytest.mark.skipif(
    shutil.which("pwsh") is None, reason="pwsh is not installed here"
)


def pwsh(script: str) -> str:
    result = subprocess.run(
        ["pwsh", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout


def with_functions_of(name: str, body: str) -> str:
    """Pull the function definitions out of a script and run `body` after them.

    Dot-sourcing the whole file would run the install; the parser hands back
    just the definitions, which is the part worth calling directly.
    """
    path = SCRIPTS / name
    return f"""
$errors = $null
$tree = [System.Management.Automation.Language.Parser]::ParseFile(
  '{path}', [ref]$null, [ref]$errors)
if ($errors) {{ $errors; throw 'does not parse' }}
$functions = $tree.FindAll({{
  $args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst]
}}, $true)
foreach ($function in $functions) {{
  Invoke-Expression $function.Extent.Text
}}
{body}
"""


@pytest.mark.parametrize("name", ["install.ps1", "register-task.ps1",
                                  "fetch-interface.ps1", "update.ps1"])
def test_every_powershell_script_parses(name):
    pwsh(f"""
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  '{SCRIPTS / name}', [ref]$null, [ref]$errors) | Out-Null
if ($errors) {{ $errors | ForEach-Object {{ Write-Host $_ }}; exit 1 }}
""")


def test_a_typed_tilde_becomes_the_home_directory():
    """PowerShell expands ~ only for its own providers, never in a string
    that came from Read-Host -- so "~\\code\\NextTex" would otherwise become
    a directory actually called "~"."""
    out = pwsh(with_functions_of("install.ps1", r"""
Write-Output (Resolve-Target '~')
Write-Output (Resolve-Target '~/code/NextTex')
Write-Output (Resolve-Target '~\')
"""))
    lines = [line for line in out.splitlines() if line.strip()]
    home = str(Path.home())
    assert lines[0].rstrip("/\\") == home.rstrip("/\\")
    assert "code" in lines[1] and "~" not in lines[1]
    # "~\" alone: Join-Path refuses an empty ChildPath, and being handed the
    # same empty-string complaint this whole bootstrap exists to stop would
    # be a poor joke.
    assert lines[2].rstrip("/\\") == home.rstrip("/\\")


def test_quotes_around_a_pasted_path_are_stripped():
    out = pwsh(with_functions_of("install.ps1", r"""
Write-Output (Resolve-Target '"/tmp/some where"')
"""))
    assert '"' not in out


def test_an_empty_answer_is_not_a_path():
    out = pwsh(with_functions_of("install.ps1", r"""
$result = Resolve-Target '   '
Write-Output ($null -eq $result)
"""))
    assert "True" in out


def test_every_option_is_forwarded_across_the_clone():
    """The bug this replaced forwarded -Yes and -Bind and dropped the rest,
    so somebody who asked for a named instance got an ordinary one and was
    never told why.

    The first attempt at the fix read `$PSBoundParameters` inside the
    function, which is an automatic variable in *every* scope: it forwarded
    nothing at all.  Running this is what found that.
    """
    out = pwsh(with_functions_of("install.ps1", r"""
$bound = [System.Collections.Generic.Dictionary[string, object]]::new()
$bound['Yes'] = [switch]$true
$bound['Tex'] = 'none'
$bound['Agent'] = 'openai'
$bound['Instance'] = 'scratch'
$bound['NoService'] = [switch]$true
$bound['Dir'] = 'D:\somewhere'
$bound['Plain'] = [switch]$false
Write-Output ((Get-ForwardedArguments $bound) -join ' ')
"""))
    assert "-Yes" in out
    assert "-Tex none" in out
    assert "-Agent openai" in out
    assert "-Instance scratch" in out
    assert "-NoService" in out
    # -Dir is deliberately spent: by then we are standing in the directory
    # it chose, and forwarding it would send the second run looking again.
    assert "-Dir" not in out
    # A switch that was bound but not present is not an instruction.
    assert "-Plain" not in out


def test_the_helper_takes_the_arguments_the_installer_gives_it():
    """`nexttex/install/service.py` builds this argv; the script has to
    accept exactly those parameter names or the login step fails at the very
    last moment of an otherwise good install."""
    out = pwsh(f"""
$errors = $null
$tree = [System.Management.Automation.Language.Parser]::ParseFile(
  '{SCRIPTS / "register-task.ps1"}', [ref]$null, [ref]$errors)
$block = $tree.ParamBlock
foreach ($parameter in $block.Parameters) {{
  Write-Output $parameter.Name.VariablePath.UserPath
}}
""")
    names = {line.strip() for line in out.splitlines() if line.strip()}
    from nexttex.install.service import register_task_argv

    given = {argument.lstrip("-") for argument in register_task_argv(Path("/x"), "")
             if argument.startswith("-") and argument not in
             ("-NoProfile", "-ExecutionPolicy", "-File")}
    assert given <= names, f"the installer passes {given - names}, which the script has no parameter for"


def test_the_documented_install_line_can_run_its_own_prologue():
    """`irm ... | iex` is the install line the README gives, and everything
    it does before the first prompt is the comment-based help and the
    `param` block.  `iex` has no script file to bind parameters against, so
    that block runs in the caller's scope, and an attribute there is applied
    to a variable rather than declared on a parameter.  A `ValidateSet` that
    forbids its own default therefore stops the install on line one, which
    is how a user found it.

    Everything after the `param` block is cut off so that running this does
    not run an install.  `test_every_windows_default_is_allowed_by_its_own
    _validate_set` in the cross-platform tests is the cheap version of the
    same check, and the one that runs on a machine without `pwsh`.
    """
    text = (SCRIPTS / "install.ps1").read_text(encoding="utf-8")
    head, cut, _ = text.partition("$ErrorActionPreference")
    assert cut, "the prologue no longer ends where this test cuts it"
    output = pwsh("Invoke-Expression @'\n" + head + "\n'@\nWrite-Host 'ran'")
    assert "ran" in output


def test_the_interface_checksum_is_right_without_get_filehash(tmp_path):
    """`Get-FileHash` arrived in PowerShell 4.0, and a user's machine had
    something older: the interface downloaded, both halves, and then the
    script stopped on "the term 'Get-FileHash' is not recognized", so the
    install finished with no interface in it.

    A checksum that is merely present is worth nothing, and a hand-rolled
    one is exactly the kind that silently returns the wrong string, so this
    checks the digest against Python's rather than checking that it ran.
    """
    payload = b"the interface, or something standing in for it\n"
    target = tmp_path / "payload.tar.gz"
    target.write_bytes(payload)

    output = pwsh(with_functions_of(
        "fetch-interface.ps1", f"Write-Host (Get-Sha256 '{target}')"
    ))
    assert hashlib.sha256(payload).hexdigest() in output

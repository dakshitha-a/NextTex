"""A MiKTeX log on Windows attributes a warning to the file it came from.

Q-019, confirmed on the Windows laptop after the probe: a build with an
overfull box on line 3 of `chapters/one.tex` showed the warning against
`main.tex`, in the drawer and from the parser called directly. The log
names files with a drive letter and with separators mixed inside one path;
the pattern that follows which file TeX has open took neither. These are
the lines the laptop's `build/main.log` held, with the parts between them
cut down.
"""

from pathlib import Path

from nexttex.latexlog import parse

LOG = r"""This is pdfTeX, Version 3.141592653-2.6-1.40.28 (MiKTeX 25.12) (preloaded format=pdflatex 2026.9.24)
entering extended mode
**C:/Users/daksh/test/q019/main.tex
(C:/Users/daksh/test/q019/main.tex
LaTeX2e <2025-06-01> patch level 2
L3 programming layer <2025-08-13>
(C:\Users\daksh\AppData\Local\Programs\MiKTeX\tex/latex/base\article.cls
Document Class: article 2025/01/22 v1.4n Standard LaTeX document class
(C:\Users\daksh\AppData\Local\Programs\MiKTeX\tex/latex/base\size10.clo))
(C:\Users\daksh\AppData\Local\Programs\MiKTeX\tex/latex/l3backend\l3backend-pdf
tex.def)
(C:\Users\daksh\test\q019\build\main.aux)
(C:\Users\daksh\test\q019\chapters/one.tex
Overfull \hbox (116.40865pt too wide) in paragraph at lines 3--3
[]\OT1/cmr/m/n/10 Averyveryveryveryveryveryveryveryveryveryveryverylongword
 []

) [1{C:/Users/daksh/AppData/Local/MiKTeX/fonts/map/pdftex/pdftex.map}]
(C:\Users\daksh\test\q019\build\main.aux) )
Output written on C:/Users/daksh/test/q019/build/main.pdf (1 page, 12345 bytes).
"""


def test_a_warning_in_an_input_file_is_put_against_that_file(tmp_path):
    parsed = parse(LOG, tmp_path, tmp_path / "main.tex")
    [overfull] = [d for d in parsed.diagnostics if d.message.startswith("Overfull")]
    assert str(overfull.file).replace("\\", "/").endswith("chapters/one.tex"), overfull.file
    assert overfull.line == 3


def test_every_file_the_engine_opened_is_named(tmp_path):
    parsed = parse(LOG, tmp_path, tmp_path / "main.tex")
    names = {str(path).replace("\\", "/").rsplit("/", 1)[-1] for path in parsed.opened}
    assert {"main.tex", "one.tex", "article.cls", "main.aux"} <= names


def test_paths_the_server_sends_use_forward_slashes():
    """Q-071: a tab on the Windows laptop read `chapters\\one.tex`. Every
    place the server turns a path into the name it sends is `as_posix()`
    now; `str()` of a relative path is what said it with backslashes. Read
    from the source, since this host cannot make a Windows path."""
    root = Path(__file__).resolve().parents[1]
    offenders = []
    for name in ("nexttex/project.py", "server/session.py"):
        for number, line in enumerate((root / name).read_text().splitlines(), 1):
            if "str(" in line and ".relative_to(" in line and "is_control_path" not in line:
                offenders.append(f"{name}:{number}: {line.strip()}")
    assert not offenders, offenders

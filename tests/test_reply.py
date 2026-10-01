"""The reply to the reviewers, written from open comment threads."""

from pathlib import Path

from nexttex import reply

TEMPLATE = (Path(__file__).parent.parent / "nexttex" / "templates" / "reply" / "main.tex").read_text()
THREADS = [
    {
        "path": "chapters/two.tex", "line": 14, "quote": "180 fs & 2.1 ps",
        "messages": [
            {"name": "Mira", "body": "Is this ours or\nfrom Schuurman_2018? 50% sure."},
            {"name": "You", "body": "Ours, from the anisotropy."},
        ],
    },
    {"path": "main.tex", "line": 3, "quote": "", "messages": [{"name": "Jonas", "body": "Which solvent?"}]},
]


def test_a_point_per_thread_with_its_quote_its_place_and_the_discussion():
    written = reply.points(THREADS)
    assert written.count("\\point{") == 2
    assert "\\point{Is this ours or from Schuurman\\_2018? 50\\% sure.}" in written
    assert "\\quoted{180 fs \\& 2.1 ps}" in written
    assert "\\source{chapters/two.tex:14}" in written
    assert "% You: Ours, from the anisotropy." in written
    assert written.count("\\begin{reply}") == 2


def test_a_new_letter_replaces_the_template_s_example_point():
    letter = reply.letter(None, TEMPLATE, THREADS, now=0)
    assert "The first point the reviewer made." not in letter
    assert letter.count("\\point{") == 2
    assert letter.index("\\point{Is this") < letter.index("\\end{document}")
    assert "\\newcommand{\\point}" in letter


def test_an_existing_letter_gains_points_before_its_end_and_keeps_its_answers():
    first = reply.letter(None, TEMPLATE, THREADS[:1], now=0)
    answered = first.replace("\\begin{reply}\n\n\\end{reply}", "\\begin{reply}\nWe checked.\n\\end{reply}")
    again = reply.letter(answered, TEMPLATE, THREADS[1:], now=0)
    assert "We checked." in again
    assert again.count("\\point{") == 2
    assert again.index("\\point{Which solvent?}") < again.index("\\end{document}")
    assert again.rstrip().endswith("\\end{document}")


def test_a_letter_with_every_special_character_compiles(tmp_path):
    import shutil
    import subprocess

    import pytest

    if shutil.which("pdflatex") is None:
        pytest.skip("pdflatex is needed")
    threads = [{
        "path": "chapters/two_a.tex", "line": 14, "quote": "50% of #runs & {x} ~ ^ \\cmd",
        "messages": [{"name": "M", "body": "Is $x$ right? 100% sure_not"}, {"name": "Y", "body": "yes"}],
    }]
    (tmp_path / "main.tex").write_text(reply.letter(None, TEMPLATE, threads, now=0))
    subprocess.run(["pdflatex", "-interaction=nonstopmode", "main.tex"], cwd=tmp_path, capture_output=True, timeout=120)
    log = (tmp_path / "main.log").read_text(errors="replace")
    assert (tmp_path / "main.pdf").is_file() and "\n! " not in log

"""When the preview waits longer.

The rule: a half-typed equation is not an error.  Reporting it as one while
the writer is still typing it is the most irritating thing a live preview
can do, so the build waits until the construct closes.
"""

from server.session import mid_construct

SETTLED = r"""\documentclass{article}
\begin{document}
The gap is $\Delta E$ and the rate is $k$.
\begin{equation}
  E = mc^2
\end{equation}
\end{document}
"""


def test_a_finished_document_is_not_held():
    assert mid_construct(SETTLED) is False


def test_an_unclosed_dollar_holds_the_build():
    assert mid_construct(SETTLED.replace("$k$", "$k")) is True


def test_a_begin_without_its_end_holds_the_build():
    assert mid_construct(SETTLED.replace("\\end{equation}", "")) is True


def test_a_mismatched_environment_holds_the_build():
    assert mid_construct(SETTLED.replace("\\end{equation}", "\\end{align}")) is True


def test_an_escaped_dollar_is_not_a_delimiter():
    """A price is not the start of an equation."""
    assert mid_construct(SETTLED.replace("The gap", "It cost \\$5. The gap")) is False


def test_the_preamble_is_not_counted():
    """A package's own braces are not the writer's unfinished work."""
    assert mid_construct("\\usepackage{amsmath}\n" + SETTLED) is False

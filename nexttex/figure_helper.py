"""Copied into a project as scripts/figure.py the first time it plots.

Two functions and no more. Everything a paper figure needs decided is
decided once here, so the script the agent writes is the part worth having a
model write: read the data, plot it, label the axes.

Edit this file. It is in your project, it is yours, and nothing overwrites
it after the first time. The two numbers most worth changing are at the top.
"""

from pathlib import Path

import matplotlib

# Never a window. This runs in a subprocess with no display, and pyplot.show()
# would otherwise sit waiting for a GUI event loop that will never arrive.
matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402  (after the backend is set)

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
FIGURES = PROJECT / "figures"

# The width your document actually gives a figure, in inches.
#
# This is the number that matters, and the only one here that depends on
# your document rather than on good practice. The rule it exists to keep is
# simple and is what makes a figure look like it belongs: draw it at the
# width it will be printed at, include it at \linewidth with no scaling, and
# the 9 pt labels in plotstyle.mplstyle are 9 pt on the page, the same size
# as the caption under them.
#
# Both mistakes are easy and both look wrong in the same way. Drawing at
# matplotlib's default 6.4 inches and including it at 0.8\linewidth shrinks
# the labels to about 5 pt, which is why every default figure is unreadable.
# Drawing a 3.4 inch figure and including it at the full 6.5 inch text width
# of a one-column article magnifies them by nearly two, and the axis label
# ends up larger than the body text.
#
# So `\linewidth` decides which of these you want, and `\linewidth` means
# different things in different classes:
#
#   \documentclass{article}    one column, so \linewidth is the text
#                              width: use width="page", the default
#   \documentclass[twocolumn]  \linewidth is one column: use width="column"
#   a figure spanning both      figure* in a two-column class: width="page"
#
# 6.5 is a one-column article at the one inch margins NextTex's own template
# sets. 3.4 is roughly a column of a two-column journal page. To be exact
# rather than roughly right, put \showthe\textwidth in your preamble, build
# once, and read the value off the log: divide points by 72.27 for inches.
PAGE_INCHES = 6.5
COLUMN_INCHES = 3.4

#: The height as a fraction of the width, per width, because the right
#: proportion is not the same for both.
#:
#: 0.62 is the golden section and is right for a narrow column figure. A
#: figure at the full text width and that proportion is four inches tall,
#: which is a third of the page for one plot: wide figures want to be
#: proportionally shorter, and the data usually reads better for it.
#:
#: A panel of maps or a correlation matrix wants 1.0, and you pass that.
ASPECT = {"page": 0.45, "column": 0.62}
DEFAULT_ASPECT = 0.5

plt.style.use(str(HERE / "plotstyle.mplstyle"))


def figure(width="page", aspect=None, **kwargs):
    r"""A figure and its axes, at the width it will be printed at.

    `width` is "page", "column", or a number of inches. The default is the
    full text width, because that is what `\linewidth` gives in a
    one-column document and a one-column document is what
    `\documentclass{article}` and this app's own template produce. In a
    two-column class, pass width="column".

    `aspect` is the height as a fraction of the width, and it defaults to
    something sensible for the width you asked for. Pass 1.0 for a matrix or
    a panel of maps.

    Extra arguments go to `plt.subplots`, so `figure(ncols=2)` gives two
    panels side by side that still add up to one text width.
    """
    inches = {"column": COLUMN_INCHES, "page": PAGE_INCHES}.get(width, width)
    inches = float(inches)
    if aspect is None:
        aspect = ASPECT.get(width, DEFAULT_ASPECT)
    rows = kwargs.get("nrows", 1)
    return plt.subplots(figsize=(inches, inches * float(aspect) * rows), **kwargs)


def save(fig, name):
    r"""Write the figure into the project's figures/ directory, as a PDF.

    A PDF because a figure in a paper is vector line work, and a PNG of it
    is resolution-locked the moment it is written: it will be the wrong size
    for the next journal that asks. Pass a name ending in .png for the cases
    where a raster is honestly right, a micrograph or a heatmap with a
    million cells.

    Returns the path, project-relative, which is what \includegraphics
    wants.
    """
    name = str(name)
    if not name.lower().endswith((".pdf", ".png", ".jpg", ".jpeg")):
        name += ".pdf"
    FIGURES.mkdir(parents=True, exist_ok=True)
    out = FIGURES / Path(name).name
    fig.savefig(out)
    plt.close(fig)
    return out.relative_to(PROJECT).as_posix()

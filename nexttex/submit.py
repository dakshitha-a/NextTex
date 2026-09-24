r"""What a venue would send back, read off the last build and the sources.

A paper goes out with a `\today` in the footer, a figure at 72 ppi, a
`% TODO: check this number` beside the number, three references to
`fig:results` and none to `fig:ablation`, two entries in the `.bib` that
nobody cites, and the author block still in place for a blind review.
None of that stops the build, so nothing in the drawer says it. Nearly
every input is already parsed somewhere: undefined references and
citations, overfull boxes, the page count and a missing file come out of
the log; label definitions and uses out of `usage`; bibliography keys
out of the vendored `.bib` reader. What is new is the checks a log cannot
make: whether every font is embedded, which `pdffonts` answers; the
resolution of every raster image, which `pdfimages -list` answers; and a
handful of things a writer leaves in the source on purpose while
writing and forgets on the way out.

None of it involves a model, and every row names the file and line where
it has one. A row from the PDF has a page instead, and a row about the
document as a whole has neither.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from . import latexlog, usage
from .references import _load
from .tools import ensure_tex_on_path

#: Under this, a raster image is a screenshot rather than a figure.  Print
#: wants 300; a chart exported at 150 reads on paper.  The row says the
#: number, so the writer decides.
LOW_PPI = 150
#: An overfull box narrower than this is invisible on the page.
OVERFULL_PT = 5.0
#: A run of whole-line comments this long is a paragraph somebody took
#: out and kept, not an annotation.
COMMENTED_CHARS = 200
COMMENTED_LINES = 3
TOOL_TIMEOUT = 30

TODAY = re.compile(r"\\today\b")
TODO_COMMAND = re.compile(r"\\(?:todo|TODO|fixme|FIXME)\b")
#: The line that defines `\todo` is not a note; a paper without todonotes
#: often has a `\newcommand{\todo}[1]{}` of its own.
TODO_DEFINITION = re.compile(r"\\(?:new|renew|provide)command\*?\s*\{?\s*\\(?:todo|TODO|fixme|FIXME)\b")
TODO_WORD = re.compile(r"\b(?:TODO|FIXME|XXX)\b")
#: The lines a comment run is not made of: an editor's magic comment and
#: a rule of percent signs.
MAGIC_COMMENT = re.compile(r"^\s*%\s*!")
RULE_COMMENT = re.compile(r"^\s*%[%\s-]*$")
AUTHOR = re.compile(r"\\author\s*(?:\[[^\]]*\])?\s*\{")
#: Commands that name a person or an institution.  `\thanks` is the
#: footnote on the author line; `\orcid` and `\email` are theirs too.
IDENTIFYING = re.compile(
    r"\\(?:affiliation|affil|institute|thanks|email|orcid|orcidlink|acknowledgments|"
    r"acknowledgements)\b"
)
ACKNOWLEDGEMENTS = re.compile(
    r"\\(?:section|subsection|chapter)\*?\s*\{\s*Acknowledg|\\begin\s*\{\s*acks\s*\}", re.I,
)
OVERFULL = re.compile(r"^Overfull \\[hv]box \((?P<amount>[0-9.]+)pt too (?:wide|high)")
NOT_FOUND = re.compile(r"not found", re.I)
#: The types `parse_bib` returns that are not entries.
NOT_ENTRIES = {"comment", "string", "preamble"}

#: Per kind: the sentence under the row and what to do about it.  `title`
#: is the group heading in the panel, so it reads as a category.
EXPLAIN = {
    "undefined": {
        "title": "Undefined references and citations",
        "detail": "The build could not resolve this key, so the page shows ?? where it should show a number.",
        "fix": "Check the key against its \\label or the .bib entry, or run a full build if the bibliography changed.",
    },
    "overfull": {
        "title": "Overfull boxes",
        "detail": "A line runs into the margin by more than five points, which a reviewer sees as a black bar or as text in the margin.",
        "fix": "Reword the sentence, allow a hyphenation with \\-, or let the line stretch with \\sloppy for that paragraph.",
    },
    "missing": {
        "title": "Missing files",
        "detail": "The build asked for a file that is not there; a figure or a style that is missing here is missing on the venue's machine too.",
        "fix": "Put the file in the project, or fix the path the document names.",
    },
    "duplicate-label": {
        "title": "Duplicate labels",
        "detail": "Two things carry the same label, so every reference to it points at whichever was defined last.",
        "fix": "Give one of them a new label; Rename from the label's hover changes every reference with it.",
    },
    "unused-label": {
        "title": "Unused labels",
        "detail": "This label is defined and nothing refers to it. Harmless, and often the sign of a figure or a section the text stopped discussing.",
        "fix": "Refer to it, or remove the label.",
    },
    "uncited": {
        "title": "Uncited bibliography entries",
        "detail": "The bibliography file has this entry and no document cites it. BibTeX leaves it out; biblatex lists it only under \\nocite.",
        "fix": "Cite it, or leave it: an uncited entry costs nothing unless the venue wants the .bib tidy.",
    },
    "today": {
        "title": "\\today",
        "detail": "The date is set when the PDF is built, so the venue's copy and the one you sent will carry different dates.",
        "fix": "Write the date out.",
    },
    "todo": {
        "title": "Notes to self",
        "detail": "A TODO, a FIXME or a \\todo is a note for the writer, and a printed \\todo is a note for the reviewer.",
        "fix": "Do it, or take the note out.",
    },
    "commented": {
        "title": "Commented-out paragraphs",
        "detail": "A run of comment lines this long is a paragraph that was taken out and kept. The venue's source upload carries it.",
        "fix": "Delete it; the history panel keeps every version.",
    },
    "blind": {
        "title": "Blind review",
        "detail": "The project says the review is blind, and this line names a person or an institution.",
        "fix": "Replace it with Anonymous, or comment it out for the submission and put it back for the camera-ready.",
    },
    "font": {
        "title": "Fonts",
        "detail": "A font that is not embedded is drawn with whatever the reader's machine has, and a Type 3 font is a bitmap that prints coarse and cannot be searched.",
        "fix": "For a Type 3 font, install cm-super or use \\usepackage{lmodern}; for a font that is not embedded, find what produced the figure or the PDF it was pasted from and export it with fonts embedded.",
    },
    "image": {
        "title": "Low-resolution images",
        "detail": "The image is drawn at fewer pixels per inch than print needs; 300 is the usual ask, and under 150 reads as a screenshot.",
        "fix": "Export the figure again at a higher resolution, or as a PDF or SVG so it is vector.",
    },
    "pages": {
        "title": "Page limit",
        "detail": "The build has more pages than the limit set for this project.",
        "fix": "Shorten it, or check whether the venue counts references and appendices.",
    },
    "metadata": {
        "title": "PDF metadata",
        "detail": "The PDF's own title and author are what a library, a search engine and a screen reader show for it, and a venue's system often fills its form from them.",
        "fix": "Load hyperref with pdfusetitle, which takes them from \\title and \\author, or set pdftitle and pdfauthor in \\hypersetup.",
    },
    "alt": {
        "title": "Figures without alt text",
        "detail": "A figure with no alternative text is silence to a screen reader, and more venues now ask for it.",
        "fix": "Give the figure alt={...} in \\includegraphics, which graphicx has read since 2021, or \\Description{...} in an ACM paper.",
    },
    "pdfa": {
        "title": "PDF/A",
        "detail": "The project says the venue wants PDF/A, and nothing in the preamble asks for it, so the PDF is an ordinary one.",
        "fix": "Load pdfx with the level the venue names, \\usepackage[a-2b]{pdfx}, or put \\DocumentMetadata{pdfstandard=a-2b} before \\documentclass.",
    },
    "tool": {
        "title": "Checks that could not run",
        "detail": "One of the poppler tools is not installed on this machine, so its check is not in this list.",
        "fix": "Install poppler-utils; pdffonts, pdfimages and pdfinfo come with it.",
    },
}


@dataclass
class Finding:
    kind: str
    severity: str           # "error", "warning" or "note"
    message: str
    file: str | None = None
    line: int | None = None
    page: int | None = None

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "severity": self.severity,
            "message": self.message,
            "file": self.file,
            "line": self.line,
            "page": self.page,
            "source": "submit",
            "explain": EXPLAIN.get(self.kind),
        }


@dataclass
class Report:
    document: str
    pages: int | None
    #: When the PDF was written, as a Unix time, or None with no PDF.
    built: float | None
    engine: str
    findings: list[Finding] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "document": self.document,
            "pages": self.pages,
            "built": self.built,
            "engine": self.engine,
            "findings": [finding.as_dict() for finding in self.findings],
            "counts": self.counts(),
        }

    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for finding in self.findings:
            out[finding.kind] = out.get(finding.kind, 0) + 1
        return out


# -- the log -----------------------------------------------------------------

def from_log(parsed: latexlog.ParsedLog, relative) -> list[Finding]:
    """Undefined references and citations, wide overfull boxes and missing
    files, each with the file and line the log gave."""
    out: list[Finding] = []
    for item in parsed.diagnostics:
        where = relative(item.file)
        if latexlog.UNDEFINED_CITATION.match(item.message) or latexlog.UNDEFINED_REFERENCE.match(item.message):
            out.append(Finding("undefined", "error", item.message.rstrip("."), where, item.line))
            continue
        wide = OVERFULL.match(item.message)
        if wide:
            try:
                amount = float(wide.group("amount"))
            except ValueError:
                amount = 0.0
            if amount >= OVERFULL_PT:
                out.append(Finding("overfull", "warning", item.message, where, item.line))
            continue
        if item.severity == "error" and NOT_FOUND.search(item.message):
            out.append(Finding("missing", "error", item.message.rstrip("."), where, item.line))
    return out


# -- the sources -------------------------------------------------------------

def _commented_runs(lines: list[str]) -> list[tuple[int, int]]:
    """`(first_line, chars)` of every run of comment lines long enough to
    be a paragraph."""
    runs: list[tuple[int, int]] = []
    start, count, chars = 0, 0, 0
    for number, raw in enumerate(lines, start=1):
        stripped = raw.lstrip()
        is_comment = stripped.startswith("%") and not MAGIC_COMMENT.match(raw) and not RULE_COMMENT.match(raw)
        if is_comment:
            if count == 0:
                start = number
            count += 1
            chars += len(stripped.lstrip("%").strip())
        else:
            if count >= COMMENTED_LINES and chars >= COMMENTED_CHARS:
                runs.append((start, chars))
            count, chars = 0, 0
    if count >= COMMENTED_LINES and chars >= COMMENTED_CHARS:
        runs.append((start, chars))
    return runs


def _author_named(lines: list[str], index: int) -> bool:
    """Whether the `\\author{` on this line names somebody: its argument,
    on this line and the two after it, does not say anonymous."""
    window = " ".join(lines[index:index + 3]).lower()
    return "anonym" not in window


def from_sources(texts: dict[str, str], bibs: dict[str, str], *, blind: bool) -> list[Finding]:
    """Everything the sources say on their own: labels, citations, dates,
    notes, kept paragraphs and, when the review is blind, names."""
    out: list[Finding] = []
    found = usage.scan(texts)
    for name, places in found.duplicates.items():
        first = places[0]
        for again in places[1:]:
            out.append(Finding(
                "duplicate-label", "error",
                f"\\label{{{name}}} is defined again; the first is at {first.path}:{first.line}",
                again.path, again.line,
            ))
    for name, where in sorted(found.unused.items(), key=lambda item: (item[1].path, item[1].line)):
        out.append(Finding("unused-label", "note", f"\\label{{{name}}} is never referenced", where.path, where.line))
    if not found.nocite_all:
        parse_bib = _load("verify_bib").parse_bib
        for path, text in sorted(bibs.items()):
            for entry in parse_bib(text):
                if entry["type"] in NOT_ENTRIES:
                    continue
                if entry["key"] not in found.cited:
                    out.append(Finding("uncited", "note", f"{entry['key']} is never cited", path, entry["line"]))
    for path in sorted(texts):
        if path.lower().endswith(".bib"):
            continue
        lines = texts[path].split("\n")
        for number, raw in enumerate(lines, start=1):
            cut = usage.comment_starts(raw)
            code = raw if cut is None else raw[:cut]
            comment = "" if cut is None else raw[cut + 1:]
            if TODAY.search(code):
                out.append(Finding("today", "warning", "\\today puts the build's date on the page", path, number))
            if TODO_COMMAND.search(code) and not TODO_DEFINITION.search(code):
                out.append(Finding("todo", "warning", f"a note left in the text: {code.strip()[:80]}", path, number))
            elif TODO_WORD.search(comment):
                out.append(Finding("todo", "note", f"a note in a comment: {comment.strip()[:80]}", path, number))
            if blind:
                if AUTHOR.search(code) and _author_named(lines, number - 1):
                    out.append(Finding("blind", "error", "\\author names the authors", path, number))
                elif IDENTIFYING.search(code):
                    out.append(Finding("blind", "error", f"names a person or an institution: {code.strip()[:80]}", path, number))
                elif ACKNOWLEDGEMENTS.search(code):
                    out.append(Finding("blind", "error", "an acknowledgements section, which usually names the funder and the lab", path, number))
        for start, chars in _commented_runs(lines):
            out.append(Finding(
                "commented", "note", f"a commented-out paragraph of about {chars} characters", path, start,
            ))
    return out


INCLUDEGRAPHICS = re.compile(r"\\includegraphics\s*(?:\[(?P<options>[^\]]*)\])?\s*\{(?P<file>[^}]*)\}")
ALT_KEY = re.compile(r"(?:^|,)\s*alt\s*=")
DESCRIPTION = re.compile(r"\\Description\b")
BEGIN_FIGURE = re.compile(r"\\begin\s*\{\s*figure\*?\s*\}")
END_FIGURE = re.compile(r"\\end\s*\{\s*figure\*?\s*\}")
PDFX = re.compile(r"\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\bpdfx\b[^}]*\}")
DOCUMENT_METADATA_PDFA = re.compile(r"\\DocumentMetadata\s*\{[^}]*pdfstandard\s*=\s*\{?\s*a-", re.I)


def alt_text(texts: dict[str, str]) -> list[Finding]:
    """A figure with no alternative text: an \\includegraphics without an
    `alt=` key, and, for ACM's classes, no \\Description before the figure
    ends."""
    out: list[Finding] = []
    for path in sorted(texts):
        if path.lower().endswith(".bib"):
            continue
        lines = texts[path].split("\n")
        for number, raw in enumerate(lines, start=1):
            cut = usage.comment_starts(raw)
            code = raw if cut is None else raw[:cut]
            for found in INCLUDEGRAPHICS.finditer(code):
                if ALT_KEY.search(found.group("options") or ""):
                    continue
                if _described(lines, number - 1):
                    continue
                out.append(Finding(
                    "alt", "warning", f"{found.group('file').strip()} has no alt text", path, number,
                ))
    return out


def _described(lines: list[str], index: int) -> bool:
    """Whether a \\Description comes before the figure this line is in
    ends, within twenty lines, which is where an ACM paper puts it. The
    next figure's start ends the search too, so a loose graphic does not
    borrow the \\Description of the figure after it."""
    for offset, line in enumerate(lines[index:index + 20]):
        if offset and BEGIN_FIGURE.search(line):
            return False
        if DESCRIPTION.search(line):
            return True
        if END_FIGURE.search(line):
            return False
    return False


def pdfa_missing(texts: dict[str, str]) -> list[Finding]:
    """A project whose venue wants PDF/A, with nothing in the sources that
    asks for it."""
    for text in texts.values():
        if PDFX.search(text) or DOCUMENT_METADATA_PDFA.search(text):
            return []
    return [Finding("pdfa", "error", "The venue wants PDF/A and nothing in the preamble asks for it")]


def _info(output: str) -> dict[str, str]:
    """`pdfinfo`'s key: value lines."""
    out: dict[str, str] = {}
    for line in (output or "").splitlines():
        key, colon, value = line.partition(":")
        if colon:
            out[key.strip()] = value.strip()
    return out


def metadata(output: str, *, blind: bool) -> list[Finding]:
    """The PDF's own title and author. A blind submission is expected to
    have no author, and one that has one is a blind finding instead."""
    info = _info(output)
    out: list[Finding] = []
    if not info.get("Title"):
        out.append(Finding("metadata", "warning", "The PDF has no title"))
    author = info.get("Author", "")
    if blind and author:
        out.append(Finding("blind", "error", f"The PDF's metadata names the author: {author[:80]}"))
    elif not blind and not author:
        out.append(Finding("metadata", "warning", "The PDF has no author"))
    return out


# -- the PDF -----------------------------------------------------------------

def _rows(output: str) -> tuple[list[str], list[list[str]]]:
    """A poppler table's header tokens and its rows as tokens.  Only the
    lines under the dashes are rows."""
    lines = [line for line in output.splitlines() if line.strip()]
    if len(lines) < 2 or not lines[1].startswith("-"):
        return [], []
    return lines[0].split(), [line.split() for line in lines[2:]]


def _font_rows(output: str) -> list[dict[str, str]]:
    """`pdffonts` rows.  Read from the right, because the type column is
    `Type 1C` or `CID TrueType` and a split on whitespace would shift it:
    the last two tokens are the object id, then uni, sub, emb and the
    encoding, none of which holds a space; the first token is the name,
    which a PostScript name cannot contain a space in; the type is what is
    left between."""
    rows: list[dict[str, str]] = []
    for tokens in _rows(output)[1]:
        if len(tokens) < 8:
            continue
        rows.append({
            "name": tokens[0],
            "type": " ".join(tokens[1:-6]),
            "encoding": tokens[-6],
            "emb": tokens[-5],
            "sub": tokens[-4],
            "uni": tokens[-3],
        })
    return rows


def _image_rows(output: str) -> list[dict[str, str]]:
    """`pdfimages -list` rows, by the header's names.  `object ID` is two
    header tokens over two value tokens, so the columns line up one for
    one and nothing else in the table holds a space."""
    header, rows = _rows(output)
    return [dict(zip(header, tokens)) for tokens in rows if len(tokens) == len(header)]


def fonts(output: str) -> list[Finding]:
    """The rows `pdffonts` earns: a font that is not embedded, and a Type 3
    font, which is a bitmap."""
    out: list[Finding] = []
    for row in _font_rows(output):
        name = row.get("name", "")
        if row.get("emb", "").lower() == "no":
            out.append(Finding("font", "error", f"{name} is not embedded"))
        elif row.get("type", "").startswith("Type 3"):
            out.append(Finding("font", "warning", f"{name} is a Type 3 bitmap font"))
    return out


def images(output: str) -> list[Finding]:
    """The rows `pdfimages -list` earns: a raster image drawn under
    `LOW_PPI`, with its page."""
    out: list[Finding] = []
    for row in _image_rows(output):
        if row.get("type") != "image":
            continue
        try:
            ppi = min(int(row["x-ppi"]), int(row["y-ppi"]))
            page = int(row["page"])
            width, height = int(row["width"]), int(row["height"])
        except (KeyError, ValueError):
            continue
        if ppi < LOW_PPI:
            out.append(Finding(
                "image", "warning",
                f"a {width} by {height} image on page {page} is drawn at {ppi} ppi",
                page=page,
            ))
    return out


def _run(argv: list[str]) -> str | None:
    """A poppler tool's stdout, or None when it is not here or failed."""
    ensure_tex_on_path()
    if not shutil.which(argv[0]):
        return None
    try:
        done = subprocess.run(argv, capture_output=True, text=True, timeout=TOOL_TIMEOUT)
    except (subprocess.SubprocessError, OSError):
        return None
    return done.stdout if done.returncode == 0 else None


def run_pdffonts(pdf: Path) -> str | None:
    return _run(["pdffonts", str(pdf)])


def run_pdfimages(pdf: Path) -> str | None:
    return _run(["pdfimages", "-list", str(pdf)])


def run_pdfinfo(pdf: Path) -> str | None:
    return _run(["pdfinfo", str(pdf)])


def pages_of(pdf: Path, info: str | None = None) -> int | None:
    info = run_pdfinfo(pdf) if info is None else info
    try:
        return int(_info(info or "").get("Pages", "").split()[0])
    except (IndexError, ValueError):
        return None


# -- all of it -----------------------------------------------------------------

def check(
    *,
    document: str,
    log_text: str | None,
    project_root: Path,
    main: Path,
    pdf: Path | None,
    engine: str,
    texts: dict[str, str],
    relative,
    blind: bool,
    page_limit: int,
    pdfa: bool = False,
    pdffonts=run_pdffonts,
    pdfimages=run_pdfimages,
    pdfinfo=run_pdfinfo,
) -> Report:
    """The whole report for one document.

    `texts` is every text file in the project by relative path, the open
    documents winning over the disk, which is what the rename route
    reads; `.bib` files are found among them.  `relative` turns the
    absolute path a log diagnostic carries into a project path.  The two
    tool runners are parameters so a test can hand in captured output.
    """
    findings: list[Finding] = []
    pages: int | None = None
    if log_text:
        parsed = latexlog.parse(log_text, project_root, main, main.parent)
        pages = parsed.pages
        findings.extend(from_log(parsed, relative))
    bibs = {path: text for path, text in texts.items() if path.lower().endswith(".bib")}
    sources = {path: text for path, text in texts.items() if path.lower().endswith(".tex")}
    findings.extend(from_sources(sources, bibs, blind=blind))
    findings.extend(alt_text(sources))
    if pdfa:
        findings.extend(pdfa_missing(sources))
    built: float | None = None
    if pdf is not None and pdf.is_file():
        built = pdf.stat().st_mtime
        fonts_out = pdffonts(pdf)
        if fonts_out is None:
            findings.append(Finding("tool", "note", "pdffonts is not installed, so fonts were not checked"))
        else:
            findings.extend(fonts(fonts_out))
        images_out = pdfimages(pdf)
        if images_out is None:
            findings.append(Finding("tool", "note", "pdfimages is not installed, so image resolution was not checked"))
        else:
            findings.extend(images(images_out))
        info_out = pdfinfo(pdf)
        if info_out is None:
            findings.append(Finding("tool", "note", "pdfinfo is not installed, so the PDF's title and author were not checked"))
        else:
            findings.extend(metadata(info_out, blind=blind))
        if pages is None:
            pages = pages_of(pdf, info_out)
    if page_limit > 0 and pages is not None and pages > page_limit:
        findings.append(Finding(
            "pages", "error", f"{pages} pages against a limit of {page_limit}",
        ))
    return Report(document=document, pages=pages, built=built, engine=engine, findings=findings)

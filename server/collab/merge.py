"""Three texts made into one: what the disk said, and two changes since.

An outside write is folded into the shared document by diffing the
document against the file. That was right while the document and the
file agreed before the write, and wrong otherwise: typing still inside
the flush's debounce, or a collaborator's paragraph not yet written out,
is in the document and not in the file, so a two-way diff read it as
something the file had deleted and deleted it. The last text this install
wrote is the common ancestor of both, so the fold is a merge.

Each side's change is a list of splices against the base, from the same
`edits_for` the fold uses. A splice from one side that no splice from the
other touches is kept. Where the two touch the same stretch of the base,
the disk's version of that stretch wins, which is the writer's rule for a
file and a document that disagree, and the caller keeps the document's
text as a version first.
"""

from __future__ import annotations

from dataclasses import dataclass

Span = tuple[int, int, str]


@dataclass
class Merged:
    text: str
    #: Whether both sides changed the same stretch, so the disk's text was
    #: taken there and the document's lost.
    clashed: bool


def _forward(spans: list[Span]) -> list[Span]:
    """`edits_for` hands its splices back to front; the walk wants them in
    order."""
    return sorted(spans, key=lambda span: (span[0], span[1]))


def _touch(a: Span, b: Span) -> bool:
    """Whether two splices on the same base cannot both be kept as they
    are: they overlap, or both insert at the same point."""
    a_start, a_end, _ = a
    b_start, b_end, _ = b
    if a_start == a_end and b_start == b_end:
        return a_start == b_start
    if a_start == a_end:
        return b_start < a_start < b_end
    if b_start == b_end:
        return a_start < b_start < a_end
    return a_start < b_end and b_start < a_end


def merge(base: str, ours: str, theirs: str, edits_for) -> Merged:
    """Ours and theirs, both changed from base, as one text.

    `edits_for(before, after)` is the fold's own splice finder, passed in so
    the two can never disagree about what a change is.
    """
    if ours == base:
        return Merged(theirs, False)
    if theirs == base or theirs == ours:
        return Merged(ours, False)
    mine = [(start, end, text, "ours") for start, end, text in _forward(edits_for(base, ours))]
    disk = [(start, end, text, "theirs") for start, end, text in _forward(edits_for(base, theirs))]
    every = sorted(mine + disk, key=lambda span: (span[0], span[1], span[3] != "theirs"))

    # Clusters of splices that touch, across the two sides.
    clusters: list[list[tuple[int, int, str, str]]] = []
    for span in every:
        if clusters and any(_touch(span[:3], other[:3]) for other in clusters[-1]):
            clusters[-1].append(span)
        else:
            clusters.append([span])

    out: list[str] = []
    at = 0
    clashed = False
    for cluster in clusters:
        sides = {span[3] for span in cluster}
        low = min(span[0] for span in cluster)
        high = max(span[1] for span in cluster)
        out.append(base[at:low])
        if len(sides) == 2:
            clashed = True
            chosen = [span for span in cluster if span[3] == "theirs"]
        else:
            chosen = cluster
        # The chosen side's splices, applied to the stretch they cover.
        cursor = low
        for start, end, text, _ in sorted(chosen, key=lambda span: (span[0], span[1])):
            out.append(base[cursor:start])
            out.append(text)
            cursor = end
        out.append(base[cursor:high])
        at = high
    out.append(base[at:])
    return Merged("".join(out), clashed)

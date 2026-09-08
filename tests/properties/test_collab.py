"""Properties of the shared document, over text nobody would think to write.

The interesting failures in a CRDT are not in the cases a person invents.
They are in the ones with a repeated character at a boundary, an empty
string, a lone newline, or a paste of the same paragraph twice -- which is
where a diff's prefix and suffix trimming meet and where an off-by-one lives.
"""

from hypothesis import given, settings
from hypothesis import strategies as st
from pycrdt import Doc, Text

from server.collab.store import edits_for, minimal_edit

# Deliberately a small alphabet.  Random unicode almost never produces the
# repeated runs and shared prefixes that break a diff; three letters and a
# newline produce almost nothing else.
text = st.text(alphabet="ab\n", max_size=60)
prose = st.text(alphabet="abc \n\\{}", max_size=120)


def apply_to_string(before: str, spans) -> str:
    out = before
    for start, end, replacement in spans:
        out = out[:start] + replacement + out[end:]
    return out


def apply_to_doc(doc: Doc, body: Text, spans) -> None:
    with doc.transaction():
        for start, end, replacement in spans:
            if end > start:
                del body[start:end]
            if replacement:
                body.insert(start, replacement)


@given(before=text, after=text)
def test_a_diff_always_reconstructs_the_target(before, after):
    assert apply_to_string(before, edits_for(before, after)) == after


@given(before=prose, after=prose)
def test_the_same_diff_applied_to_a_document_agrees(before, after):
    """The splices are computed against a Python string and applied to a
    Y.Text.  If the two ever disagree about an index, a collaborator's file
    quietly grows a character in the wrong place."""
    doc = Doc()
    doc["text"] = body = Text()
    if before:
        body += before
    apply_to_doc(doc, body, edits_for(before, after))
    assert str(body) == after


@given(unchanged=prose)
def test_no_change_produces_no_operations(unchanged):
    """The invariant the whole disk-to-document loop rests on: handing the
    document text it already holds must do nothing at all.

    Generated as one value rather than as two that happen to match -- asking
    Hypothesis for a pair and then filtering for equality throws away
    fifty inputs for every one it keeps.
    """
    assert edits_for(unchanged, unchanged) == []


@given(before=text, after=text)
def test_a_single_splice_also_reconstructs(before, after):
    start, end, replacement = minimal_edit(before, after)
    assert before[:start] + replacement + before[end:] == after


@given(base=prose, mine=prose, theirs=prose)
@settings(max_examples=60, deadline=None)
def test_two_peers_editing_the_same_file_converge(base, mine, theirs):
    """Two documents, the same starting text, an edit each, then a swap.

    Not "the result is what a person would want" -- no merge can promise
    that -- but that both peers end up holding *the same* thing, which is
    the promise a CRDT does make and the one everything else depends on.
    """
    first = Doc()
    first["text"] = first_body = Text()
    if base:
        first_body += base

    second = Doc()
    second.apply_update(first.get_update())
    second_body = second.get("text", type=Text)

    apply_to_doc(first, first_body, edits_for(base, mine))
    apply_to_doc(second, second_body, edits_for(base, theirs))

    # Each sends the other everything it is missing, as a reconnect does.
    first_state, second_state = first.get_state(), second.get_state()
    second.apply_update(first.get_update(second_state))
    first.apply_update(second.get_update(first_state))

    assert str(first_body) == str(second_body)


@given(edits=st.lists(st.tuples(st.integers(0, 40), prose), max_size=8))
@settings(max_examples=60, deadline=None)
def test_convergence_survives_edits_arriving_in_any_order(edits):
    """Updates are unordered by construction; this is that being true in
    practice, with the same set delivered forwards and backwards."""
    source = Doc()
    source["text"] = body = Text()

    # The state of an empty document, so the first update carries the base
    # text too.  Taking it after the base was added left both replicas
    # missing it -- they still agreed, so the test passed while checking
    # much less than it claimed to.
    updates = []
    seen = Doc().get_state()
    body += "the original text of the chapter\n"
    for where, addition in edits:
        if not addition:
            continue
        body.insert(min(where, len(str(body))), addition)
        updates.append(source.get_update(seen))
        seen = source.get_state()

    updates.append(source.get_update(seen))

    forwards, backwards = Doc(), Doc()
    for update in updates:
        forwards.apply_update(update)
    for update in reversed(updates):
        backwards.apply_update(update)

    forwards_text = str(forwards.get("text", type=Text))
    assert forwards_text == str(backwards.get("text", type=Text))
    assert forwards_text == str(body)

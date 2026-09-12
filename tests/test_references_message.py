"""What a 404 from a citation index is allowed to claim.

`cited_by` turned any 404 into "Semantic Scholar has no record of this
paper". The review got that for `10.1038/nature14539`, which is LeCun,
Bengio and Hinton in Nature, while `10.1145/3292500.3330701` and
`10.1109/CVPR.2016.90` resolved and returned their citations in full. The
index holds plenty of papers it will not find under the DOI you have.

A writer building a literature review acts differently on "nothing cites
this" than on "this lookup did not find it", and only the second is
something a 404 has established.
"""

import pytest

from nexttex import references


def test_a_lookup_that_missed_does_not_claim_the_paper_is_unknown(monkeypatch):
    class Response:
        status_code = 404

    class Missing(Exception):
        response = Response()

    class Stub:
        @staticmethod
        def cited_by(doi, rows):
            raise Missing("404 Client Error")

    monkeypatch.setattr(references, "_load", lambda name: Stub)

    with pytest.raises(LookupError) as raised:
        references.cited_by("10.1038/nature14539")

    said = str(raised.value)
    assert "could not find" in said
    assert "has no record" not in said, (
        "a failed lookup is still claiming the paper does not exist"
    )
    assert "10.1038/nature14539" in said


def test_a_failure_that_is_not_a_miss_is_not_turned_into_one(monkeypatch):
    class Stub:
        @staticmethod
        def cited_by(doi, rows):
            raise RuntimeError("connection reset")

    monkeypatch.setattr(references, "_load", lambda name: Stub)

    with pytest.raises(RuntimeError):
        references.cited_by("10.1038/nature14539")

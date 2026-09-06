"""What thinning is allowed to throw away.

Retention is the one place in this app where deleting data is the intended
behaviour, so the rules it must not break are asserted over generated
histories rather than over one hand-written list.
"""

import time

from hypothesis import HealthCheck, given, settings, strategies as st

from nexttex.history import History, Version

DAY = 86_400_000


def store(tmp_path) -> History:
    """`_thin` needs nothing from disk; this exists only to reach it."""
    return History(tmp_path / "history")


@st.composite
def histories(draw):
    now = time.time() * 1000
    count = draw(st.integers(min_value=1, max_value=60))
    # Strictly increasing timestamps: two versions with the same `at` and
    # the same everything else are equal as dataclasses, and a test that
    # cannot tell them apart cannot tell a drop from a duplicate either.
    offsets = draw(
        st.lists(
            st.integers(min_value=0, max_value=200 * 24 * 3600),
            min_size=count, max_size=count, unique=True,
        )
    )
    versions = []
    for index, offset in enumerate(sorted(offsets, reverse=True)):
        versions.append(Version(
            at=now - offset * 1000,
            sha=f"{index:064d}",
            bytes=draw(st.integers(min_value=0, max_value=10_000)),
            by=draw(st.sampled_from(["you", "claude"])),
            op=draw(st.sampled_from(["edit", "create", "delete", "restore", "undo"])),
            label=draw(st.one_of(st.none(), st.just("kept on purpose"))),
        ))
    return versions


@settings(max_examples=60, deadline=None,
          suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(versions=histories())
def test_thinning_never_invents_a_version(tmp_path, versions):
    kept = store(tmp_path)._thin(versions)
    assert all(version in versions for version in kept)


@settings(max_examples=60, deadline=None,
          suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(versions=histories())
def test_what_somebody_chose_to_keep_is_always_kept(tmp_path, versions):
    """A named version, anything Claude wrote, and every deletion: these are
    the three things a writer comes back looking for."""
    kept = store(tmp_path)._thin(versions)
    for version in versions:
        if version.permanent:
            assert version in kept, version


@settings(max_examples=60, deadline=None,
          suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(versions=histories())
def test_the_oldest_and_the_newest_always_survive(tmp_path, versions):
    kept = store(tmp_path)._thin(versions)
    assert versions[0] in kept and versions[-1] in kept


@settings(max_examples=60, deadline=None,
          suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(versions=histories())
def test_thinning_twice_is_thinning_once(tmp_path, versions):
    """Otherwise a log would shrink a little on every save, forever."""
    history = store(tmp_path)
    once = history._thin(versions)
    assert history._thin(once) == once


@settings(max_examples=60, deadline=None,
          suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(versions=histories())
def test_the_result_is_still_in_order(tmp_path, versions):
    kept = store(tmp_path)._thin(versions)
    assert [v.at for v in kept] == sorted(v.at for v in kept)

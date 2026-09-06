"""No path from a browser ever names a file outside the project.

This is the security boundary of the whole app, and it is one comparison in
one function -- exactly the shape of thing that is right for the cases
somebody thought of and wrong for the one they did not.  So it is asserted
over generated input rather than over a list.
"""

from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings, strategies as st

from nexttex.project import Project, ProjectConfig

# The pieces a path can be made of, weighted towards the ones that have ever
# escaped anything: parent segments, absolute roots, a home shortcut, and
# the separators themselves.
SEGMENTS = st.sampled_from([
    "..", ".", "/", "//", "\\", "~", "a", "chapter.tex", " ", "…",
    "%2e%2e", "....", "\x00", "C:", "$HOME", "-", "..;", "\n",
])
PATHS = st.lists(SEGMENTS, min_size=1, max_size=8).map("/".join)


def project(tmp_path) -> Project:
    # Built once per test rather than once per generated example: hypothesis
    # reuses the fixture's directory across every example it tries.
    root = tmp_path / "project"
    if root.is_dir():
        return Project(root=root.resolve(),
                       config=ProjectConfig(name="p", main="main.tex"))
    (root / "chapters").mkdir(parents=True)
    (root / "main.tex").write_text("x", encoding="utf-8")
    (tmp_path / "outside").mkdir()
    (tmp_path / "outside" / "secret.txt").write_text("private", encoding="utf-8")
    # A symlink pointing out of the project: the escape that is easy to
    # forget, because the path itself looks perfectly ordinary.
    (root / "escape").symlink_to(tmp_path / "outside")
    return Project(root=root.resolve(), config=ProjectConfig(name="p", main="main.tex"))


@settings(max_examples=300, deadline=None,
          suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(relative=PATHS)
def test_a_resolved_path_is_inside_the_project_or_it_raises(tmp_path, relative):
    subject = project(tmp_path)
    try:
        resolved = subject.resolve(relative)
    except (PermissionError, OSError, ValueError):
        return              # refused, which is the other allowed answer
    root = subject.root.resolve()
    assert resolved == root or root in resolved.parents, relative


@settings(max_examples=100, deadline=None,
          suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(name=st.text(min_size=1, max_size=20))
def test_an_ordinary_name_resolves_to_a_child(tmp_path, name):
    subject = project(tmp_path)
    try:
        resolved = subject.resolve(name)
    except (PermissionError, OSError, ValueError):
        return
    assert subject.root.resolve() in resolved.parents or resolved == subject.root


def test_the_symlink_the_property_relies_on_really_does_point_out(tmp_path):
    """A property that generates paths into a symlink that is not there
    proves nothing, so the fixture is checked on its own."""
    subject = project(tmp_path)
    assert (subject.root / "escape" / "secret.txt").read_text(
        encoding="utf-8") == "private"
    with pytest.raises(PermissionError):
        subject.resolve("escape/secret.txt")

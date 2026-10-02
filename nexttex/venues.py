"""The templates a new project can start from, read from their manifests.

A template is a directory under `nexttex/templates/` holding the files a
project starts with and a `template.toml` saying what they are: the title
the chooser shows, which file leads, and whether the blank scaffold of a
`main.tex`, an empty `references.bib` and a `figures/` folder belongs with
it.  The manifest is never copied into a project.  The module is not called
`templates` so that its name and the directory's never stand for each
other.
"""

from __future__ import annotations

import functools
from dataclasses import dataclass
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10
    import tomli as tomllib  # type: ignore

ROOT = Path(__file__).resolve().parent / "templates"
MANIFEST = "template.toml"
#: Files a template directory holds that are not the template's.
NOT_COPIED = frozenset({MANIFEST, ".gitkeep"})
KINDS = ("general", "journal", "conference", "thesis", "talk", "letter")


class ManifestError(ValueError):
    """A template's manifest is missing something or names a wrong thing."""


@dataclass(frozen=True)
class Template:
    name: str
    title: str
    kind: str
    order: int
    lead: str = "main.tex"
    scaffold: bool = True


def _read(directory: Path) -> Template:
    path = directory / MANIFEST
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ManifestError(f"{directory.name} has no {MANIFEST}") from None
    except tomllib.TOMLDecodeError as error:
        raise ManifestError(f"{directory.name}/{MANIFEST}: {error}") from None
    for key in ("title", "kind", "order"):
        if key not in data:
            raise ManifestError(f"{directory.name}/{MANIFEST} has no {key}")
    if data["kind"] not in KINDS:
        raise ManifestError(f"{directory.name}: kind {data['kind']!r} is not one of {KINDS}")
    template = Template(
        name=directory.name,
        title=str(data["title"]),
        kind=data["kind"],
        order=int(data["order"]),
        lead=str(data.get("lead", "main.tex")),
        scaffold=bool(data.get("scaffold", True)),
    )
    if not (directory / template.lead).is_file():
        raise ManifestError(f"{directory.name} leads with {template.lead}, which it does not have")
    return template


@functools.lru_cache(maxsize=None)
def templates(root: Path = ROOT) -> tuple[Template, ...]:
    """Every template, in the chooser's order.  Read once per process,
    since the directory is part of the program and changes only with it."""
    if not root.is_dir():
        return ()
    found = [_read(p) for p in root.iterdir() if p.is_dir()]
    return tuple(sorted(found, key=lambda t: (t.order, t.name)))


def get(name: str, root: Path = ROOT) -> Template | None:
    return next((t for t in templates(root) if t.name == name), None)


def files(name: str, root: Path = ROOT) -> list[Path]:
    """The files a template copies into a project, in a stable order."""
    source = root / name
    return [
        path for path in sorted(source.rglob("*"))
        if path.is_file() and path.name not in NOT_COPIED
    ]

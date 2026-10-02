"""The templates a new project can start from, read from their manifests.

A template is a directory under `nexttex/templates/` holding the files a
project starts with and a `template.toml` saying what they are: the title
the chooser shows, which file leads, and whether the blank scaffold of a
`main.tex`, an empty `references.bib` and a `figures/` folder belongs with
it.  The manifest is never copied into a project.  The module is not called
`templates` so that its name and the directory's never stand for each
other.

A venue's template also names its class, the publisher's page, and the
TeX Live packages its first build needs, each with one file of its that
says whether it is here.  NextTex ships only its own skeleton; the class
comes from TeX Live, which is how a template whose licence allows it is
passed on without copying it.  `catalogue.toml` beside the templates
lists the guides: venues whose files carry no licence that lets anyone
pass them on, with the way to get them from their publisher.
"""

from __future__ import annotations

import functools
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .tools import ensure_tex_on_path

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10
    import tomli as tomllib  # type: ignore

ROOT = Path(__file__).resolve().parent / "templates"
MANIFEST = "template.toml"
CATALOGUE = "catalogue.toml"
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
    venue: str = ""
    summary: str = ""
    cls: str = ""
    source: str = ""
    licence: str = ""
    #: TeX Live package to the file of its that says whether it is here.
    needs: dict = field(default_factory=dict)
    #: TeX Live package to the version last compared with its source.
    checked: dict = field(default_factory=dict)

    def as_dict(self, missing: list[str] | None) -> dict:
        return {
            "name": self.name, "title": self.title, "kind": self.kind,
            "venue": self.venue, "summary": self.summary, "class": self.cls,
            "source": self.source, "missing": missing,
        }


@dataclass(frozen=True)
class Guide:
    name: str
    title: str
    kind: str
    venue: str
    official: str
    steps: tuple[str, ...]

    def as_dict(self) -> dict:
        return {
            "name": self.name, "title": self.title, "kind": self.kind,
            "venue": self.venue, "official": self.official, "steps": list(self.steps),
        }


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
        venue=str(data.get("venue", "")),
        summary=str(data.get("summary", "")),
        cls=str(data.get("class", "")),
        source=str(data.get("source", "")),
        licence=str(data.get("licence", "")),
        needs={str(k): str(v) for k, v in data.get("needs", {}).items()},
        checked={str(k): str(v) for k, v in data.get("checked", {}).items()},
    )
    for package in template.checked:
        if package not in template.needs:
            raise ManifestError(f"{directory.name} checks {package}, which it does not need")
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


@functools.lru_cache(maxsize=None)
def guides(root: Path = ROOT) -> tuple[Guide, ...]:
    """The venues NextTex cannot ship, from `catalogue.toml`."""
    path = root / CATALOGUE
    if not path.is_file():
        return ()
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as error:
        raise ManifestError(f"{CATALOGUE}: {error}") from None
    found = []
    for entry in data.get("guide", []):
        for key in ("name", "title", "kind", "official", "steps"):
            if key not in entry:
                raise ManifestError(f"a guide in {CATALOGUE} has no {key}")
        if entry["kind"] not in KINDS:
            raise ManifestError(f"guide {entry['name']}: kind {entry['kind']!r} is not one of {KINDS}")
        if not str(entry["official"]).startswith("https://"):
            raise ManifestError(f"guide {entry['name']}: the official page must be https")
        found.append(Guide(
            name=str(entry["name"]), title=str(entry["title"]), kind=entry["kind"],
            venue=str(entry.get("venue", "")), official=str(entry["official"]),
            steps=tuple(str(step) for step in entry["steps"]),
        ))
    return tuple(found)


#: The answer kpsewhich gave for each file, kept until a package is
#: installed: `None` when there is no kpsewhich to ask.
_found: set[str] | None = None
_asked = False
TIMEOUT = 10


def forget() -> None:
    """Ask the TeX again next time; a package was just installed."""
    global _found, _asked
    _found, _asked = None, False


def _present(names: list[str]) -> set[str] | None:
    """Which of these files this TeX can find, asked of kpsewhich once
    for all of them, or `None` when there is no kpsewhich, as on a
    machine with no TeX at all."""
    # NEXTTEX_KPSEWHICH names another, as NEXTTEX_TLMGR does for the
    # package manager: `tests/fake_kpsewhich.py` in the browser tier.
    kpsewhich = os.environ.get("NEXTTEX_KPSEWHICH", "").strip()
    if not kpsewhich:
        ensure_tex_on_path()
        kpsewhich = shutil.which("kpsewhich") or ""
    if not kpsewhich:
        return None
    try:
        done = subprocess.run(
            [kpsewhich, *names], capture_output=True, text=True, timeout=TIMEOUT,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    # kpsewhich prints a path for each file it finds and nothing for the
    # rest, and exits 1 when any is missing, so the output is the answer.
    return {Path(line.strip()).name for line in done.stdout.splitlines() if line.strip()}


def missing(template: Template) -> list[str] | None:
    """The packages this template needs that the TeX lacks, in the order
    the manifest names them; `[]` when it has them all, and `None` when
    there is no way to tell."""
    global _found, _asked
    if not template.needs:
        return []
    if not _asked:
        wanted = sorted({f for t in templates() for f in t.needs.values()})
        _found, _asked = _present(wanted), True
    if _found is None:
        return None
    return [package for package, file in template.needs.items() if file not in _found]

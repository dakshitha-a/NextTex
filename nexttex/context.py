"""Templates, style guides and writing samples the agent should learn from.

A writing project carries more than its source: a formatting handbook it has
to obey, and -- if the writing is to sound like the person writing it --
samples of how that person actually writes.

The naive implementation puts those documents in the agent's context on
every turn. That is expensive and, worse, ineffective: a model handed twenty
pages of someone's prose and told "write like this" attends to the subject
matter far more reliably than to the manner. So each document is read once,
on upload, and distilled into a short description that goes in the system
prompt every turn. The full text stays on disk for when a detail is needed.

The distilled files are plain markdown and are meant to be edited. If the
description of a writer's voice is wrong, correcting it by hand is the
fastest way to fix the writing.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import secrets
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Literal

Kind = Literal["style", "voice", "source"]
KINDS: tuple[Kind, ...] = ("style", "voice", "source")

CONTEXT_DIR = "context"
MANIFEST = "manifest.json"

# Memory is paid for on every turn, in every conversation, so it is capped
# rather than allowed to grow into a second transcript.  The cap is a
# character count because that is what the writer sees in the editor.
MEMORY_MAX_CHARS = 4_000
MEMORY_HEADING = "# What this project asked to be remembered"

KIND_DIRS = {"style": "style", "voice": "voice", "source": "sources"}

KIND_LABEL = {
    "style": "template or formatting guide",
    "voice": "writing sample",
    "source": "source material",
}

# How much extracted text to hand the distiller.  A formatting handbook's
# rules are front-loaded; a writing sample's voice is evident within a few
# thousand words. Reading more costs tokens without changing the answer.
DISTILL_CHARS = 24_000


@dataclass
class Document:
    id: str
    kind: Kind
    filename: str
    added: float
    bytes: int
    pages: int | None = None
    note: str = ""

    def as_dict(self) -> dict:
        return {**asdict(self), "label": KIND_LABEL[self.kind]}


class ProjectContext:
    """The uploaded reference material for one project."""

    def __init__(self, state_dir: Path):
        self.root = state_dir / CONTEXT_DIR
        for name in (*KIND_DIRS.values(), "extracted"):
            (self.root / name).mkdir(parents=True, exist_ok=True)

    # -- paths ----------------------------------------------------------
    def _dir(self, kind: Kind) -> Path:
        return self.root / KIND_DIRS[kind]

    @property
    def manifest_path(self) -> Path:
        return self.root / MANIFEST

    def _extracted_path(self, document: Document) -> Path:
        return self.root / "extracted" / f"{document.id}.txt"

    @property
    def style_summary(self) -> Path:
        return self.root / "style.md"

    @property
    def voice_summary(self) -> Path:
        return self.root / "voice.md"

    # -- memory ------------------------------------------------------------
    # Kept here rather than in either agent so that both providers get the
    # same text through the same prompt section.  It deliberately does not
    # rely on the Claude CLI picking up a CLAUDE.md from the working
    # directory: that is a Claude-only mechanism, and a writer who chose
    # OpenAI would silently get nothing.
    @property
    def memory_path(self) -> Path:
        return self.root / "memory.md"

    def memory_text(self) -> str:
        try:
            return self.memory_path.read_text(encoding="utf-8").strip()
        except OSError:
            return ""

    def memory_notes(self) -> list[str]:
        """The remembered lines, without the heading."""
        return [
            line[2:].strip()
            for line in self.memory_text().splitlines()
            if line.startswith("- ") and line[2:].strip()
        ]

    def set_memory(self, text: str) -> str:
        """Replace the memory wholesale, as a hand edit does."""
        body = text.strip()[:MEMORY_MAX_CHARS].strip()
        self.root.mkdir(parents=True, exist_ok=True)
        temp = self.memory_path.with_suffix(".md.tmp")
        try:
            temp.write_text(body + ("\n" if body else ""), encoding="utf-8")
            temp.replace(self.memory_path)
        except OSError:
            temp.unlink(missing_ok=True)
            return self.memory_text()
        return body

    def remember(self, note: str) -> tuple[bool, str]:
        """Append one note.  Returns whether it was kept, and what to say.

        The failure is worth a sentence rather than a silent no-op: a model
        told nothing will try again, and a model told the memory is full can
        say so to the writer, who is the only one who can prune it.
        """
        line = " ".join(note.split()).strip()
        if not line:
            return False, "Nothing to remember: the note was empty."
        if line in self.memory_notes():
            return True, "Already remembered."
        existing = self.memory_text()
        body = existing or MEMORY_HEADING
        proposed = f"{body}\n- {line}"
        if len(proposed) > MEMORY_MAX_CHARS:
            return False, (
                f"Memory is full ({MEMORY_MAX_CHARS} characters). Ask the writer "
                "to prune it in the panel that shows what you read, or to "
                "replace a line that no longer holds."
            )
        self.set_memory(proposed)
        return True, f"Noted, and it will be there in every future conversation: {line}"

    # -- manifest -------------------------------------------------------
    def documents(self) -> list[Document]:
        if not self.manifest_path.exists():
            return []
        try:
            raw = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
        return [Document(**d) for d in raw if isinstance(d, dict)]

    def _save(self, documents: list[Document]) -> None:
        temp = self.manifest_path.with_suffix(".json.tmp")
        temp.write_text(
            json.dumps([asdict(d) for d in documents], indent=2), encoding="utf-8"
        )
        temp.replace(self.manifest_path)

    # -- adding and removing --------------------------------------------
    def add(self, kind: Kind, filename: str, data: bytes, note: str = "") -> Document:
        if kind not in KINDS:
            raise ValueError(f"unknown kind: {kind}")
        # The stored name is derived, never taken from the client: an
        # upload called "../../.bashrc" must land in the context directory
        # like anything else.
        safe = Path(filename).name or "document"
        # The millisecond alone is not unique: dropping two text documents
        # at once extracted both into one file and removing either deleted
        # the other's bytes as well.
        document_id = f"{int(time.time() * 1000):x}{secrets.token_hex(2)}"
        target = self._dir(kind) / f"{document_id}__{safe}"
        # Through a temporary file: an upload cut off partway would
        # otherwise leave a truncated PDF that pdftotext extracts as
        # garbage, and nothing downstream would notice.
        temp = target.with_name(target.name + ".part")
        temp.write_bytes(data)
        temp.replace(target)

        document = Document(
            id=document_id, kind=kind, filename=safe,
            added=time.time(), bytes=len(data), note=note,
        )
        text, pages = self._extract(target)
        document.pages = pages
        self._extracted_path(document).write_text(text, encoding="utf-8")

        documents = self.documents()
        documents.append(document)
        self._save(documents)
        return document

    def remove(self, document_id: str) -> bool:
        documents = self.documents()
        remaining = [d for d in documents if d.id != document_id]
        if len(remaining) == len(documents):
            return False
        for document in documents:
            if document.id != document_id:
                continue
            for path in self._dir(document.kind).glob(f"{document_id}__*"):
                path.unlink(missing_ok=True)
            self._extracted_path(document).unlink(missing_ok=True)
        self._save(remaining)
        return True

    def stored_path(self, document: Document) -> Path | None:
        matches = list(self._dir(document.kind).glob(f"{document.id}__*"))
        return matches[0] if matches else None

    # -- text extraction -------------------------------------------------
    @staticmethod
    def _extract(path: Path) -> tuple[str, int | None]:
        """Get plain text out of an uploaded document.

        PDFs go through `pdftotext -layout`, which preserves the column
        structure that tables and formatting examples depend on. Anything
        that is already text is read directly. A file that yields nothing
        useful is kept anyway -- the user can still download it, and the
        agent is simply told it could not be read.
        """
        suffix = path.suffix.lower()
        if suffix == ".pdf":
            if not shutil.which("pdftotext"):
                return "", None
            try:
                result = subprocess.run(
                    ["pdftotext", "-layout", str(path), "-"],
                    capture_output=True, text=True, timeout=120,
                )
                pages = None
                if shutil.which("pdfinfo"):
                    info = subprocess.run(
                        ["pdfinfo", str(path)], capture_output=True, text=True, timeout=30
                    ).stdout
                    for line in info.splitlines():
                        if line.startswith("Pages:"):
                            pages = int(line.split()[1])
                return result.stdout, pages
            except (subprocess.SubprocessError, ValueError, OSError):
                return "", None
        if suffix in {".txt", ".md", ".tex", ".rst", ".org"}:
            try:
                return path.read_text(encoding="utf-8", errors="replace"), None
            except OSError:
                return "", None
        return "", None

    def extracted_text(self, document: Document) -> str:
        path = self._extracted_path(document)
        if not path.exists():
            return ""
        return path.read_text(encoding="utf-8", errors="replace")

    # -- what the agent sees ---------------------------------------------
    def prompt_section(self) -> str:
        """The block appended to the agent's system prompt.

        Short by construction: two distilled summaries and an index of what
        else is on disk. Everything here is paid for on every single turn,
        so nothing goes in that is not used on most of them.
        """
        parts: list[str] = []

        # First, because it is the most specific thing the writer has said:
        # standing instructions about this project, given in earlier
        # conversations that have since been cleared away.
        notes = self.memory_notes()
        if notes:
            parts.append(
                "## What this project has told you to remember\n\n"
                + "\n".join(f"- {note}" for note in notes)
                + "\n\nThese are facts and standing instructions the writer asked "
                "you to keep across conversations. Follow them unless the writer "
                "says otherwise in the conversation you are having now."
            )

        if self.style_summary.exists():
            text = self.style_summary.read_text(encoding="utf-8").strip()
            if text:
                parts.append(
                    "## Formatting rules this project must follow\n\n"
                    f"{text}\n\n"
                    "These come from the project's own template or style guide. "
                    "They take precedence over general convention."
                )

        if self.voice_summary.exists():
            text = self.voice_summary.read_text(encoding="utf-8").strip()
            if text:
                parts.append(
                    "## The author's writing voice\n\n"
                    f"{text}\n\n"
                    "Match this voice in every piece of prose you write for this "
                    "project. It is a description of how this person actually "
                    "writes, taken from their own work, and it outranks the "
                    "general guidance in the instructions above wherever the two "
                    "disagree -- including where this author does something that "
                    "guidance discourages. Where the description is silent, the "
                    "general guidance applies."
                )

        documents = self.documents()
        if documents:
            lines = [
                "## Reference material on disk",
                "",
                "Read these when you need a detail the summaries above do not "
                "carry. Paths are relative to the project root.",
                "",
            ]
            for document in documents:
                path = f".nexttex/context/extracted/{document.id}.txt"
                pages = f", {document.pages} pages" if document.pages else ""
                note = f": {document.note}" if document.note else ""
                lines.append(
                    f"- `{path}`, {document.filename} "
                    f"({KIND_LABEL[document.kind]}{pages}){note}"
                )
            parts.append("\n".join(lines))

        return "\n\n".join(parts)

    def needs_distillation(self) -> list[Kind]:
        """Which summaries are missing or older than the documents they describe."""
        stale: list[Kind] = []
        for kind, summary in (("style", self.style_summary), ("voice", self.voice_summary)):
            documents = [d for d in self.documents() if d.kind == kind]
            if not documents:
                continue
            if not summary.exists():
                stale.append(kind)  # type: ignore[arg-type]
                continue
            if summary.stat().st_mtime < max(d.added for d in documents):
                stale.append(kind)  # type: ignore[arg-type]
        return stale

    # -- distillation prompts ---------------------------------------------
    def distillation_request(self, kind: Kind) -> tuple[str, Path] | None:
        """The prompt and output path for distilling one kind of document.

        Returns None when there is nothing of that kind to read. The caller
        runs this through the model; keeping the prompt here means the
        instructions live next to the format they produce.
        """
        documents = [d for d in self.documents() if d.kind == kind]
        if not documents:
            return None

        excerpts = []
        budget = DISTILL_CHARS // max(1, len(documents))
        for document in documents:
            text = self.extracted_text(document).strip()
            if not text:
                continue
            excerpts.append(f"### {document.filename}\n\n{text[:budget]}")
        if not excerpts:
            return None
        body = "\n\n".join(excerpts)

        if kind == "style":
            instruction = (
                "Below are the template and formatting documents for a writing "
                "project. Write a markdown summary of the rules a writer must "
                "follow.\n\n"
                "Record only rules that can be checked against a document: "
                "margins, page numbering, heading style and capitalisation, line "
                "spacing, citation and bibliography format, what the title may "
                "contain, the required order of sections. Give exact values "
                "wherever the source gives them.\n\n"
                "Where two rules could conflict, say which wins. Where a rule is "
                "commonly got wrong, say so in a clause.\n\n"
                "Leave out submission logistics, deadlines, fees, contact details "
                "and anything else that is not a property of the document itself. "
                "Do not pad. If the documents state few rules, write few.\n\n"
                "Write the summary only, with no preamble."
            )
            output = self.style_summary
        else:
            instruction = (
                "Below is writing by the author of this project. Describe their "
                "voice, in markdown, so that another writer could match it.\n\n"
                "Record what is observable, not what is flattering. Cover, in "
                "this order, and give each one a heading:\n\n"
                "1. **Sentences.** Typical length and how much it varies -- give "
                "a rough range, and say whether short sentences are used for "
                "emphasis. How sentences open, and whether openings repeat.\n"
                "2. **Paragraphs.** Whether they open with the topic sentence. "
                "Typical length. How they end -- on evidence, on a consequence, "
                "or on a summary.\n"
                "3. **Person and voice.** Active or passive, and where each is "
                "used. Whether 'we' appears, and for what -- choices made, "
                "results obtained, or neither.\n"
                "4. **Hedging.** How strongly they commit to a claim, and the "
                "exact hedging words they use ('suggests', 'is consistent "
                "with', 'indicates'). Whether hedges stack.\n"
                "5. **Connectives and transitions.** The ones they actually use "
                "and how often. Note any they conspicuously avoid.\n"
                "6. **Vocabulary.** Terms of art they prefer where synonyms "
                "exist. Any words or constructions that recur enough to be "
                "characteristic. Whether they use intensifiers.\n"
                "7. **Technical apparatus.** How a term is introduced the first "
                "time. Citation density and where citations sit in a sentence. "
                "How numbers, units and equations are worked into prose.\n"
                "8. **What they never do.** Constructions absent from the "
                "sample that a generic academic writer would use.\n\n"
                "Quote two or three short phrases as evidence, and give a "
                "sentence-length range as actual numbers where you can.\n\n"
                "This description will be used to override general writing "
                "advice, so be precise about the points where this author "
                "departs from ordinary academic style -- those are the lines "
                "that will do the work.\n\n"
                "Adjectives like 'clear', 'engaging' or 'authoritative' are "
                "useless here because they cannot be acted on. Every line should "
                "be something a writer could follow or violate on purpose.\n\n"
                "Two things not to record, however clearly the sample shows "
                "them: whether the author uses em dashes, and how they wrap "
                "lines in the source. Both are fixed by rules this description "
                "cannot lift, so noting them would only describe a habit that "
                "will not be followed.\n\n"
                "Write the description only, with no preamble."
            )
            output = self.voice_summary

        # The summary has to end up in a file, or nothing downstream can
        # read it: the prompt section is built from these two paths, and a
        # distillation that only replied in the chat left the panel saying
        # the documents still needed reading, forever.
        delivery = (
            f"Write the result to `{output}` with the Write tool, creating "
            "the file if it does not exist and replacing it if it does. "
            "Write the file and then say one short sentence confirming it; "
            "do not print the summary itself into the conversation."
        )
        return f"{instruction}\n\n{delivery}\n\n---\n\n{body}", output

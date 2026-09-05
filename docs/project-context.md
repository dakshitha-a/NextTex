# Project context: templates, style guides, and writing voice

A writing project carries more than its source. It has a template or a
formatting handbook it must obey, and — if the writing is to sound like the
person writing it — samples of how that person actually writes. NextTex lets
both be uploaded, and makes the agent use them.

This generalises something that was done by hand for the dissertation that
NextTex was built alongside: a university formatting handbook was read once and
its rules recorded where the agent would see them, and an earlier piece of the
author's own writing was read once and distilled into a description of their
voice. Doing that by hand works and is worth automating, because it is the same
job for every writer.

## Where it lives

```
<project>/.nexttex/context/
  style/      templates, formatting handbooks, journal guides
  voice/      the author's own prior writing
  sources/    material being drawn on (papers, notes, data descriptions)
  extracted/  cached plain text of every uploaded PDF
  CONTEXT.md  generated index: what is here and what each thing is for
  voice.md    generated: the observable characteristics of the author's writing
  style.md    generated: the rules extracted from the style documents
```

Uploads are ordinary files. PDFs are text-extracted once on upload with
`pdftotext -layout` and cached under `extracted/`, so the agent reads text
rather than re-parsing a PDF on every turn.

## Why generated summaries rather than raw documents

A formatting handbook is twenty pages and a writing sample may be many more.
Putting them in the agent's context on every turn is expensive and, worse,
ineffective: a model given twenty pages of prose and told "write like this"
attends to the topic far more reliably than to the manner.

So each uploaded document is read **once**, on upload, and distilled:

- `style.md` records rules as checkable statements — margins, heading
  conventions, citation format, what the title may not contain.
- `voice.md` records *observable* characteristics, not adjectives. Sentence
  length and variation; whether paragraphs open with their topic sentence; the
  pivot words actually used; how terms are introduced; citation style; what the
  writer never does. "Plain declarative sentences, terms defined inline on
  first use, `however` and `in contrast` as the main pivots" is usable.
  "Clear and engaging" is not.

Those two short files are appended to the agent's system prompt every turn.
The full extracted text stays on disk, and the agent reads it when it needs a
detail the summary does not carry.

## Rebuilding

Distillation reruns when a document is added or removed, and can be triggered
by hand. The generated files are plain markdown and are meant to be edited: if
the description of your voice is wrong, correcting it is the fastest way to fix
the writing, and your correction survives the next rebuild.

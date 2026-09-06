# Project context: templates, style guides, and writing voice

A writing project carries more than its source. It has a template or a
formatting handbook it must obey, and — if the writing is to sound like the
person writing it — samples of how that person actually writes. NextTex lets
both be uploaded, and makes the agent use them.

This generalises something scientific writers already do by hand: a journal's
author instructions are read once and their rules recorded where the agent will
see them, and an earlier paper by the same author is read once and distilled
into a description of their voice. Doing that by hand works and is worth
automating, because it is the same job for every writer.

## Where it lives

```
<project>/.nexttex/context/
  style/      templates, formatting handbooks, journal guides
  voice/      the author's own prior writing
  sources/    material being drawn on (papers, notes, data descriptions)
  extracted/  cached plain text of every uploaded PDF
  voice.md    generated: the observable characteristics of the author's writing
  style.md    generated: the rules extracted from the style documents
  memory.md   what the writer asked the agent to remember
```

`.nexttex/` is gitignored, so none of this travels with the repository. That is right for
the extracted text and the summaries, and worth knowing about `memory.md`: a writer who
moves to another machine re-teaches it.

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


## Memory

The summaries above are distilled from documents. Memory is different: it is what the
writer said, in a conversation, and asked to have kept.

A conversation is not permanent. It can be cleared, and the model's own recollection of it
goes when it is. Anything that should outlast one — that a chapter is finished and must not
be touched, which measurements came from a collaborator, who the supervisor is — belongs
somewhere the next conversation will also read. So the agent has a `remember` tool, and is
told to reach for it both when the writer says *remember this* and when it works out a
durable fact about the project on its own.

`memory.md` is one bullet per note, capped at four thousand characters because it is paid
for on every turn of every conversation. A note that would go over the cap is refused with
a sentence the agent can repeat to the writer, rather than failing quietly. Notes are
deduplicated, and folded onto one line each.

It is a plain file and it is meant to be edited. The panel listing what the agent reads
shows it and offers a text box, which is the only way to reach it — the folder it lives in
is hidden from the file list. Correcting a note by hand is the fastest way to fix behaviour
that follows from it.

One implementation note worth keeping. A Claude system prompt is assembled once per client,
and that client outlives many turns, so a note written in the middle of a conversation
would not reach the prompt until the idle reaper tore the client down half an hour later.
The client is rebuilt on the way into the *next* turn instead — never under a running one,
which would close the transport an answer is still arriving on — and the conversation
survives because the new client resumes the same session id. The OpenAI path needs none of
this: it rebuilds its instructions on every request.

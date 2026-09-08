<img src="docs/logo.svg" width="64" align="right" alt="">

# NextTex

A LaTeX editor you run yourself, with an **optional** AI agent beside the document.
The agent can write, manage project files, references and much more.
**Caution:** Use AI writing for publications and academic work at your own risk.

Source on the left, the real typeset PDF in the middle, and, if you want one,
an agent on the right that can read and edit the project you are writing. One
Python process and a folder of files that stay ordinary LaTeX the whole time,
so the project still compiles from a terminal, or on Overleaf, after you close
the tab. No database, no Docker, no nginx.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img alt="NextTex: the file list, the source, the typeset page and the agent" src="docs/screenshot-light.png">
</picture>

## Highlights

- **The page follows your typing.** An ordinary edit typesets only the section
  you are in, measured at 357 ms on a forty-file project.
- **Double-click the page to reach the source**, and `⌘↵` to go the other way.
- **Errors explained in English**, with the one to start from named. No model
  involved.
- **Every save is a version**, kept until you say otherwise, with a trash that
  never empties itself.
- **Four git buttons** for the four commands a paper actually needs.
- **The agent edits the project and asks about everything else**, or approves
  everything if you turn that on, with the record staying honest either way.
- **It cannot invent a citation.** Every reference comes from the publisher's
  own record, by DOI.
- **It remembers the project, not just the conversation**, so you can start a
  fresh chat without teaching it your work again.
- **Fill a bibliography from a folder of papers**, checked against each PDF so
  a wrong DOI is refused rather than added.
- **Reading and writing modes**: double-click a pane header to give it the
  window, and again to get your layout back.
- **The editor is lit on its own terms.** Light, dark, or matching the
  interface, so a dark shell can hold a white page. The syntax colours and
  the gutter follow it.
- **Search and drag in the file list**, with open files following a folder
  that moves.
- **Choose Claude, OpenAI, or no agent at all.** The last is a real option,
  not a degraded one, and the choice can be changed later in the settings
  card rather than only when you first sign in.
- **Nothing leaves the machine** except what you asked for. No telemetry.

## Installing

```bash
curl -fsSL https://raw.githubusercontent.com/dakshitha-a/NextTex/master/scripts/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/dakshitha-a/NextTex/master/scripts/install.ps1 | iex
```

It clones into `~/apps/NextTex` (`NEXTTEX_DIR` to choose elsewhere) and
installs from there. `git` is the only thing you need beforehand — Python,
TeX and the Claude CLI are all fetched if they are missing. If you would
rather see what you are running first, clone it yourself and run
`scripts/install.sh` from inside; the script does the same thing either way.

The installer prints a URL with an access token in it. That is how you get in.

> [!WARNING]
> Anyone with that URL can read and edit your projects. Treat it like a
> password, and do not put NextTex on the open internet.

<details><summary>What the installer actually does</summary>

Checks for Python 3.10+ and makes a virtual environment, then installs the
Python dependencies into it. Looks for a TeX installation where TinyTeX,
MacTeX, MiKTeX and TeX Live put one, and offers to install TinyTeX (Linux and
macOS) or MiKTeX (Windows) if there is none. Uses `tlmgr` to add `latexmk`,
`biber`, `synctex`, `chktex` and `texcount` if they are missing. Offers to
install the Claude CLI. Downloads the interface built for this commit
(building it locally with Node 20+ only if that download fails). Asks whether the
server should answer on localhost only or also on your tailnet. Writes a
`systemd --user` unit on Linux, a launchd agent on macOS, or a scheduled task
on Windows. Then prints the URL.

All of it is idempotent. Run it again after installing something it said was
missing and it picks up where it left off without touching your projects.
</details>

## Running it

The installer sets NextTex to start at login. To control it by hand:

**Linux**

```bash
systemctl --user start nexttex
systemctl --user stop nexttex
systemctl --user restart nexttex
systemctl --user status nexttex
journalctl --user -u nexttex -f        # follow the log
```

`systemctl --user disable nexttex` stops it starting at login, and `enable`
puts it back.

**macOS**

```bash
launchctl load   ~/Library/LaunchAgents/com.nexttex.server.plist
launchctl unload ~/Library/LaunchAgents/com.nexttex.server.plist
tail -f ~/.local/share/nexttex/server.log
```

**Windows**, in PowerShell:

```powershell
Start-ScheduledTask -TaskName NextTex
Stop-ScheduledTask  -TaskName NextTex
```

**Any platform.** To print the URL and token again:

```bash
.venv/bin/python server/run.py --print-url
```

To run it in the foreground instead, which is the quickest way to see why it
will not start:

```bash
.venv/bin/python server/run.py
```

If you installed a second copy with `--instance NAME`, every name above gains
the same suffix: the service is `nexttex-NAME`, its state lives in
`~/.local/share/nexttex-NAME`, and the interface carries a badge so you can
tell the two apart.

## Keeping it up to date

`./scripts/update.sh` pulls, reinstalls, rebuilds and restarts, or
`scripts\update.ps1` on Windows. Your projects live outside this directory and
neither script touches them.

You can also update from the project list. NextTex checks once when that
screen opens and, if the repository is ahead, says so at the foot of the page
with the commit subjects and an Update button. It restarts itself afterwards
and the page comes back on its own.

It is deliberately quiet. Commits that change only documentation or tests are
reported as *"three new commits, none of which change NextTex"*, a grey line
rather than an alert, and a check that cannot reach GitHub says nothing unless
you asked for it.

## Your first session

About twenty minutes, most of it TinyTeX downloading. Open the URL, choose an
agent or none, and add `examples/minimal-article` as a project. It typesets as
it opens. Type a sentence into the abstract and the page follows about two
seconds later; double-click a paragraph on the page to jump back to the line
that set it. The full walkthrough, with a deliberate error, the version
history and a GitHub backup, is in
[docs/first-session.md](docs/first-session.md).

## How it works

### The page follows your typing

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/pipeline-dark.svg">
  <img alt="From a keystroke to the page: 250 ms held, 1.6 s of quiet, 357 ms in latexmk." src="docs/pipeline-light.svg">
</picture>

When a document uses `\include`, an ordinary edit typesets only the section
you are in, so the page redraws about two seconds after you stop. A new
citation key or a new label pays for the full run with `biber`, and nothing
else does. A half-finished equation holds the build back for four seconds
rather than reporting an error you already know about.

<details><summary>The measured numbers</summary>

`bench/thresholds.json` holds a budget for every slow path and `bench/bench.py`
measures against it, on a synthetic project of forty source files, two
megabytes of LaTeX, a populated build directory and a `.git` with a working
tree. They are budgets, not records. The point is to notice the change that
makes typing slower on the day it happens.

| | measured | budget |
|---|---|---|
| Chapter build, as an edit triggers | 357 ms | 4 s |
| Full build with `biber` | 19.2 s | 30 s |
| Full symbol scan | 19.3 ms | 400 ms |
| Symbol lookup, cached | 0.92 ms | 6 ms |
| Recording a version | 1.88 ms | 8 ms |
| Rebuilding a transcript | 9.5 ms | 120 ms |
| Project file tree | 3.3 ms | 250 ms |
| Whole project as a zip | 69 ms | 3 s |
| Interface bundle | 736 kB | 760 kB |

The first row is the one worth keeping. The compile rewrites `build/main.pdf`,
the symbol cache's stamp walk used to count it, and every build therefore
threw the index away and rescanned the project, 1.6 seconds after every pause
in typing. If that comes back, the cached lookup goes from about one
millisecond to about twenty.

`scripts/check.sh --bench` runs it.
</details>

### It tells you what the error means

`chktex` runs while you type, and the LaTeX log is parsed into `file:line`
diagnostics with the right file attribution even inside `\include`d chapters.
Every message is matched against a table of the errors that actually happen,
so the drawer says *Maths outside maths mode* and *put the expression between
dollar signs* rather than `Missing $ inserted`. It also names which error to
start with: LaTeX reports everything after a mistake as a mistake too, and a
writer who starts at the bottom of the list spends the evening fixing
consequences. None of this involves a model.

### Every save is a version

A version is the sha256 of the file's bytes, stored once and compressed on
your own disk, so going back costs nothing. An editing burst collapses into
one version rather than forty, and old ones thin with age: everything from the
last day, hourly for a week, daily for three months, weekly after that. Four
kinds are never thinned, being the ones people come back for: one you named,
one the agent made, a deletion, a restore.

Figures are versioned too, so replacing a plot keeps the one it replaced byte
for byte. A deleted file goes to a trash that never empties itself, because a
trash that clears after thirty days loses the thing you went looking for on
day thirty-one. None of it is git, and none of it needs you to have
committed.

### Four git commands, and the fifth one is a terminal

See what changed, commit it, push it, pull it back on another machine. That is
a paper's whole relationship with git, and each is one button in the rail
footer. A project with no repository is offered one, with a first commit and a
`.gitignore` that already knows about `build/` and `.nexttex/`. With the
GitHub CLI signed in, *Back this up to GitHub* creates the repository, private
by default, and pushes into it; a token you supply goes to your credential
store rather than into the remote URL, so it never turns up in
`git remote -v`. Branching and merging stay in the terminal, where the tools
are better and the mistakes are recoverable.

### The agent edits the project, and asks about everything else

An edit inside the project happens directly and appears in the transcript as a
chip with its diff and an undo. A shell command, or a write outside the
project, produces a card you have to answer first, and the card ignores clicks
for 350 ms so one arriving under a moving cursor cannot be approved on the way
past. *Allow always* is scoped to a command's first word; a command carrying
shell syntax gets no rule and is asked about every time.

If that is more asking than you want, a switch approves everything, with three
things holding it honest. A write outside the project still asks, because that
is the one action that leaves what you pointed the agent at. Every automatic
approval still appears in the transcript, marked as one. And while it is on an
**Auto** chip sits beside the agent's name, because a fence that is down and
says nothing is worse than no fence.

**It says what it is doing.** A turn can spend twenty seconds inside a tool
with no prose arriving, so the header carries a live line: *Reading
02_theory.tex*, *Searched the literature*, *Writing*.

**It remembers the project, not just the conversation.** Tell it that chapter
three is frozen, or which measurements came from a collaborator, and it writes
that down where the next conversation will read it. So you can start a fresh
conversation whenever the current one has wandered, without teaching it your
project again. The memory is a plain file you can correct by hand, shown in
the panel listing what the agent reads.

**A conversation can be ended.** *New conversation* clears the panel and the
model's own recollection, and files the transcript away under a timestamp
rather than deleting it, because it is the record of what an assistant did to
your document. What the project has cost carries over, and so do the
permission rules you have set.

**It learns how you write.** Give it the handbook you have to follow and a
paper you have already written; it reads them once, distils them, and keeps
the result in its instructions from then on.

### It cannot invent a citation

The agent searches Crossref, OpenAlex or Semantic Scholar and gets back real
DOIs. It adds an entry by DOI, and the BibTeX comes from the publisher's own
record rather than from the model. It can then re-check every entry in your
bibliography against the record it claims to come from. A fabricated reference
is an academic integrity failure, so the defence is structural rather than a
matter of care: there is no path from the model's memory to your `.bib` file.

### Point it at a folder of papers

`⋯` on your `.bib` file, *Add papers from a folder*, and NextTex walks it,
whether that is a Zotero library or a Downloads folder, finds each paper's DOI
in its own text, fetches that record from the publisher and appends it.
Nothing is added twice, and a PDF whose DOI cannot be found is reported rather
than guessed at.

The safeguard worth knowing about: a DOI printed on page one is sometimes one
the paper *cites*. So the record's title is checked against the paper's own
first pages, and a record that does not describe the paper it was found in is
refused. That check makes importing two hundred papers as trustworthy as
adding one by hand.

This works with no agent at all. **With an agent, the same papers become a
library it can search**, so it can ask what you have already read before going
to the whole literature. What it gets back is labelled as quotation rather
than instruction, because the text came out of files you downloaded.

### Panes, and two modes

Double-click the preview's header for a reading mode: everything else folds to
a strip and the typeset page gets the screen. The empty part of the tab strip
does the same for writing, except that it keeps the file list, because you are
still moving between chapters. Double-click again and your layout comes back
exactly as you left it, including what you had already folded away. A single
click on either folds just that pane, as it does on the agent's header.

The file list has a filter row behind a magnifier: type and the tree narrows
to what matches, through folders you had collapsed, and clearing it gives back
exactly the tree you had. Rows drag onto folders, and a folder takes
everything under it, including open files, which follow it rather than being
left pointing at a name that no longer exists.

## What it is not

**Not collaborative.** One writer, one machine, by design: no accounts, no
comments, no suggestions, no shared cursors. Two tabs of your own do work, and
a save from a stale tab is refused and offered as a choice rather than allowed
to overwrite the other. If you need real co-authoring, use Overleaf.

**Not a git client**, and not a general-purpose editor.

**Windows support is written but unverified.** `scripts/install.ps1` exists
and the server no longer imports POSIX-only modules at startup, but nobody has
run it on Windows yet. Signing in to Claude from the browser needs a
pseudo-terminal, which Windows does not have, so run `claude auth login` in a
terminal once or use an OpenAI key. Reports welcome.

## Requirements

| What | Why | Supplied by the installer? |
|---|---|---|
| Python 3.10+ | The server | no |
| Node 20+ | Only to build the interface locally, if the prebuilt one cannot be downloaded | no |
| `pdflatex`, `latexmk`, `synctex` | Typesetting and the two-way jump | TinyTeX or MiKTeX, if you let it |
| `biber` | biblatex bibliographies | yes, via `tlmgr` |
| `chktex`, `texcount` | Linting and word counts | yes, via `tlmgr` |
| `pdftotext` | Only for reading a folder of papers into your `.bib` | no, it comes with poppler-utils |
| The [Claude CLI](https://claude.ai/download) | Only for the Claude agent | yes, if you let it |
| An OpenAI API key | Only for the OpenAI agent | no |
| `gh`, signed in | Only for *Back this up to GitHub* | no |
| `tailscale` | Only to reach this install from another machine | no |

Nothing in the bottom half of that table is needed to write and typeset.

## What leaves this machine

NextTex serves your own files from your own machine and ships its own
typefaces, so the interface works on a host with no route to the internet.
Four things go out, all of them things you asked for:

1. What you send the agent, to Anthropic or OpenAI.
2. Reference lookups, to Crossref, OpenAlex, Semantic Scholar, arXiv and
   `doi.org`.
3. TinyTeX and the Claude CLI, if the installer has to fetch them.
4. GitHub, to check whether this install is behind and to download the
   interface for the commit it is on. Nothing about you or your documents
   goes with either request.

That is the whole list, and a test fails if a new host appears in the source
without this section changing. There is no telemetry and no analytics of any
kind: not disabled by default, not present.

<details><summary>Access, TLS, and why Tailscale is in here</summary>

The server is protected by a token printed at install time and exchanged for a
cookie on first load. On localhost it is plain HTTP; any address another
machine can reach is served over TLS, with a certificate from `tailscale cert`
where your tailnet has HTTPS and a self-signed one otherwise. Signing in to
Claude drives the CLI's own login and the credentials land where the CLI keeps
them, so NextTex never sees or stores them. An OpenAI key goes in the
instance's config file, `chmod 600`.

Tailscale is in here because the machine you want to write on is often not the
one you are sitting at: a lab workstation, a compute server, the box the data
lives on. The usual answer is an SSH tunnel each time, or a reverse proxy and
a certificate and a hostname to maintain. Choose Tailscale at install time
instead and the server also answers on your tailnet address, over TLS,
reachable from your own devices and nothing else. The machine can sit behind a
university firewall with no inbound route and still be the one you write on
from a train. If you only ever write at the desk it is installed on, say
localhost and skip it.
</details>

## A project on disk

Point NextTex at any folder containing a LaTeX document.
`examples/minimal-article` is there to try it on. A project can carry a
`nexttex.toml`:

```toml
[project]
name = "My Thesis"
main = "main.tex"
build_dir = "build"

# Written by the settings card and yours to edit. Per project rather than
# per browser: a forty-file thesis takes twenty seconds to build and a
# one-page note takes one.
autocompile = true      # build as you type; ⌘S builds when this is off
mark_errors = true      # mark compile errors in the text itself
mark_warnings = false   # and chktex warnings, which are noisier
```

Without one, NextTex finds the file containing `\documentclass` and
`\begin{document}` and uses that.

Everything NextTex adds lives in one directory beside your files, and none of
it is needed to compile:

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

## Keyboard

| Key | Does |
|---|---|
| `⌘S` / `Ctrl-S` | Save now rather than waiting for the pause |
| `⌘B` / `Ctrl-B` | Hide the file list |
| `⌘⌥A` / `Ctrl-Alt-A` | Show or hide the agent panel, ready to type |
| `⌘↵` / `Ctrl-↵` | Scroll the PDF to the line you are on |
| `Ctrl-F` | Find and replace |
| Typing, in the file tree | Jump to a file |
| `F2`, `Delete`, in the file tree | Rename, move to trash |
| `A`, `⇧A`, `D`, in a permission card | Allow, allow always, deny |

## Documentation

There is a tutorial inside the app: the cog in the file list's masthead has a
**Tutorial** entry, and the projects screen has a question mark beside its
cog. Both explain what is on the screen you are looking at, which is usually
faster than the files below.

- [docs/first-session.md](docs/first-session.md): the long version of the
  walkthrough above.
- [docs/design.md](docs/design.md): the specification the interface was built
  against, the audits it was reviewed in, and every decision with its reason.
- [docs/project-context.md](docs/project-context.md): how a template, a
  handbook and a sample of your own writing change what the agent produces.
- [docs/testing.md](docs/testing.md): the four test tiers, why each exists,
  and the bugs they found.

## Licence

MIT. See [LICENSE](LICENSE).

NextTex was built to write scientific papers in: the kind of document that
lives in git, carries a bibliography, and gets rewritten more often than it
gets written. It is tested against a forty-file LaTeX project with its own
Makefile, which NextTex has to leave working exactly as it was. Issues are
welcome. This is a personal tool; I make no promises about pull requests.

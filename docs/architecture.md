# How NextTex works

This document is the internal mechanics: what the parts are, what each one owns, and why the awkward decisions are the way they are. It is for somebody about to change the code. `docs/design.md` is the interface specification, `docs/testing.md` is the test tiers, and the README is what the app is for.

## The shape

One Python process, one event loop, and a folder of ordinary LaTeX files. No database, no queue, no container, no reverse proxy. Everything NextTex knows that is not in your `.tex` files lives in a `.nexttex/` directory inside the project, and everything about the install lives in one state directory outside it.

That constraint drives most of what follows. A single process means anything synchronous in a request handler stops every other browser, every autosave and every collaborator, so work that blocks goes to a thread. No database means the durability story is files, atomic renames and fsync. No container means the code has to cope with whatever TeX, git and Node happen to be on the machine.

```
   browser ──HTTP──┐
   browser ──SSE───┤        ┌──────────── one uvicorn process ────────────┐
   browser ──WS────┤        │                                             │
                   └───────▶│  FastAPI app                                │
                            │    middleware: headers, then the gate       │
                            │    97 routes                                │
                            │                                             │
                            │  SESSIONS: one ProjectSession per project   │
                            │    ├─ CollabStore   the documents           │
                            │    ├─ SyncHub       browser sockets         │
                            │    ├─ PeerNetwork   other installs          │
                            │    ├─ CompileScheduler                      │
                            │    ├─ Agent         one Claude session      │
                            │    └─ Broadcaster   the event stream        │
                            │                                             │
                            │  background: watcher, reaper, rejoin, warm  │
                            └──────────────────┬──────────────────────────┘
                                               │
                    project folder ◀───────────┘        ~/.local/share/nexttex/
                      main.tex, chapters/, figures/       peer.key, settings,
                      .nexttex/  history, trash, collab   registry, token
```

## Starting up

`server/run.py` builds the FastAPI app and serves it on one address or two. uvicorn binds one socket per server object, so "reachable on localhost and over Tailscale" is two server objects sharing one event loop and one application. Loopback is plain HTTP because nothing leaves the machine; anything reachable from another machine is TLS.

The lifespan starts four background tasks and cancels them on the way out.

**The file watcher** tells browsers when files change underneath them. An external edit, a `git pull`, a checkout, somebody's own editor, has to reach the open tab or it will save over a change it never saw. NextTex's own writes must not, or the browser would be told to reload the buffer it just sent.

**The reaper** runs every sixty seconds. It disconnects idle agents, evicts idle sessions, sweeps unreferenced history blobs out of every open project about once an hour, and discards joins nobody answered.

**The rejoin task** opens every shared project so its peers can reach it again after a restart.

**The warm task** imports the agent SDK while nobody is waiting, because that import costs about six hundred milliseconds and was otherwise paid by the first person to open a project after an update.

## The gate every request passes

Two middleware, and the order is load-bearing. Starlette builds the stack with the last one added on the outside, so `security_headers` is declared after `authenticate` and therefore wraps it. That matters because `authenticate` returns some responses without ever calling a route, and those refusals need the headers too. The sign-in page is one of them: it is the page an unauthenticated visitor actually sees and it takes a password.

`authenticate` does three things in order.

**Origin.** `Sec-Fetch-Site` when it is sent, `Origin` against `Host` otherwise, and absence is allowed. A page in a browser cannot arrange to send neither, and curl, the installer and the test client send neither. This exists because `SameSite=Lax` does not separate ports: a page on `http://127.0.0.1:5173` is same-site with NextTex and its cookie travels.

**Size.** A `Content-Length` past the limit is refused before the body is read. Starlette spools a multipart body to a temporary file before any route is called, so without this the per-file limits would bound what lands in a project and nothing would bound what the machine absorbs. A chunked request sends no length and slips past, which is why the per-file limits exist as well rather than instead.

**Credentials.** Two of them, doing different jobs. The instance token is what the installer prints: the recovery path, and how a script gets in. A session is what a browser holds, minted when it proves it knows the password or arrives carrying the token. They are separate so that a copied cookie is not a copied install, and so one browser can be signed out.

WebSockets do not run HTTP middleware, so `authorise_socket` applies the same origin and credential rules at the socket route.

An unhandled exception is answered by a handler that logs the route with a short reference and returns that same reference to the browser in the shape the client's single error path reads. Starlette's own answer is the plain text "Internal Server Error", which is not JSON, so the browser could not read it and fell back to the status line.

## Projects and sessions

A project is any directory with a main `.tex` file. NextTex does not own it, move it, or require a layout. It adds two things: an optional `nexttex.toml` at the root, which you may commit, and a `.nexttex/` directory of generated state, which you should not.

The `Registry` is the list of projects, a JSON file in the state directory. A project's id is derived from its path, which is why relocating a project gives it a new id and is implemented as a removal and an addition that keeps its place in the list.

`session_for(project_id)` returns the `ProjectSession`, building it if the project is not open. "Open" is a thing a person does to a window, not a precondition the server keeps: while it was one, restarting the server made every route a tab was using answer 404, including its event stream, which then retried forever with nothing on screen to say so.

A session owns what must not be duplicated: the compile scheduler that serialises builds, the agent holding a Claude session, the CRDT store, and the fan-out to browser tabs. It is evicted after thirty minutes of nobody asking for it, unless something is relying on it: a browser holding the event stream, a browser holding an editing socket, an agent turn in flight, or a shared project, which counts whether or not a collaborator is connected this second, because closing the peer network is what takes the project off the network.

Eviction is safe because a session can always be rebuilt from disk. It is never about losing state, only about what would be interrupted.

**There are no subagents, and the question this paragraph used to ask is settled.** It asked whether `PreToolUse` fires for the tool calls a subagent makes, said the test suite could not observe it, and said the way to settle it was a live run with a real account. The answer was in the installed SDK the whole time, in the `.venv` this checkout has always had. `PreToolUseHookInput` inherits `_SubagentContextMixin`, whose docstring says `agent_id` is present only when the hook fires from inside a spawned subagent and absent on the main thread, so the hook does fire there; and `ClaudeAgentOptions.forward_subagent_text` says a subagent's `tool_use` and `tool_result` blocks are already emitted as ordinary messages carrying the id of the call that spawned them. It was recorded as needing an account and a turn when it needed a grep, which is the more useful half of the lesson: the dependency you vendored is a primary source, and reading it is cheaper than any experiment.

The fence was therefore never reachable around, and subagents are refused anyway, for a different and simpler reason. A subagent's work reaches the panel as one line saying a subagent ran. The panel is supposed to be the account of what was done to somebody's manuscript, and work nobody can watch is work nobody can correct. Three layers, because the tool's name belongs to the CLI rather than to this code: the fence refuses `Task` and `Agent` as the *first* statement in `_decide`, before anything that could allow them, since the last branch there allows a tool name it has never heard of when the writer has asked for no cards; `disallowed_tools` removes both from the model's context so it is not offered a thing it would then be refused; and any call arriving with an `agent_id`, or any message arriving with a `parent_tool_use_id`, is refused whatever it is and ends the turn with a notice, which depends on no name at all. That last one should be unreachable, and it exists so that a change in the CLI cannot make the first two quietly untrue.

**One constraint worth knowing before you touch this.** A session's CRDT objects are bound to the thread that created them. pycrdt panics outright, not raises, if one is used from another thread. That is why the reaper is a task on the event loop rather than a thread, and why a test that closes a session has to do it on the app's own loop.

## The document model

This is the part that is not obvious, and everything about saving depends on it.

**Every text file in a project is a CRDT document, and the file on disk is a projection of it.** Not the other way round. Every project is backed this way, shared or not, so there is one code path rather than two.

The alternative NextTex used to have was a hash on every save: the browser sent what it last agreed the file said, and a save whose hash had moved on was rejected. That is right when the two writers are one person in two stale tabs, and wrong when they are two people, both right, both typing.

The layout is **one document per text file, plus a manifest listing them**. One document for the whole project is the obvious choice and the wrong one: a two megabyte thesis with a year of tombstones behind it would be a multi-megabyte download every time it opened, and a browser needs the file it has open, not all forty.

Three paths move text.

**Browser to document.** A `y-codemirror.next` binding over a WebSocket per open document. The server applies the update to its copy and fans the result out to everyone else with that document open. Awareness messages, who is where and what they have selected, are relayed and also parsed and kept, because a browser that goes away has to be reported at once. y-protocols only drops a silent peer after thirty seconds and that timeout is a module constant, so a collaborator who shut their laptop sat in the margin for half a minute, which is worse than not showing them, because a caret means somebody is there.

**Document to disk.** A change marks the document dirty and schedules a flush 120 milliseconds later. The flush materialises the text, compares it against what was last written, resolves the path, writes atomically, records a version, notes the edit and schedules a compile. A file that could not be written stays dirty and is retried; a file that was *refused* does not, because a record naming `.git/hooks/pre-commit` will name it just as much next time.

**A path from the other end is fenced at both ends of every operation it names.** `resolve_for_write` is the fence, and a rename has two paths, not one. While only the target was resolved, a peer could name a file `../../.ssh/id_rsa`, let that become the baseline `settle_paths` measures the next change against, then rename it to `notes.tex`: the source was built as `root / was` with no fence, so the file was moved off the disk into the project, where the manifest handed it to everybody in the share. The baseline is fenced when it is recorded and the source is fenced when it is used. A local file the rename displaces goes to the trash rather than being renamed out of the way in silence.

**Disk to document.** `ingest` folds an outside change back in: a `git pull`, the agent's own write, an editor in another terminal. It diffs against what was last projected and applies only the spans that moved, so a remote cursor is not thrown across the document by an append.

An edit reaching the disk measures at 3.1 ms on a thesis-shaped project, of which the edit arriving is 3.0.

**Undo belongs to the document, not to the editor.** A live editor's Ctrl+Z runs the scoped `Y.UndoManager` that `collab.ts` builds per file, bound by `yUndoManagerKeymap`; CodeMirror's own `history()` is not in a live editor's extensions at all. The two cannot both be there. A buffer is built before its socket has synced, so the file arrives afterwards as one transaction, and an editor with CodeMirror's history had that transaction on its stack: six presses of undo emptied the file on disk and for every other browser. The read-only panes, a version being viewed and a file that could not be connected, keep CodeMirror's history, because they have no shared document to own theirs.

**Copying a file is a fourth path, and it has to start by closing the second one.** `POST /api/projects/{id}/file/duplicate` flushes every dirty shared document before it copies anything, because the file on disk trails the document by the 120 millisecond debounce and a copy taken without that would hold the chapter as it was rather than as it is, with nothing on screen to say which of the two the writer had got. The name is chosen on the server by `unique_name`, the same rule the trash restores through and the upload chooser quotes back, and the route answers with the name it picked rather than accepting one. It publishes its own `files_changed`; the watcher would find the new file eventually and in a batch, so this is what makes the copy appear in the same beat the menu item was clicked in, for every tab and every collaborator.

## Compiling

Every subscriber is told the state before it is told the news. The event
stream's first frame is `compile_state`, which carries, per document, whether
a build is running, which build, and whether one has ever finished.
`compile_start` and `compile_done` are published to whoever is subscribed at
that instant and are not kept, so without this a tab that opened a project and
built in the same breath missed its own build, and a stream that dropped
mid-build came back with nothing in the world able to lower the flag it had
raised.


A compile runs every time typing pauses, so the budget is about a second. Three decisions get it there.

**Only rebuild what changed.** A document using `\include` can be compiled one chapter at a time with `\includeonly`, which halves the work on a seven-chapter dissertation. Whether that applies is detected from the source, never assumed.

**Only run biber when citations changed.** Biber dominates a full build, and reference resolution matters when the bibliography moves, not on every keystroke.

**Never let two runs share a build directory.** A new keystroke kills the run in flight before starting the next, and it kills the whole process group, because latexmk spawns children that outlive it.

The one non-obvious mechanism is the **stand-in main file**. `\includeonly` has to sit in the preamble, so scoping a build means either editing your main file on every keystroke or compiling something else. Editing yours is not acceptable, so NextTex writes a shadow main file into the build directory and compiles that.

Cancellation has an ordering subtlety worth keeping. `cancel` reads the process handle, and that handle is None for the whole of a build's setup: deciding the scope, writing the shadow, mirroring the build tree, spawning. A build arriving in that window used to cancel nothing and the older one ran to its two minute timeout holding the lock. The generation is therefore checked once more the moment the process exists.

The engine's log is read and parsed off the loop. It is multi-megabyte on a thesis and the parser is regex heavy, and this runs after every build on the path that publishes to every subscriber.

`latexmk` is given `-norc`, because `./latexmkrc` is arbitrary Perl read from the working directory by a build the editor starts on its own.

## Collaboration

A peer is an ed25519 keypair and nothing else. There is no account and nothing to sign in to: the public half is the identity, iroh authenticates it as part of the TLS handshake, and "is this peer allowed" reduces to "is this key in the list".

Everything above `transport.py` is bytes in and bytes out. `IrohTransport` is the real one, QUIC over TLS to a key, hole-punching across the open internet. `LoopbackTransport` is a pair of queues chosen by an environment variable, and it can do the two things a real network does that are hard to arrange on purpose: lose a connection, and hold messages until later.

The share record lives **inside the project**, at `.nexttex/collab/share.json`: the share id, the members, and when this peer joined. It has to be readable before the document has synced, because it is what says whether a project is shared at all and it is the gate an inbound connection is checked against.

The identity lives in the **install's** state directory. Those two facts together mean a project folder copied to another machine is a stranger to its own share: the record travels and the identity does not. The app detects that and says so, because otherwise every member reports as not connected and the honest reading of that is that nobody is here.

**Joining is two steps and the first writes nothing.** Accepting an invite is downloading somebody else's files. The join syncs the project into memory, holds the connection open, and answers with the manifest: every path, its kind and its size. Accept writes them and registers the project; discard closes the connection and removes the folder, which really does leave nothing behind. A file the build would run is listed as offered and marked as one that will not be written, because what somebody tried to send is the more interesting of the two facts.

A joiner must start from an **empty folder**. Two documents built independently from identical text merge into both copies, every line twice, and nothing raises. There is deliberately no merge path for two divergent copies of one project.

A held join is state the server would not otherwise have, so it is bounded: discarded after ten minutes by the reaper, and released on shutdown.

**What a peer may write is fenced.** A peer-supplied path goes through `resolve_for_write`, which refuses control files. Staying inside the project was never the whole question: `.git/config` is inside the project, and a `core.fsmonitor` entry in it is a command that runs on the next `git status`, which happens after every build.

**What a browser knows about the other end.** `PeerNetwork.state()` answers, per member, whether that peer's link is up, and `collab_peers` is published when a link is adopted or dropped so the browser hears the two ends of a connection rather than sampling for them. This is a different question from `connection` in the browser, which is that tab's own WebSocket to this server; both are drawn, separately, because a machine can have either one without the other and a writer who reads the wrong one believes their typing is arriving when it is not.

## The agent

One Claude session per project, driven from the browser, optional and off unless configured. Its working directory is the project root, so it cannot see NextTex's own source, and it loads the project's own `CLAUDE.md`.

**The permission fence is a `PreToolUse` hook, not `can_use_tool`.** This was established by testing rather than reading: with `can_use_tool` supplied and no `allowed_tools` entry covering it, a Bash call still ran without the callback firing, in every permission mode. The SDK's own documentation names the reliable mechanism.

**An image the writer hands the agent goes on disk, and the question carries the path.** Not for speed: it is the same arithmetic as the paragraph below. The agent already reads images from disk with its own `Read`, which is the path that was hardened, so there is no second image path to keep working; the transcript records a filename rather than a megabyte of base64; and a conversation that resumes by session id does not depend on the bytes being replayable, because they are still where they were. They land in `.nexttex/attachments/`, content addressed like everything else kept here, and the list of paths a question carries is checked against that directory rather than trusted, since it arrives as strings in an HTTP body and the one thing it must not become is a way to make the agent read an arbitrary path.

**A figure the agent reads costs more on the wire than the file does.** The SDK frames the CLI's stdout as one JSON line per message and refuses a line over a megabyte. An image tool result is base64, a third larger than the file, and the `PostToolUse` hook means the CLI ships it twice: once as a control request carrying the result to the hook, and once in the user message. A 290 KB figure measured 1.15 MB and killed the reader mid-turn, so `max_buffer_size` is raised well clear of any image the model would accept. Nothing is preallocated, so a ceiling that high only costs memory when a line really is that long.

**A client whose transport has died is thrown away rather than reused.** It is still an object, and its `receive_response` still returns, immediately and with nothing, so keeping it turns one lost answer into a conversation that replies to every later question in under two milliseconds with the news that the connection ended. Dropping it lets the next question build a fresh client, which resumes by session id, so the thread on screen survives what broke it.

**Both post-tool hooks are registered, and only one of them used to be.** `PostToolUse` fires for a call that succeeded and `PostToolUseFailure` for one that did not, so with only the first registered a failed call never cleared the table of running calls. That table is what the watchdog reads, and a turn holding a phantom running call waits against the one hour tool timeout instead of the fifteen minute silence timeout, so a turn that died after a failed tool sat there for an hour. One handler serves both and reads `hook_event_name` to tell them apart, which is also what makes a `tool_done` event possible for every call rather than only the ones that worked.

**The fence is also where the editor learns to follow.** On the branch that approves a write inside the project, the hook has just read the file to take the undo snapshot, so it knows both what the model is matching on and what it will match against: that is the only moment the landing line is knowable, because a second later the file has changed. A `focus` event carries the path and the line before the write happens, and carries nothing at all when the answer is not certain, since a highlight on the wrong paragraph spends the trust that the highlight means anything. Whether the view then moves is the browser's decision and it turns on whether this person has typed in the last three seconds, not on where the caret is: the caret sits in the editor for the whole time somebody is reading their own paragraph.

An agent edit is written to disk and then folded into the shared document, so the browser follows it live rather than being told to reload. If that fold fails, the file on disk is right and every browser holds text the agent has already replaced, which reads as the agent having done nothing, so the failure is logged rather than swallowed.

The transcript is the record of what was done to the document: every edit with its diff, every reverted edit, every command allowed or refused. It is an audit trail rather than session state, and it is what lets the panel survive a restart, since the model resumes its own memory by session id and would otherwise talk about "the sentence I added earlier" into an empty window.

**A figure is drawn by running a script, and that is the one own-tool the fence asks about.** Every other `mcp__nexttex__` tool is waved past the hook because none can reach the shell or a path outside the project. A tool that runs Python the model wrote can do both, and more than `Bash` can, so it is fenced like a shell call: asked at the first permission position with the script as the card's literal text, silent at the other two. It runs with `sys.executable` and no shell, because that is the environment `requirements.txt` installed matplotlib into and the answer must not depend on the writer's shell; with `MPLBACKEND=Agg` and no `DISPLAY`, so `show()` cannot hang the run waiting for a window; with the build's own timeout and its process group killed on it; and with output clipped, for the reason images are clipped. The script is written into the project's `scripts/` directory through the ordinary agent write path, so it is versioned source the writer can change rather than a temporary file, and the run is verified rather than trusted: a script that exits zero having written nothing is the common failure.

## History, trash and versions

**Content addressing.** A version is a sha256 of the file's bytes, stored once under that name, zlib compressed. Saving a file back to a state it has been in before costs nothing.

Every write NextTex knows about is recorded before the new text lands. This is not a replacement for git: it is what you want when you deleted a paragraph forty minutes ago and cannot remember what it said, at a moment when committing was the last thing on your mind.

Deleting is not a delete. An entry is written to the trash and the file is moved aside rather than removed, and moved rather than copied, so a folder of figures does not have to be compressed before it can be deleted. A text file also gets a final version recorded in its own history on the way out; a figure or a dataset does not, so for those the moved-aside payload is the only copy and it is what protects them. Nothing is cleaned up on a timer, because a trash that empties itself after thirty days loses the thing you go looking for on day thirty-one.

Blobs nothing refers to are collected in four places: when the trash is emptied, when one trash entry is purged, when a file's history is cleared, and on a timer for every project that is open. That last one is not an optimisation. A shared project is deliberately never evicted, eviction used to be the only routine sweep, and so a shared project kept every thinned version's contents for ever unless somebody emptied the trash by hand.

## Where state lives

Inside the project, in `.nexttex/`:

| | |
|---|---|
| `history/` | content-addressed blobs and the version index |
| `trash/` | deleted entries, with a directory deleted as one entry |
| `collab/` | `share.json`, the document logs, cursors |
| `context/` | templates and style guides the agent is given |
| `attachments/` | images handed to the agent by pasting, dropping or picking one |
| `library/` | the scanned bibliography folder |
| `transcript.jsonl` | the agent's audit trail, plus archived conversations |
| `session.json`, `agent-settings.json`, `usage.json` | per-project preferences |

In the install's state directory, outside every project: the instance token, hashed browser sessions, the OpenAI key if there is one, the project registry, and `peer.key`. Losing `peer.key` is losing the peer, not the work: the files are on disk and the collaboration can be joined again with a new invite.

Everything written through `write_atomically` goes to a sibling temporary file, is flushed to disk, and is then renamed over the target, with the directory flushed afterwards so the rename survives too. Renaming is atomic against this process dying and says nothing about the machine losing power: without the flush the rename can be on disk while the bytes it points at are still in the page cache, and the file comes back existing, the right length, and full of zeroes.

## The browser

React with a single mutable store read through `useSyncExternalStore`. A context and reducer tree would re-render the editor on every streamed token; this lets a component subscribe to exactly the slice it draws.

Three channels run at once. Ordinary **HTTP** for everything transactional. A **server-sent event stream** per project carrying `compile_start`, `compile_done`, `files_changed`, `trash_changed` and a dozen more. A **WebSocket per open document** carrying the CRDT sync and awareness traffic.

The editor is CodeMirror 6; the preview is pdf.js; maths hovers are KaTeX. The PDF pane, KaTeX, the collaboration client, the spell checker's word list, the tutorial, the upload card, the paper chooser, the file viewer, the version panel and the settings sheet are all fetched when they are wanted rather than before anything draws. Each of those is behind a click, and `bundle.initial_kb` counts only the entry script, so the test of whether something belongs out here is whether a session that never opens it should pay for it.

Work whose result is drawn goes through `onFrame` in `timing.ts`, because a browser fires `resize`, `pointermove` and `scroll` far faster than it paints.

## What is bounded, and by what

A single process with no database means nothing is bounded unless something bounds it. These do.

| | |
|---|---|
| Upload | 256 MB per file, 512 MB per request, 200 files |
| Request body | 512 MB, refused on `Content-Length` before the body is read |
| A file the editor will open | 10 MB |
| Idle agent | disconnected after 30 minutes |
| Idle session | evicted after 30 minutes, if nothing relies on it |
| Unanswered join | discarded after 10 minutes |
| Transcript | compacted by bytes, and 50 archived conversations kept |
| Build | 120 second timeout, then the process group is killed |
| A figure script | 120 second timeout, then the process group is killed; 64 kB of output per stream |
| Installing a package | 300 second timeout |

## Security posture

Ranked the way the threat model is: an install may sit on a tailnet behind its password, and separately its project may have come from somebody else.

Enforced: origin on every unsafe method, two separate credentials with constant-time comparison, scrypt off the event loop, a rate limiter keyed on the socket address rather than a forwarded header, a content policy built from hashes of the two inline scripts this app really serves, blobs served as attachments with a fixed content type, control files refused on the peer path and on upload, `nexttex.toml` validated rather than trusted, `latexmk -norc`, option-shaped arguments kept away from `git` and `gh`, and delegation refused under both of its names, before any branch that could allow it and again for any call that arrives from inside one.

**One thing is not fixed, and it is written down rather than claimed.** `openin_any` is passed to the engine and the pdfTeX this was tested against ignores it, under `a`, `r` and `p` alike, through the environment and through a `texmf.cnf`. Writes out of a project are refused; reads into it are not. A hostile source file can therefore read what the server's user can read and write it into a project file, which on a shared project reaches every peer. No amount of code here closes that.

## Testing

Four tiers, described in `docs/testing.md`. The short version: `scripts/check.sh` runs types, the frontend unit tests and the Python suite; `--all` adds the frontend build, the bundle budget and the browser tier; `--bench` runs the rest of the budgets against a thesis-shaped project.

The bundle budget is in `--all` rather than in `--bench` because it is a property of `frontend/dist` and needs nothing else: no synthetic thesis, no minute of LaTeX. It lived only in the benchmark tier, which is started by hand, and was therefore over budget for an unknown length of time with every routine check passing. A budget nothing routine looks at is a comment.

The Python suite needs nothing but Python. The agent is replaced by a scripted one, the network by the loopback transport, and the compile tests assert the command line rather than running an engine, so CI installs no TeX. Tests that genuinely need a TeX tool skip when it is absent, and put the tree on `PATH` before deciding to skip, or they skip on the one machine they were written for.

The installer is in that suite too, which it was not for a long time. `scripts/install.sh` and `scripts/install.ps1` are bootstraps that stop at the handover to `python -m nexttex.install`, and that package is standard library only because it runs before there is a virtual environment. `survey()` takes its platform as an argument rather than detecting it, so a machine of any of the three kinds is a case a test can construct; `Console.run` is the only place a child process is started, so a whole install is a list of argv to assert on; and the shell bootstrap is driven for real, under dash and at a controlling terminal made with `pty.fork`. `nexttex/install/steps.py` is imported by the running server as well, which is why its standard-library-only constraint has a test of its own: installing the Claude CLI from the settings sheet has to be the same act, and the same code, as installing it during the install.

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

**Two commits, read at two different times.** `HEAD_AT_BOOT` is read once here, when the process starts, and is the only commit this process can honestly claim to be running. The commit on disk is asked for when `/api/instance` is called, because it moves: an update pulls into the working tree of a server that is already running. They were one field, read at request time, so an install updated and not restarted reported the new commit, matched it against the remote, and called itself up to date while serving the old code.

**The version is a line in a file.** `nexttex/version.py` holds `VERSION = "x.y.z"` and nothing else decides it; `CLAUDE.md` says what the three parts mean and how a push advances them. `/api/instance` reports it as `version`, the update footer's quiet line names it, `server/run.py --version` and `python -m nexttex.version` print it above the two commits, and the bug report leads its install section with it. `updates.check` reads the upstream commit's copy with `git show @{upstream}:nexttex/version.py` after the fetch it has already paid for, so the footer can lead with the number an update would move to; an upstream older than the number gives an empty string, which the footer treats as nothing to say. The number is a fact about the code and not about the build: the interface asset stays keyed to the commit, and the `release` workflow, which runs on a `v*` tag, refuses a tag that disagrees with the file before publishing the commit subjects since the previous tag as the release notes.

**Restarting on purpose.** `POST /api/update/restart` exits with the supervisor's code, which is the same mechanism the update path uses: there is no way to ask uvicorn to stop from inside a request, so the exit is the restart. It refuses with 409 where `updates.supervised()` is false, because nothing there would bring NextTex back and a route that leaves the writer with no server is worse than one that says it cannot help. The footer only offers the control when the instance reports `supervised`. On Linux and macOS that is the unit or the agent, both configured to restart on a non-zero exit. On Windows a scheduled task is not a supervisor, a task that ends stays ended, so before it leaves the server starts a detached PowerShell helper, `updates.windows_restart_argv`, that waits for the pid to go and starts NextTex the way it was started: the scheduled task once it has left Running, the Startup shortcut if there is no task, and the same command line hidden with `--log-to-state` failing both. The helper is started with `CREATE_BREAKAWAY_FROM_JOB`, which took the install lane's Windows update leg two tries to teach: a task runs its action inside a job object, everything the action starts is in that job, a job with a live process in it is a task that still counts as Running so `Start-ScheduledTask` did nothing, and when the action's own process exited the job was torn down and the helper with it. Out of the job it outlives the exit and the task is free to start again. A job that forbids breakaway refuses the flag, and the helper then runs inside and does what it can; the server writes which happened to `restart.log` beside `server.log`, and the helper appends its own lines there, one per step and one for a failure, with `Add-Content` rather than a transcript. The helper gets a console it does not show (`CREATE_NO_WINDOW`) rather than none at all: started `DETACHED_PROCESS`, PowerShell's console host stopped before the first statement, and the lane read a `restart.log` with the server's line and nothing from the helper. `supervised()` is therefore true on any Windows with PowerShell; until the helper existed the update button there ended in "stop it and start it again", which for a task-started server meant Task Scheduler.

## The gate every request passes

Two middleware, and the order is load-bearing. Starlette builds the stack with the last one added on the outside, so `security_headers` is declared after `authenticate` and therefore wraps it. That matters because `authenticate` returns some responses without ever calling a route, and those refusals need the headers too. The sign-in page is one of them: it is the page an unauthenticated visitor actually sees and it takes a password.

`authenticate` does three things in order.

**Origin.** `Sec-Fetch-Site` when it is sent, `Origin` against `Host` otherwise, and absence is allowed. A page in a browser cannot arrange to send neither, and curl, the installer and the test client send neither. This exists because `SameSite=Lax` does not separate ports: a page on `http://127.0.0.1:5173` is same-site with NextTex and its cookie travels.

**Size.** A `Content-Length` past the limit is refused before the body is read. Starlette spools a multipart body to a temporary file before any route is called, so without this the per-file limits would bound what lands in a project and nothing would bound what the machine absorbs. A chunked request sends no length and slips past, which is why the per-file limits exist as well rather than instead.

**Credentials.** Two of them, doing different jobs. The instance token is what the installer prints: the recovery path, and how a script gets in. A session is what a browser holds, minted when it proves it knows the password or arrives carrying the token. They are separate so that a copied cookie is not a copied install, and so one browser can be signed out.

WebSockets do not run HTTP middleware, so `authorise_socket` applies the same origin and credential rules at the socket route.

An unhandled exception is answered by a handler that logs the route with a short reference and returns that same reference to the browser in the shape the client's single error path reads. Starlette's own answer is the plain text "Internal Server Error", which is not JSON, so the browser could not read it and fell back to the status line.

## Projects and sessions

A project is any directory of LaTeX. NextTex does not own it, move it, or require a layout. It adds two things: an optional `nexttex.toml` at the root, which you may commit, and a `.nexttex/` directory of generated state, which you should not.

**There is no main document.** Every `.tex` with a `\documentclass` and a `\begin{document}` of its own that nothing else reads is a document, with its own `DocumentState` in the session: its own `ProjectPaths`, `CompileScheduler`, build counter, diagnostics and PDF under its own jobname. `nexttex/deps.py` holds the graph. `standalone_candidates` lists the documents not yet on the preview strip; `owners` says which documents a saved file belongs to, so a save rebuilds only those; and `root_of` climbs the other way, from a file through everything that `\input`s, `\include`s, `\subfile`s or `\import`s it to the file nobody reads, so a chapter three parts deep previews the thesis. Where two documents read one file, the document on screen wins, then one already on the strip, then the first by path, so the page never changes under the writer and the answer is the same on every open. Which documents are on the strip is viewer state: `.nexttex/previews.json`, per install, read by `PreviewList` in `nexttex/project.py`, because `nexttex.toml` is shared with collaborators and a preview that follows one writer's editor must not grow the strip on another's screen. A toml that still carries `main` and `previews` from an older NextTex is read once to seed that list and the keys are not written back. A project with no document at all opens with an empty strip; the routes that once meant "the main document" mean the document in front, and answer 404 rather than 500 when there is none. `POST /api/projects/{id}/previews` takes any `.tex` path and answers with the document it belongs to, registering it if it was not on the strip, which is how the editor's active tab pulls its document forward. The two strips also close together, and that is the browser's affair with nothing new on the wire: when a document is taken off the strip, `orphanedBy` in `frontend/src/tabs.ts` inverts the `owners` map the browser already holds, as it stood before the removal, to find the open files that belonged to it and to nothing still on the strip, and `closeMany` in `frontend/src/App.tsx` moves both strips in one store write so the follow effect never sees them disagree. The other direction is narrower: `App.tsx` keeps a per-window `followed` set of the documents this window put on the strip by following an opened file, and `unfollowed` drops such a document when its last open file closes, never the last document on the strip and never one the writer selected, added or acted on by name. The set is browser memory, empty after a reload and never shared, because the strip is shared between windows and the tabs are not.

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

**A join holds its documents in memory until it is accepted.** `POST /api/collab/join` syncs the project, waits for the bodies rather than for the manifest that lists them, and answers with the file list. Nothing is written: the store and the peer connection stay open in `PENDING_JOINS`, and accepting marks every record for projection and flushes, while discarding closes both and removes the folder, which by then contains only `.nexttex/collab`.

**A path from the other end is fenced at both ends of every operation it names.** `resolve_for_write` is the fence, and a rename has two paths, not one. While only the target was resolved, a peer could name a file `../../.ssh/id_rsa`, let that become the baseline `settle_paths` measures the next change against, then rename it to `notes.tex`: the source was built as `root / was` with no fence, so the file was moved off the disk into the project, where the manifest handed it to everybody in the share. The baseline is fenced when it is recorded and the source is fenced when it is used. A local file the rename displaces goes to the trash rather than being renamed out of the way in silence.

**Disk to document.** `ingest` folds an outside change back in: a `git pull`, the agent's own write, an editor in another terminal. It diffs against what was last projected and applies only the spans that moved, so a remote cursor is not thrown across the document by an append.

An edit reaching the disk measures at 3.1 ms on a thesis-shaped project, of which the edit arriving is 3.0.

**Undo belongs to the document, not to the editor.** A live editor's Ctrl+Z runs the scoped `Y.UndoManager` that `collab.ts` builds per file, bound by `yUndoManagerKeymap`; CodeMirror's own `history()` is not in a live editor's extensions at all. The two cannot both be there. A buffer is built before its socket has synced, so the file arrives afterwards as one transaction, and an editor with CodeMirror's history had that transaction on its stack: six presses of undo emptied the file on disk and for every other browser. The read-only panes, a version being viewed and a file that could not be connected, keep CodeMirror's history, because they have no shared document to own theirs.

**Copying a file is a fourth path, and it has to start by closing the second one.** `POST /api/projects/{id}/file/duplicate` flushes every dirty shared document before it copies anything, because the file on disk trails the document by the 120 millisecond debounce and a copy taken without that would hold the chapter as it was rather than as it is, with nothing on screen to say which of the two the writer had got. The name is chosen on the server by `unique_name`, the same rule the trash restores through and the upload chooser quotes back, and the route answers with the name it picked rather than accepting one. It publishes its own `files_changed`; the watcher would find the new file eventually and in a batch, so this is what makes the copy appear in the same beat the menu item was clicked in, for every tab and every collaborator.

**Creating a file is the same shape.** `POST /api/projects/{id}/file/new` touches the file and then ingests it into the manifest itself, before it answers. The browser opens a file it just made the moment the route returns, and `waitForFile` in `collab.ts` gives it eight seconds to appear in the manifest before falling back to a read-only pane and a toast about reloading. The manifest used to learn of the file only from the watcher, whose poll, debounce and socket round trip were exceeding that on a loaded machine; a Playwright spec that types into a new file was flaky for exactly this reason. The watcher's own ingest, when it comes, diffs and finds nothing to do.

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

The one non-obvious mechanism is the **stand-in main file**. `\includeonly` has to sit in the preamble, so scoping a build means either editing your main file on every keystroke or compiling something else. Editing yours is not acceptable, so NextTex writes a shadow main file into the build directory and compiles that. The stand-in has one line the real file does not, when the real file had no `\includeonly` of its own to replace: the directive goes on a line of its own after `\documentclass`, and everything below it is one line further down in the copy. SyncTeX only ever saw the copy, so `nexttex/synctex.py` keeps `shadow_shift`, which finds that line by comparing the two files rather than by remembering what the last build did, and both routes correct for it: `/api/projects/{id}/synctex/inverse` moves a line the map reports for the stand-in one up, and `/api/projects/{id}/synctex/forward` asks about the real file first and, when the map does not know it, about the stand-in with the line moved one down.

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

The transcript is the record of what was done to the document: every edit with its diff, every reverted edit, and every command allowed, refused, or left unanswered. The third of those was missing and it is the one a reader would most want: a card that timed out was written down as refused, which is a statement about a decision nobody made. A turn also writes a `turn_end` record when it finishes, so a transcript that stops mid-sentence can be told from one that ended, without guessing from what the last record happens to be. It is an audit trail rather than session state, and it is what lets the panel survive a restart, since the model resumes its own memory by session id and would otherwise talk about "the sentence I added earlier" into an empty window.

**A figure is drawn by running a script, and it is one of five own-tools the fence asks about.** Most `mcp__nexttex__` tools are waved past the hook because none can reach the shell or a path outside the project. Installing a package is asked about wherever the network is, because pip downloads from PyPI and runs what it downloads. Three more can reach the network: searching the literature, adding a reference by DOI, and checking a bibliography against its publishers. They ask wherever a network tool asks, which is the first two positions, because the wave-past was written for tools that cannot leave this machine and these leave it with search terms and identifiers taken from the project's own files. The README's account of what leaves this machine lists them, so the fence and the README now agree. A tool that runs Python the model wrote can do both, and more than `Bash` can, so it is fenced like a shell call: asked at the first permission position and at the middle one with the script as the card's literal text, silent only at the last. The middle position is the one that says "the work runs without asking, and a write outside the project or anything reaching the internet still stops", and a tool that runs arbitrary Python is more than either of those: it went through silently for as long as the exclusion list named four answers and the code that built it named three. It runs with `sys.executable` and no shell, because that is the environment `requirements.txt` installed matplotlib into and the answer must not depend on the writer's shell; with `MPLBACKEND=Agg` and no `DISPLAY`, so `show()` cannot hang the run waiting for a window; with the build's own timeout and its process group killed on it; and with output clipped, for the reason images are clipped. The script is written into the project's `scripts/` directory through the ordinary agent write path, so it is versioned source the writer can change rather than a temporary file, and the run is verified rather than trusted: a script that exits zero having written nothing is the common failure.

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

A second install on the same machine is a named instance: `--instance NAME` at install time gives it `~/.local/share/nexttex-NAME`, a port derived from the name, a service called `nexttex-NAME` and a badge in the interface. The name reaches the process as `NEXTTEX_INSTANCE`, which the systemd unit and the launchd plist set in their environment. A Windows scheduled task, a Startup shortcut and a desktop shortcut on any platform are a command line and nothing else, so for those the name travels as `server/run.py --instance NAME`, which sets the variable before `Settings.load()` asks where the state directory is. Every launcher writes that argument; until it did, a named instance started from a shortcut or at login on Windows came up as the default instance, on the default port, over somebody else's projects.

Everything written through `write_atomically` goes to a sibling temporary file, is flushed to disk, and is then renamed over the target, with the directory flushed afterwards so the rename survives too. Renaming is atomic against this process dying and says nothing about the machine losing power: without the flush the rename can be on disk while the bytes it points at are still in the page cache, and the file comes back existing, the right length, and full of zeroes.

## Reporting a problem

`nexttex/report.py` composes the text a bug report carries: the commit the code is on and the commit the interface was built from, the settings with a yes or no where a secret would be, every tool the installer's own `survey()` looks for and where it found it, whether something supervises the process, what `claude auth status` says minus the account, a count of projects, and the last eighty lines of each log the install keeps. On Linux the server's output is in the user journal, so the report runs `journalctl --user -u nexttex` and quotes that; on macOS and Windows it is `server.log` and `server.err.log` in the state directory. `install.log` and `update.log` are quoted from their last `=== ` block, which is the run that just happened.

It is composed as one string and redacted once, at the end, over the whole of it. The pass replaces every secret value the config file holds (the token, the OpenAI key, the password hash and salt, each browser session's fingerprint), then any `token=` in a URL, then any line shaped like one of those keys, then anything that looks like an API key, and finally the home directory, which becomes `~`. Order matters: a secret never contains the home path, and doing the path first would move the text under the patterns that follow. Doing it in one place is what lets one property test say the whole report is clean rather than one test per section.

Two constraints shape the module. It imports only the standard library at module level and runs as `python -m nexttex.report` on a bare interpreter, because a broken virtual environment is one of the likelier things to report and `server/run.py` imports uvicorn before it reads its arguments. And nothing in it opens a socket: `survey()` is asked not to probe the network, no update check is made, and the only thing that leaves the machine is the text the writer reads and pastes for themselves. It never reads `peer.key`, `key.pem`, `cert.pem`, a project's transcript, history or context, or any file of a manuscript; `projects.json` is opened for a count and its paths are not repeated. It never writes: the config is read raw rather than through `Settings.load()`, which creates the file when it finds none.

The same text is served at `POST /api/report`, where the browser adds what it saw: its user agent and a bounded list of its own last errors. The server composes the whole thing so that redaction has one choke point, since an error message on the client side can quote `window.location`, and that carries the token. The answer also holds the new-issue URL for the checkout's own GitHub remote (`updates.repository_slug`, falling back to the canonical repository when the remote is a local path), with the short facts filled into the form's fields and the report itself left for the clipboard, since a query string is capped by the server at the other end and the clipboard is not. The 500 handler's eight-hex reference is the join: it is in the message the writer saw and in the log line the report quotes. One section differs by entry point: `supervised()` and the two supervisor variables describe the process composing the report, which is the server from the footer and the terminal from `--report`, so the terminal report leaves those lines out and both ask systemd about the unit directly.

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
| A project search | 200 characters of pattern, 500 hits, and the regular expression runs in a thread |

## Security posture

Ranked the way the threat model is: an install may sit on a tailnet behind its password, and separately its project may have come from somebody else.

Enforced: origin on every unsafe method, two separate credentials with constant-time comparison, scrypt off the event loop, a rate limiter keyed on the socket address rather than a forwarded header, a content policy built from hashes of the two inline scripts this app really serves, blobs served as attachments with a fixed content type, control files refused on the peer path and on upload, `nexttex.toml` validated rather than trusted, `latexmk -norc`, option-shaped arguments kept away from `git` and `gh`, and delegation refused under both of its names, before any branch that could allow it and again for any call that arrives from inside one. The environment git is given is built from nothing rather than inherited, for the same reason: it carries `PATH`, `HOME`, `LC_ALL`, the two variables that stop git waiting for a password nobody will see, the ssh agent's socket, and `SystemRoot`, which is what the Windows socket stack needs to resolve a name at all. The SDK is also started with `strict_mcp_config`, so a project carrying its own `.mcp.json` cannot add tool servers to the session: a project is somebody else's data, and a file in it that names a program to run is the same class of thing as a `nexttex.toml` that names a compiler.

Project-wide search is the one route that compiles a regular expression written by whoever is holding the keyboard. Python's `re` has no timeout and a short pattern can backtrack exponentially, so the pattern is capped at two hundred characters, escaped unless a pattern was explicitly asked for, and matched in a worker thread: a pathological pattern then costs a worker rather than stopping every other request on the install.

**One thing is not fixed, and it is written down rather than claimed.** `openin_any` is passed to the engine and the pdfTeX this was tested against ignores it, under `a`, `r` and `p` alike, through the environment and through a `texmf.cnf`. Writes out of a project are refused; reads into it are not. A hostile source file can therefore read what the server's user can read and write it into a project file, which on a shared project reaches every peer. No amount of code here closes that.

## Testing

Four tiers, described in `docs/testing.md`. The short version: `scripts/check.sh` runs types, the frontend unit tests and the Python suite; `--all` adds the frontend build, the bundle budget and the browser tier; `--bench` runs the rest of the budgets against a thesis-shaped project.

The bundle budget is in `--all` rather than in `--bench` because it is a property of `frontend/dist` and needs nothing else: no synthetic thesis, no minute of LaTeX. It lived only in the benchmark tier, which is started by hand, and was therefore over budget for an unknown length of time with every routine check passing. A budget nothing routine looks at is a comment.

The Python suite needs nothing but Python. The agent is replaced by a scripted one, the network by the loopback transport, and the compile tests assert the command line rather than running an engine, so CI installs no TeX. Tests that genuinely need a TeX tool skip when it is absent, and put the tree on `PATH` before deciding to skip, or they skip on the one machine they were written for.

The installer is in that suite too, which it was not for a long time. `scripts/install.sh` and `scripts/install.ps1` are bootstraps that stop at the handover to `python -m nexttex.install`, and that package is standard library only because it runs before there is a virtual environment. `survey()` takes its platform as an argument rather than detecting it, so a machine of any of the three kinds is a case a test can construct; `Console.run` is the only place a child process is started, so a whole install is a list of argv to assert on; and the shell bootstrap is driven for real, under dash and at a controlling terminal made with `pty.fork`. `nexttex/install/steps.py` is imported by the running server as well, which is why its standard-library-only constraint has a test of its own: installing the Claude CLI from the settings sheet has to be the same act, and the same code, as installing it during the install.

What none of that can answer is whether the documented command works on a machine, and `.github/workflows/install.yml` is the tier that asks. On a schedule and on demand, it feeds the checkout's `install.sh` to `sh -s` the way `curl | sh` would on ubuntu and macOS runners, pipes `install.ps1` through `iex` under Windows PowerShell 5.1 and runs it from the checkout under pwsh 7, installs the previous commit from a bare copy and updates to this one with the update scripts, runs the shell bootstrap inside Debian, Alpine, Fedora and a container with no Python, and runs the browser tier's update spec against the install it just made. `tests/lane/verify_install.py` holds the assertions, which are the README's own claims: the venv imports the app, the interface belongs to the commit, `install.log` names every step, the address prints, `/api/instance` answers with the right head and refuses a wrong token, the service file is where the README says, a second run appends one block to the log and changes nothing else, and the README's uninstall commands leave nothing behind. It runs on the runner's bare interpreter, imports only the standard library, and is not collected by pytest, because what it needs is a machine that was clean five minutes ago. Its first runs found the uv branch of the bootstrap had never worked, the log held half of what it claimed, and three of the scripts needed a bash that Alpine does not have, so every shell script the installer or the server runs on a machine is POSIX sh now, checked under dash and by shellcheck in the per-push job.

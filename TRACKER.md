# What is in hand, and what is waiting

This is working state, not documentation. It lives here rather than in `docs/`
because it describes what has not been done yet, which is the opposite of what
the documents are for.

**How it is used.** Finishing a piece of work means striking its line from *In
hand* in the same commit as the code, and writing anything the work turned up
but did not do into *Backlog* with one sentence saying why. That happens
alongside the other documents a change owes: `docs/architecture.md` when the
mechanics move, `docs/design.md` when the interface does, `README.md` when
something a reader would act on changes. Updating this file is part of the
change, not a tidying commit afterwards.

**There is no Done section.** The commit messages in this repository are long
enough to serve as one, so `git log` is the record of what was finished and
why. A Done section here would duplicate it and grow without bound, and the
only thing this file has going for it is that it is short enough to read every
time.

Every backlog item carries its reason. An item with no reason attached is one
nobody can ever decide about later, which is how a backlog becomes a place
things go to be forgotten rather than a list anybody reads.

## In hand

The backlog close-out runs on 22 September, after 3.6.0, over two legs.
The writer asked for the backlog's unverified half: the items that stayed
open only because nobody could reproduce them or nobody had the machine,
plus the browser-tier flakes that have a named fix. The Windows leg is a
real laptop driven by a session of its own, which deletes the install that
is there and makes a fresh one from the documented command, so the
installer, the launcher, the update and the restart helper are all under
test rather than only what they leave behind. Two read-only passes over
that machine came first and moved three items before any code: the
restart helper's Startup-shortcut branch has in fact run twice, on 15 and
18 September, where the backlog says it has run nowhere; the silent exit
has a second sighting, the server having bannered at 16:43:02 on 18
September and nothing having listened since, with no crash, no reboot, no
Application Error and no further byte in its own log, on a machine that
slept 73 times in that window, which makes Modern Standby the suspect the
original sighting never had; and the machine's account is an
administrator running unelevated, so the logon task branch can be run
there for the first time anywhere with a click on a UAC prompt. The code
leg, 3.6.1, carries what the flakes turned out to be: the figure viewer's
Download and the preview strip's Save PDF are still the bare anchor that
`43e9c2c` swept everywhere else and named the figure viewer while missing
it, a browser that connects late is never told its project is shared, and
a keystroke during a file swap lands in the file just left. The tracker is
https://claude.ai/artifact/NJ2VxtkGiPiwe3Sh3TFHxu.

The placement run goes up as 3.5.0 on 22 September, raised by the writer
after 3.4.2 as a tune up of the hover cards and the selection menu: the
cards blocked the thing hovered and vanished on the way to their buttons,
and the menu had no order to where it appeared. Renders at 100 % and
125 % interface size found one cause under both, the shell's `zoom`
against measurements written as CSS pixels, and two more under the
cards: CodeMirror's layer pinning a card over a multi-line range, and a
button press leaving the card open. One placement rule, `placeClear`,
now serves the verb row and the card; the card is a plugin of its own
that stays for the pointer. Section 61 of `docs/design.md` and the
direction page's Clear of the text section (version 54) carry the
record; the tracker is https://claude.ai/artifact/JQviUT4Tsyy5xAX21SYW6e.
The same run then raises the dark theme's floor, at the writer's word,
as its own push.

The hover cards run went up as 3.4.0 on 21 September, planned after the
writer asked for a toggle for the editor's hover previews and control
over which kinds get one: a switch called Hover cards on the settings
sheet's While you write group and, under it while the switch is on, six
toggle chips, Equations, Tables, Figures, Cross-references, Citations,
Files, a new kit control, `ChipToggle`. The drawing went on the direction
page (version 51) and was approved before any code; the sheet was
rendered in both themes and with the switch off beside it, and matched.
The gate is a live read of `data-hover-cards` off the root at the moment
of the hover, so nothing is reconfigured; a reference's card draws the
thing it points at only while that thing's own kind is on. Two reports
arrived after the push and were folded in as 3.4.1: a bibliography
garbled on screen after two outside writes (pycrdt indexes a shared text
in UTF-8 bytes and the store's diff was in code points; `splice` converts
now and a guard puts the file in whole if a fold ever leaves the document
differing from it), and figures on the wrong page until a whole rebuild
(compile as you type is one engine pass, and the engine's own "rerun"
hints went unread; a settling full build now follows a fast pass that
left the layout unconverged, superseded by the next keystroke). The
run's tracker is https://claude.ai/artifact/AQ3u3A5natmoaGvokAse2Z.

The fit run went up as 3.3.0 on 21 September, planned against version
47 of the direction page from what the writer found on opening 3.2.0:
the project's name running past a narrowed drawer into the editor (the
left column had no width of its own; it now states the bar, the drawer
and the handle, and a name that does not fit fades at the column's edge
and glides under the pointer, the writer's choice from three drawings,
with the Files count yielding before its word at the drawer's
narrowest), the four feet's controls 2 px above their strips' centre
line (one class, `nx-foot`, carrying the drawers' foot padding onto the
strips; the drawers' rule is `nx-panel-foot` now), a tab's keyboard ring
in the pen colour outside its block where the guide gives rings the hint
colour, three drawers (the bibliography's, Deleted and History) drawing
an empty state for the round trip before their first answer, and the
bibliography drawer's name, which is References. Every surface was
compared with the page in both themes before its commit, and none
deviated; the run's tracker is
https://claude.ai/artifact/CBDEP9n8hMH2MhUahVY6e2.

The frame run went up as 3.2.0 on 21 September, planned against version
44 of the direction page after the writer opened 3.1.0 on a real
manuscript: no title bar, the project's name heading the left column,
the four first rows one band on the surround with the activity bar and
a foot under each column on the surround too, no line between panes at
rest, the open tab as the pane's own block with a short rule parting the
rest, New conversation in the composer; People, Build and Download as
drawers on the bar in place of the title bar's Share and Download and
the tray under the source; the formula and table cards without their
source; and a reference to a figure, a table or an equation drawing the
thing on hover, from an environment index the scan now keeps. Every
surface was compared with the page in both themes before its commit.
Two things it changed on the page, recorded there: the light theme's
error and warn inks stepped one shade darker to clear the surround, and
an invite's note says a week, which is what the server keeps. Two
tangents on the way: a collaborator's caret position is reported on
every move rather than only while typing, and `AppControls`, the folded
rail's bar from before the overhaul that nothing mounted, went with the
download menu. The writer then settled the five differences the run
put to them, all as built, the plan block in the Claude column among
them: it sits before the agent's words, in transcript order, and the
page now draws it there.

The visual overhaul, after 2.18.0, rebuilds the interface on one kit and
goes up as two pushes. It was planned over seventeen versions of a
direction page the writer went through surface by surface, and that page
is the specification: every surface is compared with it before its
commit. The first push, 3.0.0, is the workspace: the tokens and the type
roles on one family, a kit under every control, every menu and card on
it, the light theme lit throughout, an activity bar and one drawer in
place of the accordion rail, the Claude column, the strips, the editor's
own chrome, and the settings sheet as master-detail; it is an x because
the editor page goes from six grounds to two, the theme's own and the
page's white. The second, 3.1.0, is the front door: the projects screen
as a list under an app bar, with the writing agent chosen and set up
there, a job application among the presets and Share on a row; the
screenshots, README and design sections follow. What it leaves is
written here as it is found.

The workspace push went up as 3.0.0 on 20 September with every item of
Phases 1 and 2 landed and compared with the page in both themes: the
tokens, the type on one family, the kit and every overlay on it, the
light theme lit throughout, the activity bar and one drawer with the
eight instruments rebuilt, the strips and the tab strips, the master
detail settings sheet, the Claude column with its views and composer,
the editor's find strip and Vim bar, and the Git and Files drawers.
Three things it left for the writer, on the tracker: the table hover
card (item 2.10a) is drawn on the page as version 20 and waits on a
yes before its code; the floating Claude pill keeps its earlier look
because the page did not draw one; and the plan block in the column
sits before the agent's words, as the transcript orders it, where the
page drew it after. The CSS retirement of `.quiet` and `.ghost-button`
follows the front door's rebuild (item 3.5), since those files still
wear them.

The front door went up as 3.1.0 on 20 September, and the overhaul is
finished: the projects screen as a list under an app bar (3.1), Share
from a row (3.1a), the job application template (3.1b), the writing
agent chosen and set up in one sheet reached from the bar, the settings
sheet and the Claude column (3.1c), projects archived or put in the
trash with their views and restore (3.1d), the app bar's lock with its
hover card, the join offer inside its sheet and the access card's bodies
(3.2), the floating pill on the kit's card with its shortcut in the
tooltip (3.2a), the update sheet, the tutorial brought up to date on the
kit with its figures regenerated, the screen guide, the failure and
waiting screens, all closing with Esc (3.3), the README's thirteen
pictures and its prose read against the app (3.4, 3.4a), the record in
`docs/design.md` §56 and the style guide, `docs/style-guide.md`, with
its rule in `CLAUDE.md` (3.5, 3.5a), the figure hover as the tree's card
(3.6), and the three legacy button classes gone from the stylesheet.
Every surface was compared with the page in both themes; the three
deviations the writer settled on the page (the frame's grey, the
banner's verb, the pill) are recorded there. One difference is still
with the writer: the plan block in the Claude column sits before the
agent's words, in the order the transcript has them, where the page drew
it after; it was reported at 3.0.0 and has had no answer, and moving it
is a small change if the writer wants the page's order. Nothing else on
the interface was left; the tangents the run fixed on the way are in the
log, the last of them found by the front door's sweep,
`e2e/shots/front-sweep.spec.ts`, which now runs beside the workspace's
at every push.

## Backlog

### Known gaps, with a cost somebody will eventually pay

The backlog close-out worked every line here that this host could work.
What stays needs a Windows machine, GitHub, or a report that names what
this host could not reproduce; each says which.

- [x] **A hover card no longer fetches and decodes a whole image to draw
      a small picture of it.** `thumbnail` in `frontend/src/panes/thumbnails.ts`
      makes a raster's picture by setting `picture.src` to the download
      route, so hovering a tree row for a 192 MiB PNG fetches 192 MiB and
      decodes it in the renderer to fill a card a few hundred pixels
      wide; the PDF path reads the whole file into an `ArrayBuffer` for
      the same reason. A renderer on the Windows laptop did freeze for thirty
      to sixty seconds with such a file in the project on 22 September,
      which is what sent somebody looking, but that attribution was
      **withdrawn** the next day by the session that made it: the freeze
      also happened with the file absent, the same pane then opened the
      192 MiB PNG without trouble, and the machine had 1.9 to 2.2 GB free
      of 15.6 GB that afternoon with two such images loaded in browser
      tabs and one background command killed outright for low memory. So
      nothing here is known to have stalled anybody's browser and the cap
      rests on the cost alone, which is enough: fetching two hundred
      megabytes to fill a card a few hundred pixels wide is indefensible
      whether or not it has yet hurt somebody. The
      fix is cheap and the size is already at the call site:
      `FileCard.tsx:40` passes `node.size`, and a file over some
      threshold takes the state the card already has for a file it cannot
      draw, its name and its size alone. Done: `BIGGEST_PICTURE` is
      thirty-two megabytes, far above a full-page scan at print
      resolution and far below the size at which fetching one is a pause
      the writer notices, and `hasThumbnail` answers before anything is
      fetched. No new visual, since the state it falls back to is one the
      card already draws.
- [x] **A file moved out of a project and back is no longer deleted, and
      a path that once held a deleted file no longer swallows what is
      written to it.** Found on the owner's Windows install on 23
      September, by moving a figure out of its folder and back with
      ordinary shell moves: NextTex put it in its own trash, recorded the
      deletion as the writer's own, took it again 577 ms after Restore put
      it back, and swallowed anything afterwards written under that name
      while the same bytes under another name survived. A sync client, a
      `git` checkout and any editor that saves by writing a temporary file
      and renaming it over the target all do exactly that move. Four
      causes, all in `server/collab/store.py`, all fixed together with
      `tests/collab/test_a_file_that_comes_back.py`: the returning file
      never withdrew the pending sighting, never cleared the flag once the
      deletion had settled, was invisible to `file_id_for` because that
      skips trashed records and so was adopted as a second record, and
      `settle_paths` then followed the first record's deletion by moving
      whatever was at the path into the trash. What is still open is the
      trash record's own claim, the next line.
- [ ] **An editor pane drew a document's collaboration log where the file
      on disk said something else.** Seen once on the Windows install on
      23 September and not dug into, because the run it turned up in was
      holding that machine as evidence for the trash bug. After a fresh
      page load the editor showed a 449-byte version of `main.tex` that
      had been written into the project at 16:36 the day before; the file
      on disk was the 69-byte original, and
      `GET /api/projects/{id}/file` served those 69 bytes correctly. The
      document's log, `.nexttex/collab/docs/f67098301b6788c1.y`, was last
      written at 16:36:37, which is exactly when the 449-byte version was
      made. So the file, the route and the log disagreed, and the editor
      drew the log. Nothing was lost, but a writer who opened that project
      and typed would have written the stale text over their own file,
      which is the same shape as the trash bug and lives next door to it
      in `server/collab/store.py`. What would settle it: whether the fold
      that reconciles a document with its file runs when the file was
      changed while the document was open but no tick was seen, and
      whether the log or the disk is meant to win when they differ at
      open. `tests/collab/test_outside_edits.py` is the file that already
      asks half of this question.
- [x] **A trash entry no longer says the writer deleted the file when
      nobody did.** Every entry carries `by: "you"`, including one written when
      the watcher inferred a deletion and one written for a file that had
      merely been copied in. The schema in `nexttex/trash.py` has nowhere
      to say otherwise: `id`, `at`, `by`, `path`, `name`, `kind`, `files`,
      `dirs`, `count`, `bytes`. With the line above fixed, most of those
      entries stop being written at all, but a deletion followed from a
      peer is still filed as this writer's doing, which is wrong in the
      one place somebody looks when a file has gone. `source` and `why`
      sit beside `by` now, absent on every entry written before they
      existed and read as the writer's own when missing, so nothing
      already in anybody's trash changes meaning. The vocabulary was
      borrowed rather than invented, from the history one module over,
      which has carried `op`, `why` and a `source` token all along. The
      two callers that are not the writer say so: a collaborator's
      deletion followed onto this disk, and a file replaced while
      rejoining a share. **What is left is the interface**: no panel shows
      the new field yet, and what a trash row should say when a deletion
      was not the reader's own is a drawing for the direction page before
      it is any code.
- [ ] **A file deleted outside NextTex does not schedule a build.** The
      watcher's tick now tells the compiler about every outside write it
      sees, so a pull, another editor's save or a regenerated figure
      reaches the page, but a file the tick saw go is not yet known to be
      deleted, for the reason `ingest` gives, and is settled at the
      flush, where nothing schedules a build. A chapter removed in another
      terminal therefore stays on the page until the next edit, when the
      build fails on the missing input. Left because the honest build is
      a failing one and the flush's `_settle_gone` would need to tell the
      session; small, once somebody wants it.
- [ ] **A PNG download the writer reported as broken was not reproduced,
      twice.** The report names the tree's row-menu *Download*, in Chrome.
      The route answers the bytes with `image/png` and an attachment
      disposition; the tree's, the viewer's and the History panel's
      *Download* each raise a real download in Chromium under
      `e2e/specs/image-view.spec.ts`; and the backlog close-out went
      after the two things that tier lacks, the origin and the size: a
      throwaway install behind a TLS front on this host, a 1 MB PNG and a
      201 MB one, Playwright's full Chromium through the row menu, both
      files landing with their full byte counts and a clean console,
      twice. Google Chrome itself is not on this host. What would close
      it: the words on Chrome's download bar when it fails ("Failed -
      Network error", "Blocked", "Insecure download"), whether it was the
      laptop or this machine, and whether the tab was on the tailnet's
      HTTPS address or the token URL. A third attempt, on the laptop on
      22 September in Google Chrome 153 on the reported commit itself
      (`ba4b191`), downloaded a 169-byte PNG intact through the tree's row
      menu and through the image viewer's strip, with the project open a
      full minute first. **It clears nothing**, and the reason is worth
      keeping: that install serves plain HTTP on 127.0.0.1, it has no TLS
      front and no reachable HTTPS address, so the condition the failure
      was recorded under was never reproduced. The download bar's wording
      and the console were not captured either, and the 192 MiB file was
      not downloaded through any control. The preview strip's Save PDF was
      not reachable because the project had no typeset PDF, so whether it
      lands as `pdf.pdf` is still unconfirmed on a real machine. The close-out run then found that
      two controls had never left the link road at all, the figure
      viewer's *Download* and the preview strip's *Save this PDF*, both
      missed by the sweep that named the first of them; they are on the
      fetch helper now and `no-link-downloads.test.ts` forbids the shape.
      That is not this report, which names the tree's row menu, and the
      three questions above are still what would close it.
- [ ] **A Windows install's server exited silently after an update's
      restart.** Seen on the laptop during the cross-machine check for
      2.3.0: the restart helper launched the Startup shortcut, the new
      server printed its banner four seconds later, and by morning nothing
      was listening, with `server.err.log` empty and no crash, reboot or
      logoff in Windows' own logs. Either the process died with nothing
      logged or the minimized console window the shortcut opens was closed
      by hand, which kills it without a word.

      **A second sighting, on 22 September, with better evidence and a
      better suspect.** The same machine: the helper took the Startup
      shortcut at 16:42:56 on 18 September, the server bannered at
      16:43:02, and nothing has listened since. The event logs across that
      window are silent in a way that is itself the finding: uptime
      unbroken since 14 September, no Kernel-Power 41, no 1074, no 6008,
      no bugcheck, zero Application Error events, zero events naming
      python, and an empty Windows Error Reporting queue. The process
      ended and nothing anywhere recorded it. What that machine did do in
      the window is sleep: 73 Modern Standby cycles, 506 and 507 balanced,
      the first of them two hours and forty minutes after the banner,
      seventeen of half an hour or more and the longest seven and a half
      hours. Nothing records a process reaped across Modern Standby, which
      is exactly the evidence this leaves, and it would explain the first
      sighting too, where a laptop was found dead in the morning. The
      owner does not remember closing the window, so the original guess is
      not ruled out, but it is no longer the first thing to check.

      Process Termination auditing was turned on there on 22 September at
      16:42, elevated, going from No Auditing to Success and Failure, so
      the next death leaves a 4689 event. Reading it needs one more
      elevation, because that account cannot read the Security log
      unelevated; granting it read access was attempted and refused, and
      the route to prefer if it is tried again is an explicit allow-read
      ACE for the account's SID on the Security channel rather than
      membership of Event Log Readers, since group membership lives in the
      logon token and would not reach a session that only unlocks.

      **A watch is running now**: pid 33316, python 3.12, port 8450,
      started 20:48:11 on 22 September by the Startup shortcut through the
      restart helper, on `b3b9e13` / 3.6.1. It replaced pid 3240, which
      the update ended. What it answers is whether a server on that
      machine survives a night of Modern Standby at all, which does not
      depend on which commit it runs.

      One thing in `server.err.log` there is not this bug. It grew from 92
      to 832 bytes at 16:34:58 on 22 September with a
      `ConnectionResetError` from `_ProactorBasePipeTransport`, which is a
      client connection dropped abruptly while a browser was being driven
      at it, not a server dying: that server went on answering until the
      update stopped it at 20:48. Recorded because "server.err.log empty"
      is half this item's signature and the next reader should not take
      that traceback for the silent exit finally leaving a trace.
- [x] **The Windows restart helper's Startup-shortcut branch has run, and
      this line used to say it had run nowhere.** `restart.log` on the
      owner's laptop, read on 22 September, holds two clean passes of it:
      `[2026-09-15 23:24:42] server: helper started as pid 32948
      (breakaway=True); leaving`, then `helper: waiting for pid 31624`,
      then `[23:24:46] helper: starting ...\Startup\nexttex.lnk`; and the
      same three lines again on 18 September at 16:42:53 to 16:42:56, with
      a server banner in `server.log` six seconds later each time. The
      account there is an administrator running unelevated, which is why
      `register-task.ps1` fell back to the shortcut in the first place, so
      this is exactly the middle way back the line said nothing had taken.
      A third pass on 22 September at 20:48:07 was watched end to end
      rather than read afterwards: the helper started as pid 26204 with
      `breakaway=True`, waited for pid 3240, which had been written down
      beforehand, and launched the shortcut four seconds later, and the
      server that answered afterwards was a new pid on the new commit.
      That was the in-app update button carrying the install from 2.11.0
      to 3.6.1, 176 commits in one step, in 56 seconds from the script
      starting to the banner.
      What is still unrun is the *scheduled task* branch on a real
      machine, which needs an elevated shell and is the next line.
- [ ] **The logon task branch has still run nowhere but a runner.** With
      the task registered, `windows_restart_argv` tests `if ($t)` first and
      takes it; every real machine this has been installed on lacked the
      elevation to register one, so only GitHub's administrators have run
      it. Registering it on the laptop also moves that machine off the
      Startup shortcut, which is the launcher the silent-exit watch needs,
      so the two cannot be done in the same sitting: the task branch wants
      a session that can give the machine an hour and a reboot.
- [ ] **The update footer's long-reason line is held by a Linux browser
      test and was not re-taken on Windows.** The wrapping that pushed Try
      again off the footer strip was found on the Windows laptop, fixed in
      `frontend/src/panes/UpdateFooter.tsx`, and confirmed there off the DOM
      rather than off the screen: the laptop's session could not repoint its
      checkout at the fixed commit, and was told to leave that refusal alone
      rather than work around it. The browser test asserts the row's height;
      a screenshot from a Windows machine at 125 percent is what would close
      this. That machine is already at 125 percent, so the screenshot needs
      nothing but a moment with the footer in its long-reason state, and
      the way to get one is to point the install's remote at a URL that
      fails with a long multi-line error. A note here said on 22 September
      that the screenshot had become impossible because the install had
      reached the tip of master and there was no update to report on. That
      was wrong, and it is corrected rather than deleted because it is the
      kind of wrong that wastes the next attempt: `UpdateFooter.tsx:442`
      gates that line on `!report.checked`, the check itself failing, and
      whether the install is behind has nothing to do with it.

      **Taken on 23 September, and Try again is inside the sheet**, at 125
      percent on that machine, with the remote pointed at an unresolvable
      host and put back afterwards. So the line this item was opened for
      is answered. Two things the screenshot showed that are not: the
      reason is clipped with an ellipsis rather than wrapped, which is
      what `truncate` is there for and is the trade that keeps Try again
      on the row, but on that failure the clipped half was the useful half
      ("Could not resolve host"), so whether the sheet should give a
      failed check more room is a question for the direction page rather
      than a defect; and the header control relabels itself from "An
      update is waiting" to "Check for updates" when a check fails, which
      tells a writer that nothing is pending when something is, and takes
      two clicks to open the sheet. Those two are the next interface
      run's, drawn before they are built.
- [ ] **`openai-card.spec.ts` "Allow always survives a reload as a
      settled card" failed and passed on retry in four of the frame run's
      nine full checks.** The failing read was `toBeVisible` on "Done."
      after the card's Always is pressed, within 20 s, on a run with two
      workers beside a LaTeX build; the case passed alone every time it
      was run alone. The likely shape is the scripted OpenAI stand-in
      finishing its turn before the card's answer lands, or the 500 ms
      shield on the card's buttons letting the click through a moment
      early under load, so the press is lost and the turn waits out its
      timeout. **The shield half of that is wrong**, and reading
      `Chat.tsx:1704-1756` says so: the buttons carry `disabled={!armed}`,
      `frontend/src/ui/Button.tsx` forwards it to a real button, and Playwright's
      actionability check waits for enabled, so a press cannot be dropped
      that way. The spec no longer sleeps 500 ms against a 350 ms shield;
      it waits for the button to be enabled and then asserts the card's
      folded `decided-always` row before it waits for the turn's last
      word, so the next failure says which of the three things it is: the
      press lost, the card expired server-side under load, or the
      scripted stand-in's turn not finishing. That is the only remaining
      suspect and it stays open until a failure names it.
      `previews.spec.ts` "renaming a previewed
      document moves its tab and its page together", `history-trash.spec.ts`
      "naming a version makes it findable later" and `writing.spec.ts`
      "typing lands on disk without being asked to" each flaked once in
      the same runs.
- [ ] **The printed token link is refused when a browser extension drives
      the navigation.** `_same_origin_request` (`server/main.py:720`)
      accepts `Sec-Fetch-Site` of `none` or `same-origin`, and an
      extension-initiated navigation is neither, so the link prints, works
      when a person types or bookmarks it, and answers 403 with "This
      request came from another page, so it was refused" when something
      automated opens it. That is the gate doing its job and no writer
      meets it. Recorded because the next session that tries to drive a
      browser at that link from outside the origin will otherwise lose an
      hour to it, as one did on 22 September; the way in is to set
      `location.href` from a page already on the origin.
- [ ] **The issue form's `where` field is an input rather than a dropdown**
      because GitHub does not prefill dropdowns from a URL. If that changes,
      a dropdown for the platform would make the field sortable.

- [x] **The documented Windows uninstall could kill the shell running it,
      and say nothing.** Its third line stops every process whose command
      line names the install, and a shell that was handed the block as
      text has that path in its own command line, so the line killed the
      uninstall in progress and the three lines after it never ran. The
      failure looks exactly like success: the server stops, NextTex
      disappears from the browser, and the install directory, the state
      directory and both shortcuts are all still there. Hit for real on
      23 September while running the documented sequence. `$PID` is
      excluded now, in the README and in the install lane's copy of it,
      and `docs/testing.md` records why that lane could never have caught
      it: it writes the block to a file and runs the file, so the text is
      in no command line, while a person or a tool using
      `powershell -Command` is the case that breaks.

      The same run found that the section says nothing about the
      `.nexttex` directory each project keeps, which survives the
      uninstall by design and was a third of a gigabyte on that machine.
      The README now says so, and says how to remove one.

- [x] **A TeX named on the command line is no longer discarded because
      the machine already has one.** `--tex=miktex` was accepted by the
      parser, forwarded through the bootstrap and then dropped by
      `Plan.set` without a word, because the TeX item is fixed when a TeX
      is found: the writer asked for MiKTeX, got TinyTeX, and was told
      nothing. Found on 23 September while trying to put a MiKTeX on the
      laptop through the documented route, which turned out to be
      impossible on any machine that already has a TeX. An item fixed
      because the machine *already has* the thing is overridable now; one
      fixed because the machine *cannot do* the thing, a desktop shortcut
      where there is no desktop, is not. The same run found that the
      installer locates TeX by its known install directory rather than by
      PATH, so taking TinyTeX off PATH hides it from nothing, which is
      worth knowing before anybody tries that again.

- [x] **`register-task.ps1` no longer starts a second server on top of a
      running one.** It started one unconditionally after writing the
      Startup shortcut, so re-running it raced the server already serving
      that install, lost the port, and left "Port 8450 is already in use"
      in `server.err.log`. Harmless in itself; not harmless in what it
      costs, because an empty `server.err.log` is half the signature of
      the Windows server that disappears overnight, and a line nobody
      asked for makes that file worth less every time. Seen on 23
      September when the script was re-run to record what it chooses on an
      unelevated account.

### Never run against the real thing

- [ ] **The drawer's Install button has not been pressed on a MiKTeX.**
      `nexttex/texpkg.py` runs `mpm --install=<stem>` when `tlmgr` is
      absent and `mpm` is present, with the missing file's stem as the
      package name, because MiKTeX names nearly every package after its
      main file and installs on the fly by default anyway; nothing here
      has a MiKTeX to check either claim against. The tlmgr path is run
      for real on this machine's TinyTeX and against the stand-in in the
      browser tier.
- [ ] **The OpenAI provider has never spoken to OpenAI itself.**
      Everything above the transport runs for real against a stub, and
      since the backlog close-out against a real local server too:
      `tests/test_openai_ollama.py` edits a file and draws a figure
      through the card against the Ollama on this machine, and the same
      was driven by hand in a real browser, which is where the first real
      turn showed that a stream with no declared charset was being read
      as ISO-8859-1. Whether OpenAI's own endpoint still returns these
      shapes is the half that stays unproven, since there is no account
      here to find out with; the local run says the parser, the tool
      loop, the card and the usage chunk all hold against a server that
      speaks the same protocol.
- [ ] **Stop has not been pressed against the real CLI since the buffer
      fix.** The one-behind reply after Stop was diagnosed in a writing
      session's transcript and is reproduced by a stub with the SDK's
      buffer in `tests/test_agent_robustness.py`; the real `interrupt`
      control request and the `result` the CLI sends for a stopped turn
      are exercised only by `tests/test_live_agent.py` under
      `NEXTTEX_LIVE`. `tests/fake_claude.py` speaks the sign-in commands
      and not the stream protocol, and teaching it the protocol is a
      day's work that would still be a stand-in.
- [ ] **Windows: no clean install on current master is on the record.** Four
      failures were found on a real Windows machine and fixed, the last in
      `e92a9d7`, but the verification run afterwards was never written down.
      The README says Windows is partly verified, which is honest; this is the
      check that would change that.

### Deliberately not done, and worth revisiting only if something changes

- [ ] **The project tree is walked twice per open.** `Project.tree` and
      `DependencyGraph._source_files` each descend the project with the
      same exclusions. Re-measured by the backlog close-out on the bench's
      thesis: the tree walk is 4.6 ms and the whole open 31 ms, so the
      plumbing to pass one walk into the other costs more than it buys.
      Revisit if the walk gets more expensive.
- [ ] **The Sections panel has no selection verbs.** Selecting the section in
      the editor already produces them, so a second entry point buys a shorter
      route to something reachable, at the cost of a hover control on every row
      of a panel that can hold forty.
- [ ] **Two documents whose stems match cannot both be on the strip.** The
      jobname is the stem, so `variants/acme/resume.tex` beside `resume.tex`
      would build to one `resume.pdf`, and `server/session.py` refuses the
      second with a 409 that the preview now shows as a notice when a
      chapter of the colliding document is opened. A jobname made from the
      relative path would end it and was not done: the writer keeps names
      unique across their folders, and `main.pdf` is what every Makefile
      pointed at a project expects to find. Revisit if somebody reports the
      notice rather than renaming.
- [ ] **Another window's removal of a preview closes no tabs here.**
      `previews_changed` from elsewhere moves the strip and nothing else,
      by design: the strip is shared and the tabs are each window's own.
      Wiring `handlers.onPreviewsChanged` would make the two windows'
      tabs move together and would also fire for this window's own
      removal; revisit if two-window writers report the asymmetry.
- [ ] **An unnumbered heading set at body size is not read as a heading by
      the inverse search.** A double-click on the page carries a hint that
      the span is a heading when it is set at least 15% larger than the
      page's running size or opens with a section number; a `\paragraph{}`
      heading in a class that sets it at body size and unnumbered gets the
      ordinary word search, which is no worse than before this run. Reading
      the font's weight off the text layer would catch it, and pdf.js does
      not put the weight on the span; left until somebody reports one.
- [ ] **A press of Escape within 100 ms of a keystroke closes the pending
      completion query rather than the extra carets.** CodeMirror's own
      rule, met while testing column selection. Nobody presses that fast;
      recorded so the next person to see the test's wait knows why it is
      there.
- [ ] **Building a session walks the project on the event loop.**
      `session_for` is synchronous, and constructing a `ProjectSession`
      calls `collab.adopt()`, which walks the whole tree. Measured at about
      17 ms of held loop on a 2602-file thesis, once per cold open. The
      obvious fix, building the session in a thread, was tried and reverted:
      a session builds its pycrdt documents, and the constraint recorded in
      `docs/architecture.md` is that those belong to the thread that built
      them, so the whole suite fails. Moving the walk alone means threading
      a pre-walked listing through `session_for` into `CollabStore.adopt`,
      which is a change to a function called from ninety-nine places in
      `server/main.py`, and it is not worth 17 ms once per cold open
      without somebody deciding it is. Re-affirmed by the backlog
      close-out, which had the widest brief and still left it.
- [ ] **A settled edit records its version from inside the flush.**
      `CollabStore._write` calls `session.record_version`, a sha256 and a
      zlib pass over the whole file, on the event loop, once per settled
      edit rather than once per burst. Measured by the backlog close-out,
      which found the row that was supposed to say (`collab.edit_to_disk_ms`)
      had been timing a no-op: on a 900-line chapter the write is 1.4 ms
      and the write with the record is 3.0 ms
      (`collab.edit_to_disk_with_history_ms`), so the record is about
      1.5 ms held on the loop once per settled edit, which is once per
      pause in typing. The ordered per-session queue it would take to
      move that off the loop is more machinery than 1.5 ms justifies.
      Worth doing if the number crosses about 5 ms on a chapter.

- [ ] **A script never runs on its own.** Not on save and not after the
      agent edits it; the pane says the agent changed it and offers Run
      again. The agent's runs pass the permission fence with the script as
      the card's text, and a rerun from the pane of code the agent just
      wrote would not, so an automatic rerun would be the fence's one
      hole. Left deliberately.
- [ ] **Captured figures are PNG only.** `plt.show()` is kept at 150 dpi;
      a figure saved through the seeded helper is a PDF in `figures/` and
      opens in the viewer, so the vector copy exists where it matters. An
      SVG capture would be a format choice in `script_runner.py`'s
      snapshot and a second file per shown figure; nobody has asked for
      the shown copy in vector form.
- [ ] **A file that appears outside NextTex begins its history with the
      state it arrived in, never with what was there before.** True of a
      document that was not open when the change landed, and of one the
      browser's socket opened in the moment between the write and the
      watcher's tick: the document is seeded from the file as it now is,
      so the earlier state was never anywhere NextTex could see. The
      earlier state could only come from a copy NextTex never took, and a
      file that already has a history keeps its earlier states there,
      where the version before this one is exactly that.
- [ ] **A document dropped by an outside move comes back as a followed
      one.** The watcher's re-scan drops a document whose file moved; the
      open tab's follow effect asks for it under the new name and marks it
      followed, so it can now leave with its last file where before the
      move it stayed. Telling "asked for" from "followed" for a document
      the strip lost and regained needs the origin the strip itself does
      not keep, and the `previews.json` format change section 34 declined
      is still the only place it could live; the followed set surviving a
      reload does not change that.
- [ ] **`PasswordNudge`'s persisted dismissal has no interface to undo
      it.** Deliberate and argued in that file's own header, with the
      action still reachable behind the cog.
- [ ] **The Emacs keymap is a vendored copy of `@replit/codemirror-emacs`
      6.1.0,** under `frontend/src/vendor/`, because the package's ESM
      build marks its own key and command registration as pure and a
      bundler drops it, so the keymap arrived with no keys; the CJS build
      brought a second copy of CodeMirror. Two annotations are removed in
      the copy and a licence header says so. Checked against the registry
      on 19 September 2026: 6.1.0 is still the newest release, so there is
      nothing to move back to. An upgrade means vendoring again by hand,
      and `keymaps.spec.ts`'s `C-k` against the real build is what says
      the keys arrived.
- [ ] **`password.spec.ts` "setting a password says so and closes itself"
      timed out once in four full runs**, and is understood well enough to
      be left alone. The close-out run worked the arithmetic rather than
      the timeout. The chain is a sequence of causes, not a race: the POST
      returns, `access-done` renders, `AccessCard.tsx:61-69`'s deliberate
      1800 ms timer fires `onClose`, `PasswordNudge.tsx:74-77` runs one
      `api.auth()`, and the lock goes. Every wait in the spec is on an
      observable and there is no window in which an event can be missed.
      The budget against that is generous: `playwright.config.ts` gives
      `expect` ten seconds, not the five this entry used to claim, the
      spec's own `toHaveCount(0)` gets six for 1800 ms plus a round trip,
      and the test has sixty against a worst case near twenty-six. Only a
      whole-machine stall fails it, which the one retry is there for.
      Widening a timeout here is the move `docs/testing.md` calls not
      worth it. If it recurs, open the trace before touching the numbers.

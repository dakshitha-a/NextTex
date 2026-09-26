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

Nothing is in hand. The fix run closed on 25 September 2026 at 3.19.0,
having fixed the probe's findings in the order its report proposed, one
push per step, 3.18.2 to 3.19.0. Its tracker page is
https://claude.ai/artifact/1PHFeRFMcKicS3PZFCqCzW. The findings were
`REVIEW.md`, 73 records with the four the Windows laptop sent after the
probe closed, and the file was deleted at the close once every record was
fixed or set down below: the cgroup half of Q-007, the kit's remaining
raw controls (Q-038), the laptop's task that only an administrator can
change (Q-070), and the major upgrades Q-036 weighed.

The probe itself closed on 25 September 2026 at 3.18.1. Its report page
is https://claude.ai/artifact/4mdUwu1mLwVYquc7Bm7vkS.

Before the probe: the pass after Opus 5.5 closed at 3.18.0 on 24 September 2026;
its tracker page is https://claude.ai/artifact/SqdkLWZHqSaMBS5nvKCRtF.
It left nothing new in the backlog. The run before it, the roadmap, the
rest of the backlog and comments, closed at 3.17.4; its tracker page is
https://claude.ai/artifact/7LzPbY8jvhfg3xSbAMqMwY. What that one left is
below: six rare browser flakes, named with the traces read, and the
OpenAI provider against OpenAI itself.

## Backlog

### Known gaps, with a cost somebody will eventually pay

- [ ] **The owner's Windows task has no restart until it is run again
      as administrator.** A new install's logon task repeats every five
      minutes, so a server that dies comes back (Q-070). The laptop's task
      was registered from an administrator shell and gives its owner read
      access only, so the script could not change it without
      administrator; it now says so, writes no shortcut beside it, and
      asks Windows for administrator itself where someone is at the
      desktop. What is left is on the laptop: run the installer, click
      Yes, end the server, and see it back within five minutes.

- [x] **Raw controls and literal sizes outside the kit.** 89 raw
      controls and 331 literal sizes in 52 files when the rule began to
      be enforced (Q-038). The backlog close-out moved them all, so the
      allowance file is gone and `frontend/src/kit-rule.test.ts` holds
      every component at none. Spacing went onto Tailwind's own scale,
      which is exact at a quarter rem a step; font sizes and radii outside
      the roles became size-only tokens named for their use; and the raw
      buttons, inputs and selects, which are rows, tabs and words styled
      by their place, became the kit's pass-through `Pressable`, `Input`
      and `Select`, as `TextArea` already was. The fidelity sweep of all
      174 surfaces, before and after: 100 identical to the pixel, and the
      other 74 differ only in what differs between any two runs, clock
      times, commit hashes, project names made from the clock, a build
      that had or had not finished, a hover card caught mid-appearance.

- [x] **Three dependencies are a major version behind.** `pdfjs-dist`
      is at 4.10 against 6.3, `vite` at 6 against 8 and `diff` at 7
      against 9 (Q-036). Each is a migration with its own risk: pdf.js
      carries the whole preview, the dark page's operator walk and
      SyncTeX's mapping, so it goes first and alone, with the preview's
      specs and a long thesis read through before and after. The four
      `npm audit` advisories, three in `nanoid` under the spelling
      loader and one in `diff`'s patch functions, are in code the app
      never calls.
      `diff` is at 9 since the backlog close-out, which also dropped
      `@types/diff`, since 8 ships its own types, and took its advisory
      with it. The three `nanoid` advisories stay: the spelling loader
      imports nanoid 2 as a function and calls it only when it is given
      no file name, which `hunspell-speller.ts` always gives, and nanoid
      3, the first fixed line, has no such export, so forcing it would
      break spelling to silence advisories nothing reaches.
      Vite is at 8 since 4.0.0, with its React plugin at 6; its Rolldown
      reports the spelling loader's namespace call under Rollup's code, so
      the one filter moved to `rolldownOptions` unchanged. The floor for
      building the interface rose to Node 22.13 with it, which is the x.
      pdf.js is at 6 since 4.0.1. It took `destroy` off the document, so a
      document is destroyed through its `loadingTask`, and a render names
      `canvas: null` to keep the preview's own opaque context. A 34-page
      document read through before and after, five pages in light and two
      on the dark page, drew identical pixels and identical text layers.
      What that read-through could not see, the full check did: pdf.js 6
      sizes text spans in its stylesheet from a `--font-height` it writes,
      and the app's copy of the rules was 4's, so spans ran a line tall
      and a double-click on a heading landed on the line below. The rules
      and the heading's size reading follow 6 now.

- [x] **A script that starts a session of its own outlives its stop.**
      A stopped or timed-out script was ended by killing its process
      group, and a script that forks and calls `setsid` left the group;
      the grandchild also held the run's pipes, so the stop waited on it.
      Closed by tracking descendants rather than by a cgroup: the runner
      is a child subreaper on Linux and a job object member on Windows,
      and `end_tree` walks and ends everything below it. macOS keeps the
      process group, having neither (Q-007, `tests/test_plots.py`).

The backlog close-out worked every line here that this host could work.
What stays needs a Windows machine, GitHub, or a report that names what
this host could not reproduce; each says which.

- [x] **Six browser tests fail about once in a full run and pass on
      the retry.** Each has been seen in the full tier with retries on,
      under four workers, during the run of 24 September 2026: the layout
      frame test (`layout.spec.ts`, "the window is a frame"), the hover
      card at 125 % (`hover-card-placement.spec.ts`), the section bar
      (`sections.spec.ts`, "a bar above the source"), the kit's 28 px
      controls (`kit.spec.ts`), a second caret by keyboard
      (`column-select.spec.ts`), and the rail's handle (`layout.spec.ts`,
      "the rail's handle resizes the rail"). None failed in 160 runs of
      the six together, twenty each on six workers with retries off, so
      what makes them fail is the whole suite's load or order rather than
      their own; the next step is a full tier with retries off, run until
      one fails, and its trace read. A seventh, the source strip's count
      of hidden tabs, did fail under load: the test read the count while
      the strip was still scrolling its newest tab into sight, which hid
      one more, and reads it once the menu is open now. Two others that
      looked the same were real defects and are fixed: a new file's
      first keystrokes lost, and a Markdown note rebuilding the paper.
      The probe of 25 September ran that full tier three times with
      retries off, under load: 1,725 runs, none failed, so there is no
      trace to read (Q-055). The fix run's full checks, with retries on,
      rescued the rail's handle once, and the dark page
      (`pdf-view.spec.ts`), the history panel's Markdown versions and the
      writing find and replace once each. The next step moves to CI, whose
      retry reports are kept: read which of these the retries rescue
      there before spending another local hour.
      Closed by the backlog close-out, by cause rather than by trace: the
      four the fix run's retries rescued each waited a fixed time or read
      a value still changing. The rail's handle slept 40 ms between moves
      and 100 ms after, and now waits two frames and polls the width; the
      dark page slept 1500 ms, and now polls until the figure is drawn;
      the Markdown history test guessed when builds were over, and now
      asks for the `history_changed` the keystroke caused and no build of
      the note; find typed its query and read a count from a keystroke
      before the last, and now fills it once. Three full tiers in a row
      with retries off then passed, 1,830 runs, none failed.
      The frame test failed once more in a later full check, the same
      race as the rail's handle: six drag moves in one burst to a handler
      that takes one a frame, and the width read once. It moves a step
      per two frames and polls now, and passed eight times in a row. The
      other four named above, the hover card, the section bar, the kit's
      controls and the second caret, have not failed in any run since.
- [x] **A logon-started server took five minutes to begin serving.**
      Measured again on 24 September 2026 after a restart, on 3.17.2 with
      the windowless task: logon at 20:12:55, the task's process at
      20:13:00, answering at 20:13:58, 63 seconds. The server's own line
      says where it went, "imports 15.1 s, the app 23.0 s", with about 16
      s more before its clock starts, the interpreter and the venv
      launcher: all of it Python loading its modules while the machine is
      still busy after boot, where a warm start takes about a second. That
      is the machine's load, not NextTex waiting on something, so it is
      recorded rather than fixed. The five minutes of 23 September were
      not seen again.

- [x] **A Windows server exits silently overnight.** Found on 24
      September 2026 on the owner's laptop, in an afternoon rather than a
      night. A sleep of an hour did not end the logon task's server, and
      neither did four standby periods earlier that day; closing the
      Windows Terminal window it lived in did, at once, and the handler
      wrote "Windows said: the console window was closed". Windows 11
      hands a console program to Windows Terminal, so the server lived in
      a window a person could close. Since 3.17.2 every Windows launcher
      runs `pythonw.exe` with `--log-to-state` and no console, so there is
      no window to close; a restart afterwards brought it up by itself in
      63 seconds. A server with no console is told nothing at shutdown, so
      the next start reads the System log for a restart or shutdown after
      the last heartbeat and names it, and "stopped without saying why"
      now means what it says.

- [x] **MiKTeX on a real machine.** The first MiKTeX build on the
      owner's laptop, 24 September 2026, found three faults, fixed in
      3.17.3: a MiKTeX dialog a build waited on, a timeout that could not
      end its build on Windows, and a latexmk with no Perl to run it. On
      3.17.3 a full build with a bibliography passed there in 32 s with
      no window and its citation resolved; a missing package failed in
      about a second with the Install offer.

### Never run against the real thing

- [x] **The restart helper's scheduled-task branch on a real machine.**
      Ran four times on the owner's laptop on 24 September 2026, from
      3.8.0 to 3.17.2: the helper waited for the old pid, waited for the
      task to leave Running, and started it, and the new server answered
      within seconds each time.

- [x] **The drawer's Install button on a real MiKTeX.** Pressed on the
      owner's laptop on 24 September 2026 on 3.17.4, after it was found
      to pick TinyTeX's `tlmgr` from PATH: `manager_here` named MiKTeX's
      `miktex.exe`, lipsum installed into MiKTeX in 8.1 s with no window,
      and the rebuild passed on MiKTeX's pdfTeX.
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
- [x] **Stop against the real CLI, since the buffer fix.** Pressed on 24
      September 2026 in a throwaway install of 3.16.0 under `~/work/tests`
      signed in through the machine's own `claude`, on Sonnet 5: Stop 5.5
      s into a streaming reply, nothing more arrived after it, and the
      next question, "reply with exactly PINEAPPLE", was answered with
      exactly that, not with the rest of the stopped reply. Two turns,
      $0.01. It showed one thing wrong, fixed the same day: the stopped
      reply ended mid-word with nothing to say so; a stopped turn now ends
      with "Stopped.".
- [x] **Windows: a clean install of current master is on the record.**
      Done on 23 September 2026 on the owner's laptop, by the documented
      `irm ... | iex` route, from an uninstall of the previous install
      through to a working one with MiKTeX fetched by the installer. The
      same sitting took the update button twice, the logon task and a
      reboot, and the desktop shortcut. The README's Windows section is
      rewritten around what actually ran, and `docs/testing.md` records
      which of the lane's blind spots have now been taken by hand and
      which have not.

### Deliberately not done, and worth revisiting only if something changes

- [x] **The agent does not read comments.** A thread was on the
      manifest, where the agent's tools did not look, so "answer the open
      comments in chapter 2" meant nothing to it. Built by the backlog
      close-out as 4.1.0, in the shape this entry named: `list_comments`
      and `reply_to_comment` in both providers, a reply written under the
      agent's own name and drawn in the pen's ink, resolving nothing.
- [x] **`password.spec.ts` "setting a password says so and closes itself"
      timed out once in four full runs**, and the entry here called it a
      whole-machine stall, to be left alone unless it recurred. It
      recurred on 26 September, and the trace said otherwise: the card
      answered "Those two do not match." after both boxes were filled
      alike. Leaving the name field saves the name; when the save came
      back, the card's state changed, and its focus effect, keyed on the
      state and written for the card opening, put the caret back in the
      first password box, so what was typed next into "Again" went into
      the box above. A writer typing quickly after their name could do the
      same. The effect runs once, when the settings arrive, and a spec
      with the name save slowed to 700 ms types across it.

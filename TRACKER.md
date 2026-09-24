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

**The roadmap, the rest of the backlog, and comments**, one run begun on
24 September 2026. Its tracker page is
https://claude.ai/artifact/7LzPbY8jvhfg3xSbAMqMwY and every interface
change in it is drawn first on the direction page. In order: the backlog
work that needs no drawing, then the Windows laptop, then Stop against the
real CLI, then the two backlog surfaces, then comments, a feature the
writer asked for while the run was planned, then the seven roadmap items,
one push each. The known gaps below are the run's to close or re-file;
the items deliberately not done are being re-judged, the cheap ones
built and the rest moved into `docs/design.md` as decisions.

Found on the way: the caret readout flake was a writer's first words in a
new file being deleted by the watcher's late report of the file's
creation, fixed in `CollabStore.body` with
`tests/collab/test_a_new_file_keeps_its_first_keystrokes.py`.

## Backlog

### Known gaps, with a cost somebody will eventually pay

The backlog close-out worked every line here that this host could work.
What stays needs a Windows machine, GitHub, or a report that names what
this host could not reproduce; each says which.

- [ ] **A logon-started server took five minutes to begin serving, where
      the same build started from the desktop shortcut took under
      twenty-five seconds.** Measured on the laptop on 23 September, eight
      minutes apart: the task's process was created 62 seconds after boot,
      wrote its banner three and a quarter minutes later, and was
      answering on the port at about five minutes; the shortcut's was
      serving in 25. A cold disk after boot, an antivirus reading a 400 MB
      virtual environment and a freshly installed MiKTeX are all plausible
      and none is measured. It matters twice over: a writer who reboots
      and looks will think NextTex did not come up, and anybody watching
      that machine for the overnight disappearance can mistake a slow
      start for a failure to start, which one session nearly did.

### Never run against the real thing

- [ ] **The restart helper's scheduled-task branch has not run on a real
      machine.** The Startup-shortcut branch has, three times on the
      owner's laptop, and the logon task itself was registered and started
      a server there after a reboot on 23 September. What has not run is
      `windows_restart_argv` taking `Start-ScheduledTask` rather than the
      shortcut, which needs an update pressed while the task is the armed
      launcher. That laptop is on the task now, so the next update pressed
      there runs it.

- [ ] **The drawer's Install button has still not been pressed on a
      MiKTeX, and now for a better reason.**
      `nexttex/texpkg.py` runs `mpm --install=<stem>` when `tlmgr` is
      absent and `mpm` is present, with the missing file's stem as the
      package name, because MiKTeX names nearly every package after its
      main file and installs on the fly by default anyway; nothing here
      has a MiKTeX to check either claim against. The tlmgr path is run
      for real on this machine's TinyTeX and against the stand-in in the
      browser tier. A real MiKTeX finally existed on 23 September 2026, on
      the laptop, installed by NextTex's own installer. The button was
      still not pressed, deliberately: that machine had MiKTeX's engine
      running against TinyTeX's package tree, so a package `mpm` installed
      might land somewhere the running engine never looks, and neither a
      pass nor a failure would have meant anything. What this needs is a
      machine with one TeX on it, or the item above about the installer
      recording its choice.
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

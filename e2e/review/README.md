# The review drivers

These are not checks. `scripts/check.sh` never runs them: the browser tier's
config has `testDir: "./specs"` and these live next door. They are the scripts
the September 2026 review used to reach the states it recorded, kept because a
finding without a way back to it is an assertion, and because the fix run that
followed watched each of them go from describing the bug to describing the
fix. The review's own file is gone; its findings are the commits named below,
and `git log` carries what each one found and did.

Each one drives the real app in a real browser, photographs it, and prints
what it saw for a person to read. Several of them pass while describing a bug,
because what they assert is "this is what happens", not "this is right".

Run them with the review config, from `e2e`:

```
node_modules/.bin/playwright test -c review/review.config.ts review/a3-undo.spec.ts
```

| spec | what it reached during the review | the commit that changed it, and what it reaches now |
|---|---|---|
| `a3-undo.spec.ts` | Ctrl+Z on a file nobody has typed in emptied it, on disk (a blocker) | `14d0b16`. Now prints `ON DISK BEFORE` and `ON DISK AFTER` equal, and twelve undos past your own typing stop at the file as it was |
| `a-axe-sweep.spec.ts` | every surface `specs/a11y.spec.ts` did not visit, in both themes, with `nested-interactive` on three of them | `9faeff2`. `specs/a11y.spec.ts` opens each surface now; the sweep is the wider net |
| `a1-open.spec.ts` | the preview called the document empty, and the strip said Ready, for the whole of a project's first build | `2ccc021`. Now prints `strip=built` with the typeset page in the pane from the first sample |
| `a1-which2.spec.ts` | two recoverable errors in two files, where alphabetical and document order disagreed | `2bb228c`. The one to start from is the first in document order |
| `a1-gone.spec.ts` | the tab reloaded itself into a browser error page when the server went away mid-build | `931d164`. Now prints the boundary's own "NextTex is not answering" with a Reload control, and the editor still mounted |
| `a1-offline.spec.ts` | a build that finished while the tab could not hear it left the strip compiling for ever | `2ccc021`. Now prints `BACK 8s: built` |
| `a1-errors.spec.ts` | the error pane and the drawer, and whether fixing an error cleared them | the background to `2ccc021` and `2bb228c` |
| `a12-typing.spec.ts` | keystroke to the character on screen, in a 71 kB chapter of a thesis | no finding, and the number the fix run had to not make worse. Review: median 3.9 ms, p90 4.7, worst 13.1. After the run, with the escaped-dollar handler, the Enter guard and the Ctrl-click handler on the keystroke path: median 3.7 ms, p90 5.0, worst 11.4, on the same machine. Needs `NEXTTEX_THESIS` pointing at a project `bench.build_project` made |

`a7-live.spec.ts` and `a7-live2.spec.ts` are different and are kept apart by
`live.config.ts`. They point at a long-lived server on port 8462 that is
signed in to a real Claude account, and they spend real money on every run.
They start nothing, so with no such server they simply fail to connect.
Nothing in them presses the sign-out control, which would log the machine's
own `claude` out.

## The probe of 25 September 2026

The second whole-app review, whose findings are `REVIEW.md` at the root of
the repository, numbered `Q-001` onward. Each driver below reached the
record it is named for, and prints what it reaches, so the fix plan can
watch it turn. The Python ones start a sandboxed server through
`probe_sandbox.py` and stop it by the process they started; run them from
the repository root with `.venv/bin/python`. The Playwright ones run with
`review.config.ts`, as above. `NEXTTEX_THESIS` is a project
`bench.build_project` made.

| driver | record | what it prints at the time of the probe |
|---|---|---|
| `q028_search_freeze.py` | Q-028 | the server not answering while one regular-expression search runs |
| `q043_build_loop_block.py` | Q-043 | the server's longest silence during a full build of the thesis, 17.6 s |
| `q017-scoped-diagnostics.spec.ts` | Q-017 | a chapter's error gone after typing in another chapter |
| `q-journey.spec.ts` | Q-064 to Q-067 | a week of a paper, timed, with the preview's PDF on disk, the route and the last build at each step |
| `q066-failed-build-preview.spec.ts`, `q066_failed_build_preview.py` | Q-066 | the cleaner attempts, which keep the PDF because their errors are not fatal |
| `q067-search-focus.spec.ts` | Q-067 | where typing lands just after the chord for find across files |
| `q068-ref-completion-brace.spec.ts` | Q-068 | the brace left open after a label is accepted |
| `q009_same_path.py` | Q-009 | two peers' `chapters/03.tex` merged into one |
| `q008_comment_shape.py` | Q-008 | the Comments listing raising on a peer's thread |
| `q054_comment_outside_edit.py` | Q-054 | a comment left on two letters after an outside edit |
| `q023_git_and_projects.py` | Q-023, Q-024, Q-026 | conflict markers committed, a detached head, an archived project revived |
| `q030-altgr.spec.ts` | Q-030 | AltGr letters taken as chords |
| `q031-pdf-memory.spec.ts` | Q-031 | the canvas held after reading a 600-page thesis, 590 MB |
| `q033-typing-spelling.spec.ts` | Q-033 | keystroke latency with spelling confirmed on |
| `q050-axe-drawers.spec.ts` | Q-050 | axe over all twelve drawers, both themes |
| `q-model-menu-125.spec.ts` | Q-062 | the first open of the composer's menu, 870 ms |
| `q-collab-keystroke.py` | none | a keystroke reaching a second loopback peer, 1.4 ms |

`a-axe-sweep.spec.ts` above skips five of its eight surfaces since the
visual overhaul renamed what it clicks, and passes anyway; that is part of
Q-056, and `q050-axe-drawers.spec.ts` is what replaced it for the probe.

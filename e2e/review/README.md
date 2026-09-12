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
| `a3-undo.spec.ts` | Ctrl+Z on a file nobody has typed in emptied it, on disk (a blocker) | `03a448b`. Now prints `ON DISK BEFORE` and `ON DISK AFTER` equal, and twelve undos past your own typing stop at the file as it was |
| `a-axe-sweep.spec.ts` | every surface `specs/a11y.spec.ts` did not visit, in both themes, with `nested-interactive` on three of them | `d9b3756`. `specs/a11y.spec.ts` opens each surface now; the sweep is the wider net |
| `a1-open.spec.ts` | the preview called the document empty, and the strip said Ready, for the whole of a project's first build | `ae966d9`. Now prints `strip=built` with the typeset page in the pane from the first sample |
| `a1-which2.spec.ts` | two recoverable errors in two files, where alphabetical and document order disagreed | `4d401a4`. The one to start from is the first in document order |
| `a1-gone.spec.ts` | the tab reloaded itself into a browser error page when the server went away mid-build | `47751db`. Now prints the boundary's own "NextTex is not answering" with a Reload control, and the editor still mounted |
| `a1-offline.spec.ts` | a build that finished while the tab could not hear it left the strip compiling for ever | `ae966d9`. Now prints `BACK 8s: built` |
| `a1-errors.spec.ts` | the error pane and the drawer, and whether fixing an error cleared them | the background to `ae966d9` and `4d401a4` |
| `a12-typing.spec.ts` | keystroke to the character on screen, in a 71 kB chapter of a thesis | no finding, and the number the fix run had to not make worse. Review: median 3.9 ms, p90 4.7, worst 13.1. After the run, with the escaped-dollar handler, the Enter guard and the Ctrl-click handler on the keystroke path: median 3.7 ms, p90 5.0, worst 11.4, on the same machine. Needs `NEXTTEX_THESIS` pointing at a project `bench.build_project` made |

`a7-live.spec.ts` and `a7-live2.spec.ts` are different and are kept apart by
`live.config.ts`. They point at a long-lived server on port 8462 that is
signed in to a real Claude account, and they spend real money on every run.
They start nothing, so with no such server they simply fail to connect.
Nothing in them presses the sign-out control, which would log the machine's
own `claude` out.

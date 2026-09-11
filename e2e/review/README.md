# The review drivers

These are not checks. `scripts/check.sh` never runs them: the browser tier's
config has `testDir: "./specs"` and these live next door. They are the scripts
the September review used to reach the states it recorded in `REVIEW.md`, kept
because a finding without a way back to it is an assertion, and because the
fix plan needs to watch each of them go from failing to passing.

Each one drives the real app in a real browser, photographs it, and prints
what it saw for a person to read. Several of them pass while describing a bug,
because what they assert is "this is what happens", not "this is right".

Run them with the review config, from `e2e`:

```
node_modules/.bin/playwright test -c review/review.config.ts review/a3-undo.spec.ts
```

| spec | what it reaches | finding |
|---|---|---|
| `a3-undo.spec.ts` | Ctrl+Z on a file nobody has typed in empties it, on disk | R-029, a blocker |
| `a-axe-sweep.spec.ts` | every surface `specs/a11y.spec.ts` does not visit, in both themes | R-028 |
| `a1-open.spec.ts` | the preview calls the document empty, and the strip says Ready, for the whole of a project's first build | R-044, R-045 |
| `a1-which2.spec.ts` | two recoverable errors in two files, where alphabetical and document order disagree | R-004, R-009 |
| `a1-gone.spec.ts` | the tab reloads itself into a browser error page when the server goes away mid-build | R-040 |
| `a1-offline.spec.ts` | a build that finishes while the tab cannot hear it, without killing the server | R-001 |
| `a1-errors.spec.ts` | the error pane and the drawer, and whether fixing an error clears them | the background to R-002 and R-008 |
| `a12-typing.spec.ts` | keystroke to the character on screen, in a 71 kB chapter of a thesis | no finding: it is the number the fix plan has to not make worse |

`a7-live.spec.ts` and `a7-live2.spec.ts` are different and are kept apart by
`live.config.ts`. They point at a long-lived server on port 8462 that is
signed in to a real Claude account, and they spend real money on every run.
They start nothing, so with no such server they simply fail to connect.
Nothing in them presses the sign-out control, which would log the machine's
own `claude` out.

---
name: fix-issue
description: Fix one NextTex GitHub issue end to end, from reading the report to a green push on master and a closing comment. Use only when the owner asks for /fix-issue N.
argument-hint: [issue-number]
disable-model-invocation: true
---

Issue #$ARGUMENTS, as it stands:

!`gh issue view $ARGUMENTS --comments 2>&1 || true`

Follow `docs/bug-reports.md`; this is the short form. `CLAUDE.md` holds the
standing rules and applies throughout.

1. **Read the report before the prose.** Check the code commit against the
   interface commit (a mismatch is the unrestarted-install case, not a new
   bug), check whether the reported commit already has the fix on `master`,
   and note the platform and launcher. Then read what the reporter wrote
   against what the report shows. Remove the `triage` label:
   `gh issue edit $ARGUMENTS --remove-label triage`.

2. **Decide.** If something is missing, ask for it by name in one comment and
   add `needs-info`; stop there. If it is a duplicate, link the earlier issue
   with its state and close. If it cannot be made to happen, say what was
   tried and where, and add `cannot-reproduce`. Otherwise continue.

3. **Reproduce it as a failing test first**, in the tier that can see it:
   `tests/` for a module, `tests/api/` for a route (with the path-escape
   assertion), `frontend/src/*.test.ts` for interface logic, `e2e/specs/`
   for what only a browser shows, `tests/test_install_*.py` for the
   installer. When the report quotes a 500, the eight-hex reference is in
   the log line it quotes, and that line names the route and the exception.
   Add `confirmed` once the test fails for the right reason.

4. **Fix the cause.** Anything else wrong in the same file is fixed too, in
   its own commit.

5. **Check.** `scripts/check.sh` always; `scripts/check.sh --all` (with
   `NEXTTEX_NODE_BIN` exported) whenever `frontend/` or a route the browser
   exercises changed. Never `NEXTTEX_LIVE=1`, never `e2e/review/` or
   `e2e/shots/`, Python 3.10 syntax only.

6. **Documents in the same commit**: `docs/architecture.md`,
   `docs/design.md`, `README.md`, `TRACKER.md`, whichever the change made
   wrong.

7. **Commit on master** with a full-sentence present-tense subject and a
   prose body ending in `Fixes #$ARGUMENTS`. Push `master`.

8. **Wait for green**: `gh run list --limit 5` until `python`,
   `interface checks` and `interface` have all passed for the pushed commit.
   Then confirm the bundle exists before saying anything to the reporter,
   because the app fetches its interface by commit and an early "update now"
   sends them into a 404:
   `gh release view interface --json assets --jq '.assets[].name' | grep <sha>`.
   If `scripts/` or `nexttex/install/` changed, also
   `gh workflow run install.yml -f os=<ubuntu|macos|windows> -f tex=none`
   and `gh run watch` it.

9. **Close the loop.** `gh issue edit $ARGUMENTS --add-label fixed-in-master`,
   then comment:

   > Fixed in `<sha>`. <One sentence on the cause.> Update from the projects
   > screen's footer, or run `scripts/update.sh` (`scripts\update.ps1` on
   > Windows), and restart if the footer says to.

   GitHub closes the issue from `Fixes #N`; check that it did.

If more than one issue is being taken in this session, publish a tracker
Artifact before the first commit and republish it after every push.

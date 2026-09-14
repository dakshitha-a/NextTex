# Working on NextTex

Standing instructions for any agent session in this repository. They are
stated as absolutes because they are; the reasons are short and follow each
one. `docs/architecture.md` says how the code works, `docs/testing.md` how it
is tested, `docs/bug-reports.md` how an issue becomes a fix. This file does
not reach NextTex's own writing agent: `nexttex/agent.py` reads settings from
the writer's project, never from this checkout.

## Writing

**Never use an em dash.** Not between clauses, not as a parenthetical pair,
not to introduce a list, not anywhere: code comments, commit messages,
documents, YAML, issue comments, what you say to the user. Use a comma, a
colon, a semicolon, or two sentences. Do not substitute a spaced en dash.

**One paragraph per line is a rule for prose written into a writer's
project**, where the editor wraps on screen and a hard wrap makes every edit
reflow the paragraph. It is not a rule for this repository's own markdown,
which is hard wrapped at about eighty columns. Match the wrapping of the file
you are editing; reflowing a document is exactly the diff that rule exists to
prevent.

## One branch

Work happens on `master`. Commit there, push there, and then run
`gh run list --limit 5` and wait for `python`, `interface checks` and
`interface` to be green before the work is called done. A red workflow you
did not cause is still yours to mention and, while you are there, to fix.
Never hand back a feature branch or a pull request; a branch is at most a
scratch space on the way to `master` and is deleted afterwards.

## Documents move with the code

A change owes the documents it made wrong, in the same commit:
`docs/architecture.md` for the mechanics, `docs/design.md` for the interface,
`README.md` for anything a reader would act on, `TRACKER.md` for the item it
finishes and whatever it turned up and left. `tests/test_documents_match_the_code.py`
asserts that every path, `/api/` route and `NEXTTEX_*` name the documents
use exists, so a document may name a thing only once that thing is there.

## Commits

The subject is a full sentence in the present tense saying what is now true,
with no prefix and no trailing full stop. The body is prose: what was
observed, what the cause was, what changes, and the test that shows it. A fix
for an issue ends its body with `Fixes #N`. A tangent fix, which is welcome,
gets its own commit so it stays legible in the log.

## Checks

`scripts/check.sh` runs `tsc`, `vitest` and `pytest`, always.
`scripts/check.sh --all` adds the build, the bundle budget and the Playwright
tier, and is required whenever `frontend/` or a route the browser exercises
changed; export `NEXTTEX_NODE_BIN` to a Node 20 or newer first if the system
Node is older. CI pins Python 3.10, so nothing newer than 3.10 goes in.

Three things keep the suite from reaching a real account, and none of them
may be undone: the `NEXTTEX_CLAUDE_BINARY` line in `tests/conftest.py`,
which points every test at `tests/fake_claude.py`; `NEXTTEX_LIVE`, which is
never set; and `e2e/review/` and `e2e/shots/`, which are never run by a
check. Every route that takes a path gets a path-escape test in `tests/api/`.

## Tangents and trackers

Fix what you notice while you are in a file, with a test and a document
note, in its own commit; performance improvements are in scope wherever there
is room. A run that spans several issues or several commits publishes a
tracker Artifact before its first commit and republishes it after every push,
because sessions get interrupted and a current tracker is what makes the next
one cheap.

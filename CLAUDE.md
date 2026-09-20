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
`interface`, and `release` when the push carried a tag, to be green before
the work is called done. A red workflow you did not cause is still yours to
mention and, while you are there, to fix. Never hand back a feature branch
or a pull request; a branch is at most a scratch space on the way to
`master` and is deleted afterwards.

## Versions

NextTex has a version, `x.y.z`, on the `VERSION` line of
`nexttex/version.py`, and the session that pushes is the one that advances
it. The number names the program, so a push that touches only what
`nexttex/updates.py` lists as not the program (`docs/`, `README.md`,
`LICENSE`, `tests/`, `e2e/`, `bench/`, `examples/`, `CLAUDE.md`,
`.claude/`, `TRACKER.md`, `ROADMAP.md`, `.gitignore`, `.gitattributes`)
leaves it alone; the update footer is already quiet about those commits
and the number agrees with it.

- **z** when the program changed and a writer would notice nothing new: a
  bug fix, a performance improvement, a refactor, a dependency bump, a
  change to the installer, the update scripts or the workflows.
- **y** when a writer can newly see or do something: a feature, a changed
  behaviour, a new setting, route, shortcut or panel; anything that earns a
  line in `README.md` or a section in `docs/design.md`. Resets z.
- **x** when what an install *is* changes: the installer must be run again;
  a file under `.nexttex/`, the history store or the collaboration wire
  changes shape so an older NextTex cannot read what a newer one wrote; a
  feature is removed; the Python or Node floor rises. Resets y and z.

One bump per push, at the highest level anything in that push earned, and
it is its own commit, the last one before the push, with the subject
`NextTex is 1.2.0` and a body naming which change earned the level and why
it is that level rather than the one below. The same commit is tagged,
`git tag -a v1.2.0 -m "NextTex 1.2.0"`, and the two go up together with
`git push origin master v1.2.0`. The `release` workflow then checks that
the tag and the file agree, refuses if they do not, and publishes the
commit subjects since the previous tag as the release notes. A push that
earned no bump gets no tag; a session that pushes several times bumps at
each push that earned one; a docs-only push after a feature push needs
nothing. Never change the number inside a commit that does something else,
and never move or re-make a tag: a wrong number is corrected by the next
one.

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
Node is older. Facts about the machine, such as where that Node lives, go
in `CLAUDE.local.md`, which Claude Code reads beside this file and git
ignores; this file holds only what is true of the project. CI pins Python
3.10, so nothing newer than 3.10 goes in.

Three things keep the suite from reaching a real account, and none of them
may be undone: the `NEXTTEX_CLAUDE_BINARY` line in `tests/conftest.py`,
which points every test at `tests/fake_claude.py`; `NEXTTEX_LIVE`, which is
never set; and `e2e/review/` and `e2e/shots/`, which are never run by a
check. Every route that takes a path gets a path-escape test in `tests/api/`.

## Interface

Interface work follows `docs/style-guide.md`: the tokens, the type roles,
the kit in `frontend/src/ui/` as the only source of controls, the
interaction and copy rules, and the contract every change ships with (a
Playwright spec, the sweeps, a render in both themes). A change that needs
something the guide does not have adds it to the guide in the same commit;
a literal colour, size or raw control in a component is a defect. The guide
is what keeps the look the visual overhaul gave the app from drifting pane
by pane, which is how the inconsistency it replaced arose.

## Subagents

The session runs on Opus with the advisor on Fable, and a subagent
inherits the session model unless something lowers it. The lowering is
explicit and deliberate, so a forgotten rule overspends and never
underplans. Never set `CLAUDE_CODE_SUBAGENT_MODEL`; it flips that default
the other way.

- `Explore` is defined in `.claude/agents/Explore.md` and runs on Sonnet.
  The definition replaces the built-in, so its body is the agent's whole
  prompt; edit it there.
- A general-purpose agent that only reads, researches or verifies is
  launched with `model: sonnet`.
- An agent that edits the repository, a `Plan` agent and a fork stay on
  the session model.
- `claude-code-guide` is launched with `model: haiku`.
- The advisor stays on Fable; it must be at least as capable as the
  session model.

## Tangents and trackers

Fix what you notice while you are in a file, with a test and a document
note, in its own commit; performance improvements are in scope wherever there
is room. A run that spans several issues or several commits publishes a
tracker Artifact before its first commit and republishes it after every push,
because sessions get interrupted and a current tracker is what makes the next
one cheap.

## A task given while a plan is running is an amendment to the plan

Work here usually starts in plan mode, and the user usually gives new tasks
while the plan is being executed. Those are the tasks that get dropped, so
they are not side tasks. When a message asking for work arrives mid-plan:
finish the tool call in flight, call `EnterPlanMode`, add the request to the
plan file as its own item with an acceptance criterion and a note that the
user raised it mid-run, re-validate the plan's order and dependencies
against what is already done, `ExitPlanMode` for approval, then resume the
item you were on. A message that only asks a question is answered inline
and the plan continues; if the answer exposes a defect, the defect is an
amendment.

The plan file is the ledger. Every item carries a state, and a plan is
reported finished only after its items have been checked against the git
log, with nothing left unmarked. `.claude/hooks/plan_amendment.py` enforces
the timing: `ExitPlanMode` writes a per-session marker under
`.claude/plan-in-progress/`, every later message the user sends arrives
with a reminder of the rule while the marker exists, a new session is told
about any plan an earlier one left running, and
`python3 .claude/hooks/plan_amendment.py done <session id>` removes the
marker when the plan is complete. Plans are written to `.claude/plans/` in
this checkout rather than the home directory, so the ledger sits beside the
code it describes. Both directories are gitignored.

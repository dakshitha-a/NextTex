"""Where the permission control can be, and what each position means.

Its own module rather than a constant in `agent.py`, for the same reason
`writing.py` is its own module: importing `agent.py` pulls in the Claude
SDK, which is six hundred milliseconds of pydantic model building, and an
install that chose OpenAI or no agent at all must never load it.  The
scripted stand-in, the routes and the tests all need these names and none
of them needs the SDK.
"""

from __future__ import annotations

#: The three positions, quietest last.
#:
#: `ask` is a card for every shell call, every network call and every write
#: that leaves the writing.  It is the only complete fence.
#:
#: `project` is the one most people will use.  The work runs silently, and
#: that now includes the piped, chained and redirected commands it used to
#: card, which is where the hundreds of successive cards came from.  What
#: still asks is what the fence can see leaving the writing or leaving the
#: machine: a write outside the project, a write to a file the build
#: executes, a read from outside the project, and a call that reaches the
#: network.
#:
#: `all` asks about nothing at all, including a write that leaves the
#: project.  It is reachable only through a confirmation that says what
#: stops being checked, because the reason it is dangerous is not about the
#: writer's own judgement: the model's instructions come partly from the
#: project's files, and those arrive from templates, clones and co-authors.
#:
#: Both quiet positions record every action, and at the last one that record
#: is the only account of what was done, so it matters more there than
#: anywhere else.
MODES = ("ask", "project", "all")

#: What a project gets before anybody chooses.  Asking is the default
#: because a fence that is down and says nothing is worse than no fence.
DEFAULT_MODE = "ask"

#: How each position reads in an interface, in sentence case.
MODE_LABELS = {
    "ask": "Ask before acting",
    "project": "Run the work without asking",
    "all": "Never ask about anything",
}

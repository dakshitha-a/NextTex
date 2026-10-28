"""What a conversation is called, when the writer has not named it.

One function, shared by the transcript, which titles the past
conversations, and the Claude agent, which names its session to the CLI
and to claude.ai, so the list and the remote session agree on a name.
"""

from __future__ import annotations

#: How long a name made from a question may be. Long enough to tell
#: "Why does biber fail on the thesis" from the next question, short
#: enough for one row of the past conversations at the column's width.
TITLE_CHARS = 60

#: The longest name a writer may give, the Session view's limit.
NAME_CHARS = 80

#: What the next question is prefixed with when the memory of the
#: conversation it continues is gone, so the model reads the record first.
FROM_RECORD = (
    "This conversation continues an earlier one whose memory was not kept. "
    "The record of it is in {path}: read it before you answer, and treat it "
    "as what was said and done so far."
)

#: What the column says when a past conversation becomes the live one.
CONTINUED_NOTICE = "Continued. Claude remembers this conversation."
AGENT_CONTINUED_NOTICE = "Continued. The agent remembers this conversation."
CLAUDE_GONE_NOTICE = "Claude Code no longer had this session, so a fresh one reads the record first."
KEPT_NOTHING_NOTICE = "This conversation's memory was not kept, so the agent reads the record first."


def clean_name(text: str) -> str:
    """A name as typed, on one line, at most `NAME_CHARS` long."""
    return " ".join(str(text).split())[:NAME_CHARS]


def title_from(question: str) -> str:
    """The first line of a question, cut at a word near `TITLE_CHARS`.

    A cut mid-word reads as a typo, so the cut goes back to the last space
    when there is one in the second half; a question with no space that
    late is cut where it reaches the limit.
    """
    first = next((line for line in str(question).splitlines() if line.strip()), "")
    line = " ".join(first.split())
    if len(line) <= TITLE_CHARS:
        return line
    cut = line[:TITLE_CHARS]
    space = cut.rfind(" ")
    if space > TITLE_CHARS // 2:
        cut = cut[:space]
    return cut.rstrip(" ,;:.") + "…"

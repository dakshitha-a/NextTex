"""What the agent reads when it asks for a file's comments, and hears back
when it answers one.

Both providers hand these words to their model, so a thread reads the same
to Claude and to ChatGPT, the way the permission cards are one text in
`nexttex/permission_gate.py`. The threads themselves come from the
session's `agent_comments`, which reads the collaboration store's
`Comments`, and a reply goes through its `agent_reply`, which writes it
under the agent's own name.
"""

from __future__ import annotations

#: The two tools, as each provider names them to its model.
LIST_DESCRIPTION = (
    "Read the open comment threads on a file, or on the whole project when "
    "`path` is left out: each thread's id, its line, the words it was left "
    "on, and every message in it with who wrote it. Collaborators leave "
    "these beside the text. Changes nothing."
)
REPLY_DESCRIPTION = (
    "Answer one comment thread, by the id `list_comments` gave. The reply "
    "is a message in the thread under your name, which every collaborator "
    "sees. It resolves nothing and edits nothing: to change the text, edit "
    "the file as usual, and leave closing the thread to a person."
)


def listing(threads: list[dict], path: str) -> str:
    """The open threads, one block each, in the order the drawer lists them."""
    where = f"on {path}" if path else "in this project"
    if not threads:
        return f"No open comments {where}."
    count = len(threads)
    blocks = [f"{count} open thread{'s' if count != 1 else ''} {where}."]
    for thread in threads:
        head = f'{thread["id"]}, line {thread.get("line") or 1}, on "{thread.get("quote") or ""}"'
        if not path:
            head = f'{thread.get("path") or "?"}: {head}'
        if thread.get("detached"):
            head += ", though its text has since been deleted"
        lines = [head]
        for message in thread.get("messages") or []:
            who = message.get("name") or "Someone"
            if message.get("agent"):
                who = f"You ({who})"
            lines.append(f"  {who}: {message.get('body') or ''}")
        if thread.get("suggestion"):
            lines.append(f'  Suggests instead: "{thread["suggestion"]}"')
        blocks.append("\n".join(lines))
    blocks.append("Answer one with reply_to_comment and its id.")
    return "\n\n".join(blocks)


def replied(quote: str) -> str:
    return f'Replied to the comment on "{quote}".' if quote else "Replied to the comment."


NOT_CONNECTED = "Comments are not connected in this session."
NOTHING_TO_SAY = "What should the reply say? It was empty."
WHICH_THREAD = "Which thread? Give the id list_comments showed."

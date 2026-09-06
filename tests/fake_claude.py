#!/usr/bin/env python3
"""A stand-in for the `claude` CLI, so a sign-in can be tested for real.

The sign-in screen is the first thing a new user sees and the hardest part
of the app to test: it drives a real interactive program under a real
pseudo-terminal, and the bug that shipped -- the screen waiting for an
`exit` event that nothing ever published -- lived precisely in the seam
between what that program does and what the browser waits for.  Mocking the
seam would have tested nothing.

So this is a real program, run under the real pseudo-terminal, through the
real pump.  It prints a verification URL without a trailing newline the way
the CLI does, waits for a code on stdin, and reports itself signed in
afterwards.  Only its answers are known.  Point NEXTTEX_CLAUDE_BINARY at
it; NEXTTEX_FAKE_CLAUDE_STATE names the file that remembers the sign-in.
"""

import json
import os
import sys

STATE = os.environ.get("NEXTTEX_FAKE_CLAUDE_STATE", "")
URL = "https://claude.ai/oauth/authorize?code=stand-in-for-tests"


def signed_in() -> bool:
    return bool(STATE) and os.path.exists(STATE)


def main(argv: list[str]) -> int:
    if argv[:2] == ["auth", "status"]:
        answer = {"installed": True, "loggedIn": signed_in()}
        if signed_in():
            answer |= {"email": "tests@example.invalid", "plan": "test"}
        print(json.dumps(answer))
        return 0

    if argv[:2] == ["auth", "logout"]:
        if not signed_in():
            print("Not logged in.", file=sys.stderr)
            return 1
        os.remove(STATE)
        print("Logged out.")
        return 0

    if argv[:2] == ["auth", "login"]:
        # No trailing newline on the prompt, exactly as the real one does:
        # that is why the server needs a pseudo-terminal rather than a pipe.
        print("Open this URL to authorise NextTex:")
        print(URL)
        sys.stdout.write("Paste the code here: ")
        sys.stdout.flush()
        code = sys.stdin.readline().strip()
        if not code:
            print("\nNo code was given.")
            return 1
        if STATE:
            with open(STATE, "w", encoding="utf-8") as handle:
                handle.write(code)
        print(f"\nSigned in as tests@example.invalid")
        return 0

    print(f"unknown command: {' '.join(argv)}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

"""What a build or a figure script is started with: the server's environment
without its credentials.

A figure script, or a build with shell escape on, could print any variable
the server was started with (Q-006). Git is given an environment built from
nothing (`gitrepo._environment`), and a list of what may pass would do the
same here, but it would have to name every variable TeX Live, MiKTeX, Perl
and Windows read, and a build that loses one fails on a machine nobody
tested. So what looks like a credential is taken out and the rest passes.
This is defence in depth: such a script runs as the writer's own user and
can read what that user can.
"""

from __future__ import annotations

import re
from typing import Mapping

#: Names a credential goes by: a word anywhere in the name, or a service's
#: prefix at its start.
SECRET = re.compile(
    r"(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)"
    r"|^(AWS|AZURE|GCP|GOOGLE|ANTHROPIC|OPENAI|GITHUB|GH|GITLAB|HF|HUGGINGFACE"
    r"|NPM|PYPI|SLACK|STRIPE|DOCKER)_",
    re.IGNORECASE,
)

#: Names that match and are not secrets, which a child may need.
NOT_SECRET = frozenset({"SSH_AUTH_SOCK", "GPG_AGENT_INFO", "XKB_KEYMAP"})


def without_secrets(env: Mapping[str, str]) -> dict[str, str]:
    """`env` with every credential-shaped variable taken out."""
    return {
        key: value for key, value in env.items()
        if key in NOT_SECRET or not SECRET.search(key)
    }

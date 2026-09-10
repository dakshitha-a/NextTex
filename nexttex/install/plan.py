"""The plan: what is about to happen, priced, before anything happens.

One rule runs through this module and it is worth stating on its own,
because breaking it is what produced two of the bugs this rework exists to
fix.  **Every item has exactly one `default`, and that same value both
renders the prompt and decides what a bare return selects.**  The shell
installer had those as two separate pieces of code, and they drifted: the
boot question displayed `[Y/n]` and assumed `n`, and TinyTeX's unattended
default was `y`, so `--yes` spent 200 MB without ever saying it would.
Neither is representable here, and a test asserts it.

Interactive and unattended defaults are allowed to differ, and two of them
do.  Somebody who has just typed the install command and read the size wants
a working typesetter; a CI job that passed `--yes` should not have 200 MB
spent on it without saying so.  The difference is declared once, in
`DEFAULTS`, rather than discovered.

Nothing here imports anything outside the standard library.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .survey import SIZES, Survey


@dataclass
class Option:
    value: str
    label: str
    detail: str = ""


@dataclass
class Item:
    key: str
    title: str
    explain: str
    options: list
    default: str
    choice: str = ""
    # Set when there is nothing to decide: the thing is already here, or the
    # machine cannot do it.  A fixed item still appears on the plan, because
    # "nothing to do" is information somebody wants before they start.
    fixed: str = ""
    current: bool = False
    size_mb: int = 0

    @property
    def decided(self) -> str:
        return self.choice or self.default

    def option(self, value: str = "") -> Option:
        value = value or self.decided
        for option in self.options:
            if option.value == value:
                return option
        return Option(value, value)

    @property
    def summary(self) -> str:
        if self.fixed:
            return self.fixed
        text = self.option().label
        return text + "   (current)" if self.current else text

    def prompt(self) -> str:
        """The line offering the choices.

        Built from `self.default`, never from a separately written string.
        That is the whole point: the displayed default and the assumed
        default are one value, so they cannot disagree.
        """
        marks = []
        for index, option in enumerate(self.options, 1):
            mark = f"{index}) {option.label}"
            if option.value == self.default:
                mark += "  [default]"
            marks.append(mark)
        return "\n".join(marks)

    def default_index(self) -> int:
        for index, option in enumerate(self.options, 1):
            if option.value == self.default:
                return index
        return 1


# Interactive default, then unattended default.  Where they are the same, the
# same value is written twice on purpose, so the table can be read straight
# down without working out which rows are special.
DEFAULTS = {
    "tex": ("tinytex", "none"),
    "agent": ("none", "none"),
    "bind": ("localhost", "localhost"),
    "service": ("yes", "no"),
}


def build_plan(
    result: Survey,
    *,
    interactive: bool,
    answers: dict | None = None,
) -> "Plan":
    answers = dict(answers or {})
    column = 0 if interactive else 1
    items: list = []

    def default_of(key: str) -> str:
        return DEFAULTS[key][column]

    # 1 -- Python -----------------------------------------------------------
    if result.venv_ready:
        python_fixed = ".venv is here; it will be checked and brought up to date"
    elif result.uv or not result.has_ensurepip:
        python_fixed = "download uv, then make .venv and install the packages"
    else:
        python_fixed = "make .venv and install the packages"
    items.append(Item(
        "python", "Python", "", [], "do",
        fixed=python_fixed,
        size_mb=(0 if result.venv_ready else SIZES["packages"][1])
                + (0 if (result.uv or result.has_ensurepip) else SIZES["uv"][1]),
    ))

    # 2 -- TeX --------------------------------------------------------------
    tex_options = [
        Option("tinytex", f"install TinyTeX  ({SIZES['tex'][0]}, into ~/.TinyTeX)"),
        Option("miktex", "install MiKTeX instead  (Windows only)"),
        Option("none", "skip it, and install a TeX yourself later"),
    ]
    if result.platform != "windows":
        tex_options = [o for o in tex_options if o.value != "miktex"]
    tex = Item(
        "tex", "TeX",
        "Nothing here can typeset. NextTex will start, and every build will\n"
        "fail, until there is a TeX.",
        tex_options, default_of("tex"),
    )
    if result.has_tex:
        tex.fixed = f"already here, at {result.tex_dir}"
        if result.missing_tex_extras and result.tlmgr:
            tex.fixed += "; adding " + ", ".join(result.missing_tex_extras)
    items.append(tex)

    # 3 -- the writing agent ------------------------------------------------
    agent = Item(
        "agent", "Writing agent",
        "NextTex works fully without one. Whatever is chosen here, the app\n"
        "asks again on its first screen and that answer is the one that\n"
        "counts; this only decides what gets installed now.",
        [
            Option("none", "none -- nothing to install"),
            Option("claude", f"Claude -- installs the Claude CLI now  ({SIZES['claude'][0]})"),
            Option("openai", "OpenAI -- nothing to install; paste an API key in the app"),
        ],
        default_of("agent"),
    )
    if result.claude:
        agent.fixed = "the Claude CLI is already here; sign in from the browser"
    items.append(agent)

    # 4 -- the interface ----------------------------------------------------
    items.append(Item(
        "interface", "Interface", "", [], "do",
        fixed="download the build for this commit",
        size_mb=SIZES["interface"][1],
    ))

    # 5 -- how it listens ---------------------------------------------------
    bind_default = default_of("bind")
    current_bind = False
    if result.config.get("tailscale"):
        bind_default, current_bind = "both", True
    elif result.config:
        current_bind = True
    bind_options = [
        Option("localhost", "localhost only -- this machine, over plain HTTP"),
        Option("both", "localhost and Tailscale -- your other devices too, over TLS"),
    ]
    listen = Item(
        "bind", "Listening",
        "Tailscale serves your tailnet address over TLS, so the same install\n"
        "is reachable from a phone or another laptop on your tailnet.",
        bind_options, bind_default, current=current_bind,
    )
    if result.platform == "windows":
        # Said out loud rather than silently omitted.  The certificate step
        # is gen_cert.sh, which wants openssl, and nobody has run it here.
        listen.options = [bind_options[0]]
        listen.fixed = "localhost only -- Tailscale needs a certificate, and that " \
                       "step is not available on Windows yet"
    elif not result.tailscale and bind_default != "localhost":
        listen.fixed = "localhost only -- tailscale is not installed"
    items.append(listen)

    # 6 -- starting at login -------------------------------------------------
    service = Item(
        "service", "At login",
        "",
        [Option("yes", "start NextTex now, and on every login"),
         Option("no", "do not; start it yourself when you want it")],
        default_of("service"),
    )
    if not result.service:
        service.fixed = "no service manager here; start it yourself"
    items.append(service)

    plan = Plan(items=items, survey=result, interactive=interactive)
    for key, value in answers.items():
        plan.set(key, value)
    return plan


@dataclass
class Plan:
    items: list
    survey: Survey
    interactive: bool = True

    def item(self, key: str):
        for item in self.items:
            if item.key == key:
                return item
        return None

    def set(self, key: str, value: str) -> None:
        item = self.item(key)
        if item is None or item.fixed:
            return
        if any(option.value == value for option in item.options):
            item.choice = value

    def choice(self, key: str) -> str:
        item = self.item(key)
        if item is None:
            return ""
        if item.fixed:
            # A fixed item has nothing to do, except that "already here" and
            # "not possible" both mean the step is skipped.
            if key == "tex":
                return "present" if self.survey.has_tex else "none"
            if key == "agent":
                return "present" if self.survey.claude else "none"
            if key == "bind":
                return "localhost"
            if key == "service":
                return "no"
        return item.decided

    @property
    def megabytes(self) -> int:
        total = sum(item.size_mb for item in self.items)
        if self.choice("tex") in ("tinytex", "miktex"):
            total += SIZES["tex"][1]
        if self.choice("agent") == "claude":
            total += SIZES["claude"][1]
        return total

    @property
    def minutes(self) -> int:
        # Two megabytes a second on a good connection, plus a minute of
        # resolving that has nothing to do with bandwidth.  Rounded up and
        # described as "roughly", because a number here is a reassurance
        # rather than a promise.
        return max(1, round(self.megabytes / 120) + 1)

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
    "shortcut": ("yes", "yes"),
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
    # Where TinyTeX actually lands, which is not the same place on all
    # three: saying `~/.TinyTeX` to a Windows user names a directory that
    # will not exist when they go looking for it.
    tinytex_home = {
        "windows": r"%APPDATA%\TinyTeX",
        "macos": "~/Library/TinyTeX",
    }.get(result.platform, "~/.TinyTeX")
    tex_options = [
        Option("tinytex",
               f"install TinyTeX  ({SIZES['tex'][0]}, into {tinytex_home})"),
        Option("miktex", "install MiKTeX instead"),
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
    # Whatever this machine already decided wins, the same way the listening
    # item works and for the same reason.  Re-running the installer is the
    # documented repair for a missing dependency, and somebody who chose
    # ChatGPT in the app and re-runs it to pick up pdftotext must not find
    # their agent switched off and their key gone.
    agent_default = default_of("agent")
    agent_current = False
    if result.config.get("provider") in ("claude", "openai", "none"):
        agent_default, agent_current = result.config["provider"], True
    elif result.claude:
        # Already on the machine, nothing to download, and the app asks
        # again on its first screen anyway.
        agent_default = "claude"
    claude_label = (
        "Claude -- already installed here"
        if result.claude
        else f"Claude -- installs the Claude CLI now  ({SIZES['claude'][0]})"
    )
    agent = Item(
        "agent", "Writing agent",
        "NextTex works fully without one. Whatever is chosen here, the app "
        "asks again on its first screen and that answer is the one that "
        "counts; this only decides what gets installed now.",
        [
            Option("none", "none -- nothing to install"),
            Option("claude", claude_label),
            Option("openai", "OpenAI -- nothing to install; paste an API key in the app"),
        ],
        agent_default, current=agent_current,
    )
    items.append(agent)

    # 4 -- the interface ----------------------------------------------------
    items.append(Item(
        "interface", "Interface", "", [], "do",
        fixed="download the build for this commit",
        # Fetched every time, because the one already here belongs to
        # whatever commit was checked out last; but it is a megabyte, and a
        # megabyte is not worth putting on a total.
        size_mb=0 if result.interface_present else SIZES["interface"][1],
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

    # 7 -- a shortcut on the desktop -----------------------------------------
    # On the plan rather than done quietly, because it is the one thing an
    # install writes outside its own directory that is not TeX, and the
    # screen above promises exactly that.
    shortcut = Item(
        "shortcut", "Desktop",
        "",
        [Option("yes", "put a NextTex shortcut on the desktop"),
         Option("no", "do not; open it from its address instead")],
        default_of("shortcut"),
    )
    if not result.desktop:
        shortcut.fixed = "no desktop on this machine, so there is nowhere to put one"
        # The default moves too, not only the text.  A fixed item still
        # reports its default to everything downstream, so leaving it at
        # "yes" would have had the plan promise a shortcut on a headless
        # machine that was never going to get one.
        shortcut.default = "no"
    items.append(shortcut)

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
            if key == "bind":
                return "localhost"
            if key == "service":
                return "no"
        return item.decided

    @property
    def megabytes(self) -> int:
        """What this will actually download, not what these steps can cost.

        Only things that are not already here.  Telling a machine that has
        the Claude CLI on it that the install is about to fetch a hundred
        megabytes is the same species of untruth as the rest of this rework
        exists to remove.
        """
        total = sum(item.size_mb for item in self.items)
        if self.choice("tex") in ("tinytex", "miktex") and not self.survey.has_tex:
            total += SIZES["tex"][1]
        if self.choice("agent") == "claude" and not self.survey.claude:
            total += SIZES["claude"][1]
        return total

    @property
    def minutes(self) -> int:
        """Roughly how long, and deliberately not the optimistic answer.

        A megabyte a second rather than the ten the connection can probably
        do, because almost none of this is one big download: pip resolves,
        TinyTeX unpacks, and `tlmgr` fetches a few dozen small packages from
        a mirror that is often slow.  Installing TeX gets a further eight
        minutes of its own for exactly that reason.

        An estimate that is under by a factor of five is worse than no
        estimate: somebody who was told three minutes and is fifteen in has
        been given a reason to think it has hung.  The first-session guide
        says twenty for a full first install, and this should agree with it.
        """
        minutes = round(self.megabytes / 60) + 1
        if self.choice("tex") in ("tinytex", "miktex"):
            minutes += 8
        return max(1, minutes)

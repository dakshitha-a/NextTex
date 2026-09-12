"""The writing instructions, and what overrides them."""

from nexttex.agent import SYSTEM_PROMPT, VOICE_PRECEDENCE, ProjectAgent


def agent(tmp_path, voice: bool):
    project = tmp_path / "p"
    (project / ".nexttex").mkdir(parents=True)
    return ProjectAgent(
        project,
        project / ".nexttex",
        context_prompt=lambda: "## The author's writing voice\n\nShort sentences.",
        has_voice=lambda: voice,
    )


def test_the_prompt_names_the_tells_it_is_trying_to_avoid():
    for tell in ("delve", "It is important to note", "plays a crucial role"):
        assert tell in SYSTEM_PROMPT


def test_it_asks_for_variation_not_just_correctness():
    assert "Vary their length" in SYSTEM_PROMPT
    assert "Let paragraphs be different lengths" in SYSTEM_PROMPT


def test_a_voice_description_is_told_to_win(tmp_path):
    options = agent(tmp_path, voice=True)._options()
    assert VOICE_PRECEDENCE in options.system_prompt
    assert "the author's voice wins" in options.system_prompt


def test_without_one_the_precedence_note_is_not_paid_for(tmp_path):
    options = agent(tmp_path, voice=False)._options()
    assert VOICE_PRECEDENCE not in options.system_prompt


def test_a_distillation_says_where_to_put_what_it_writes(tmp_path):
    """Nothing downstream can read a summary that was only spoken.  The
    prompt asked for the text and never named a file, so the model replied
    in the chat, the summary was never written, and the panel went on saying
    the documents still needed reading."""
    from nexttex.context import ProjectContext

    context = ProjectContext(tmp_path / "state")
    context.add("style", "handbook.txt", b"Margins are 1.5 inches on the left.")
    prompt, output = context.distillation_request("style")
    assert str(output) in prompt
    assert "Write" in prompt
    assert output == context.style_summary


def test_a_voice_distillation_names_its_own_file(tmp_path):
    from nexttex.context import ProjectContext

    context = ProjectContext(tmp_path / "state")
    context.add("voice", "paper.txt", b"We measured the gap and found it small.")
    prompt, output = context.distillation_request("voice")
    assert str(output) in prompt
    assert output == context.voice_summary


# --- the two rules with no exceptions -------------------------------------
#
# Standing instructions, not preferences: an em dash is banned outright, and
# a paragraph is one line in the file. Both are asserted against every agent
# that writes, because the guidance used to live in the Claude agent's
# prompt and nowhere else -- so choosing OpenAI in the settings card quietly
# chose a different standard of prose from the same button.

from nexttex.openai_agent import SYSTEM_PROMPT as OPENAI_PROMPT  # noqa: E402
from nexttex.writing import PROSE                                # noqa: E402

WRITING_AGENTS = {"claude": SYSTEM_PROMPT, "openai": OPENAI_PROMPT}


def test_every_agent_is_told_not_to_use_an_em_dash():
    for name, prompt in WRITING_AGENTS.items():
        assert "Never use an em dash" in prompt, name


def test_every_agent_is_told_a_paragraph_is_one_line():
    for name, prompt in WRITING_AGENTS.items():
        assert "Write each paragraph as one line" in prompt, name
        # The reason, not just the rule: a rule with a reason survives being
        # weighed against something else, and this one is weighed against
        # "match the document's existing conventions" on every edit.
        assert "reflow" in prompt, name


def test_every_agent_gets_the_same_writing_standard():
    """One copy, so the two cannot drift apart again."""
    for name, prompt in WRITING_AGENTS.items():
        assert PROSE in prompt, name


def test_the_rules_do_not_use_the_thing_they_ban():
    """A prompt containing an em dash is telling and showing different things."""
    assert "—" not in PROSE
    for name, prompt in WRITING_AGENTS.items():
        assert "—" not in prompt, name


def test_a_voice_description_cannot_lift_them(tmp_path):
    """`VOICE_PRECEDENCE` hands the author's voice the last word, which
    would otherwise hand it these two as well."""
    options = agent(tmp_path, voice=True)._options()
    assert "no exceptions are the exception" in options.system_prompt


def test_a_project_cannot_add_tool_servers_of_its_own(tmp_path):
    """R-056. A project is somebody else's data.

    The SDK reads a `.mcp.json` from the working directory unless told not
    to, and the working directory is the project root. A file in a project
    naming a program to run is the same class of thing as a `nexttex.toml`
    naming a compiler, which this app validates rather than trusts, and the
    tools it would add arrive inside the session with whatever the fence
    happens to make of names it has never seen.
    """
    options = agent(tmp_path, voice=False)._options()

    assert options.strict_mcp_config is True

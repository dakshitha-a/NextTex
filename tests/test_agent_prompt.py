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

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

"""Reusable prompts: files whose stems a `/` in the composer names."""

from nexttex import prompts


def test_the_two_built_ins_ship_and_read_as_two_reviews():
    names = [prompt.name for prompt in prompts.builtin()]
    assert names == ["missing-citations", "review-critical", "review-friendly"]
    friendly = next(p for p in prompts.builtin() if p.name == "review-friendly")
    critical = next(p for p in prompts.builtin() if p.name == "review-critical")
    assert "mentor" in friendly.text and "kind" in friendly.text.lower()
    assert "reviewer" in critical.text and "not supported" in critical.text
    assert friendly.said == "review friendly"
    assert friendly.as_dict()["hint"].startswith("Read the selected passage")


def test_a_project_file_of_the_same_name_replaces_the_built_in(tmp_path):
    (tmp_path / "prompts").mkdir()
    (tmp_path / "prompts" / "review-friendly.md").write_text("Our own friendly review.\n", encoding="utf-8")
    (tmp_path / "prompts" / "tighten.md").write_text("Tighten this.\n", encoding="utf-8")
    found = {prompt.name: prompt for prompt in prompts.available(tmp_path)}
    assert found["review-friendly"].source == "project"
    assert found["review-friendly"].text == "Our own friendly review."
    assert found["review-critical"].source == "builtin"
    assert found["tighten"].source == "project"
    assert sorted(found) == ["missing-citations", "review-critical", "review-friendly", "tighten"]


def test_only_markdown_files_with_plain_names_directly_in_the_folder_count(tmp_path):
    folder = tmp_path / "prompts"
    (folder / "deeper").mkdir(parents=True)
    (folder / "deeper" / "nested.md").write_text("no", encoding="utf-8")
    (folder / "notes.txt").write_text("no", encoding="utf-8")
    (folder / "..oops.md").write_text("no", encoding="utf-8")
    (folder / "empty.md").write_text("   \n", encoding="utf-8")
    (folder / "Fine-One.md").write_text("yes", encoding="utf-8")
    names = [prompt.name for prompt in prompts.available(tmp_path) if prompt.source == "project"]
    assert names == ["fine-one"]


def test_expansion_matches_a_space_or_a_hyphen_and_keeps_the_note():
    available = prompts.builtin()
    found, note = prompts.expand("/review friendly", available)
    assert found and found.name == "review-friendly" and note == ""
    found, note = prompts.expand("/review-friendly the abstract only", available)
    assert found and found.name == "review-friendly" and note == "the abstract only"
    found, note = prompts.expand("/Review Critical\nEspecially section 3.", available)
    assert found and found.name == "review-critical" and note == "Especially section 3."
    assert prompts.instruction(found, note).endswith("The writer adds: Especially section 3.")
    assert prompts.instruction(found, "") == found.text


def test_a_slash_that_names_nothing_is_left_alone():
    available = prompts.builtin()
    for draft in ("/review", "/frobnicate this", "/", "review friendly", "\\section{x}", ""):
        found, rest = prompts.expand(draft, available)
        assert found is None and rest == draft, draft


def test_a_one_word_prompt_matches_on_one_word(tmp_path):
    (tmp_path / "prompts").mkdir()
    (tmp_path / "prompts" / "tighten.md").write_text("Tighten this.", encoding="utf-8")
    found, note = prompts.expand("/tighten the introduction", prompts.available(tmp_path))
    assert found and found.name == "tighten" and note == "the introduction"


def test_a_name_that_is_a_path_is_never_read(tmp_path):
    assert not prompts.NAME.match("../x")
    assert not prompts.NAME.match("a/b")
    assert not prompts.NAME.match(".hidden")
    assert prompts.NAME.match("review-friendly")


def test_missing_citations_proposes_records_and_never_writes_one():
    """The third built-in, from the roadmap: name the claims with nothing
    cited and find papers for them. It sits beside the reviews rather than
    as a verb on the selection toolbar, because a citation is never written
    for the writer (SelectionActions.tsx), and the prompt says the same to
    the model: it proposes from publishers' records through the tools the
    agent already has, and a record goes in only through add_reference."""
    found = next(p for p in prompts.builtin() if p.name == "missing-citations")
    assert found.said == "missing citations"
    assert found.as_dict()["hint"] == "Name the claims with nothing cited, and find papers for them."
    for tool in ("search_library", "find_papers", "add_reference"):
        assert tool in found.text
    assert "Never write a citation yourself" in found.text
    assert "Do not edit the files" in found.text


def test_a_long_first_line_is_cut_at_a_word_with_an_ellipsis():
    line = "Read the selected passage, or the document in front of me if nothing is selected, " * 3
    cut = prompts.hint(line.strip())
    assert len(cut) <= prompts.HINT + 1 and cut.endswith("…")
    assert line.startswith(cut[:-1]) and line[len(cut) - 1] in " ,"
    assert prompts.hint("Short.") == "Short."

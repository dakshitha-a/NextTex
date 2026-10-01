"""The record check's routes, with Crossref replaced by a stand-in."""

import json
from pathlib import Path

from nexttex import published

FIXTURES = Path(__file__).parent.parent / "fixtures"


def seed(project_dir):
    (project_dir / "main.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\n\\cite{bad,good}\n"
        "\\bibliography{references}\n\\end{document}\n",
        encoding="utf-8",
    )
    (project_dir / "references.bib").write_text(
        "@article{bad,\n  doi = {10.1016/S0140-6736(97)11096-0}\n}\n"
        "@article{good,\n  doi = {10.1063/1.459170}\n}\n"
        "@article{uncited,\n  doi = {10.9/never}\n}\n",
        encoding="utf-8",
    )


def test_the_count_comes_first_and_the_asking_only_on_a_press(client, project_dir, opened, monkeypatch):
    seed(project_dir)
    published.forget()
    asked = []
    retracted = json.loads((FIXTURES / "crossref-retracted.json").read_text())["message"]

    def fetch(doi):
        asked.append(doi)
        return retracted if doi.startswith("10.1016") else {"relation": {}}

    monkeypatch.setattr(published, "crossref", fetch)
    count = client.get(f"/api/projects/{opened['id']}/submit/records").json()
    assert count == {"dois": 2}
    assert asked == []
    answer = client.post(f"/api/projects/{opened['id']}/submit/records").json()
    assert sorted(asked) == ["10.1016/s0140-6736(97)11096-0", "10.1063/1.459170"]
    assert [row["kind"] for row in answer["findings"]] == ["retracted"]
    assert answer["findings"][0]["file"] == "references.bib" and answer["findings"][0]["line"] == 1
    published.forget()

"""The science vocabulary's selection (`scripts/make-wordlist.py`) and the
counting it reads (`scripts/count-corpus.py`).

Driven with small made-up counts, since the corpus is gigabytes and never
in the checkout; each guard is shown keeping out the thing it was written
for and letting through the word beside it.
"""

import importlib.util
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"


def load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


make = load("make_wordlist", "make-wordlist.py")
count = load("count_corpus", "count-corpus.py")

SHIPPED = {"group", "quark", "molecules", "the", "color", "colour"}
AMERICAN = {"group", "quark", "eigenvector", "ionization", "aerogel", "goup", "amygdalae"}
BRITISH = {"group", "quark", "eigenvector", "ionisation", "aerogel", "goup", "amygdala"}


def pick(counts: dict, **kwargs) -> tuple[set, set, set]:
    return make.science(counts, SHIPPED, AMERICAN, BRITISH, **kwargs)


def everything(counts: dict, **kwargs) -> set:
    shared, british, american = pick(counts, **kwargs)
    return shared | british | american


def test_a_word_scowl_vouches_for_needs_fewer_documents_than_one_it_lacks():
    counts = {"eigenvector": (20, 20, 0), "proteome": (100, 100, 0), "omicsome": (99, 99, 0)}
    chosen = everything(counts)
    assert "eigenvector" in chosen
    assert "proteome" in chosen
    assert "omicsome" not in chosen
    assert "eigenvector" not in everything({"eigenvector": (19, 19, 0)})


def test_nothing_the_bundled_lists_hold_is_repeated():
    assert everything({"group": (900, 900, 0), "quark": (900, 900, 0)}) == set()


def test_an_acronym_or_a_formula_stays_out():
    assert everything({"tunel": (1800, 3, 1770), "srtio": (2000, 0, 2000)}) == set()


def test_a_name_needs_many_documents_and_a_word_does_not():
    counts = {"lyapunov": (7000, 16, 0), "kowalski": (400, 0, 0), "redox": (400, 390, 0)}
    assert everything(counts) == {"lyapunov", "redox"}


def test_a_spelling_near_a_far_commoner_one_is_taken_for_its_typo():
    counts = {"group": (100_000, 100_000, 0), "goup": (40, 40, 0)}
    assert "goup" not in everything(counts)


def test_a_plural_and_a_british_spelling_are_not_typos():
    counts = {
        "eigenvector": (40_000, 40_000, 0),
        "eigenvectors": (1_000, 1_000, 0),
        "ionization": (30_000, 30_000, 0),
        "ionisation": (600, 600, 0),
    }
    chosen = everything(counts)
    assert {"eigenvectors", "ionisation", "ionization"} <= chosen


def test_an_edit_to_the_first_letter_is_not_asked_about():
    counts = {"fermion": (30_000, 30_000, 0), "sfermion": (330, 330, 0)}
    assert "sfermion" in everything(counts)


def test_the_tail_of_a_hyphenated_word_stays_out():
    counts = {"molecules": (90_000, 90_000, 0), "ecules": (780, 780, 0)}
    assert "ecules" not in everything(counts)


def test_a_known_misspelling_stays_out_however_common():
    assert everything({"occurence": (5_000, 5_000, 0)}) == set()


def test_each_english_keeps_only_its_own_spellings():
    counts = {
        "ionisation": (600, 600, 0),
        "ionization": (30_000, 30_000, 0),
        "aerogel": (900, 900, 0),
        "amygdalae": (300, 300, 0),
    }
    shared, british, american = pick(counts)
    assert british == {"ionisation"}
    assert american == {"ionization"}
    # One English's list lacks these for no reason of spelling, so they
    # are both Englishes' words rather than one's alone.
    assert {"aerogel", "amygdalae"} <= shared


def test_the_variant_tests_tell_forms_from_typos():
    assert make._variant("label", "labell")
    assert make._variant("color", "colour")
    assert make._variant("centre", "center")
    assert not make._variant("occurring", "occuring")
    assert make._englishes("haematoma", "hematoma")
    assert make._englishes("oestrogen", "estrogen")
    assert not make._englishes("amygdalae", "amygdale")
    assert not make._englishes("tetrachloroethylene", "tetrachlorethylene")


def test_front_coding_round_trips():
    words = {"eigen", "eigenvalue", "eigenvector", "eigenvectors", "fermion"}
    lines = make.encode(words)
    decoded, previous = [], ""
    for line in lines:
        word = previous[: ord(line[0]) - 48] + line[1:]
        decoded.append(word)
        previous = word
    assert decoded == sorted(words)


def test_the_counter_cleans_latex_and_drops_other_languages():
    found = count.words(
        r"The K\"ahler metric of Zel'dovich mol- ecules, high- and low-energy"
        r" \varphi $x^2$ \emph{eigenvector} Kähler SNPs"
    )
    assert found == ["Kahler", "metric", "molecules", "high", "energy", "eigenvector", "SNPs"]
    assert not {"ahler", "dovich", "ecules", "highand", "arphi", "Kähler"} & set(found)
    assert count.words("Los pacientes con diabetes para una mejor calidad") is None


def test_the_counter_counts_documents_lower_case_and_capitals():
    docs, lower, mixed, english = count.tally(
        ["Lyapunov showed the eigenvector eigenvector", "the lyapunov SNPs", "und die der Sprache"]
    )
    assert english == 2
    assert docs["eigenvector"] == 1
    assert docs["lyapunov"] == 2 and lower["lyapunov"] == 1
    assert mixed["snps"] == 1

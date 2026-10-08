#!/usr/bin/env python3
"""Count how many scientific abstracts use each word, for the science list.

Run when the science vocabulary needs regenerating, before
`scripts/make-wordlist.py --science`; the output is a table, not a list,
and neither it nor the corpus is committed.

    scripts/count-corpus.py [--arxiv ABSTRACTS.jsonl.gz] [--pubmed FILE.xml.gz ...] > counts.tsv

The corpora are read, never shipped: only the counts leave this script, and
only the words chosen from them leave `make-wordlist.py`.

  * arXiv abstracts, one JSON object per line with an `abstract` field, as
    in `gfissore/arxiv-abstracts-2021` on Hugging Face (CC0): mathematics,
    physics, computing, statistics and quantitative biology.
  * PubMed baseline files from NLM, `pubmed26nNNNN.xml.gz`: biology,
    chemistry and medicine.  Each article's title and abstract is one
    document.

A word is counted once per document, so a paper that says "eigenvector"
forty times is one vote.  Three counts per word, lowercased: the documents
that use it at all, the documents that write it in lower case at least
once, and the documents that only ever write it with a capital after its
first letter, which is an acronym (`TUNEL`, `SNPs`) or a formula
(`SrTiO`, `CaMKII`).  The last two are how `make-wordlist.py` tells an
ordinary word from a name and from an acronym.

What a first reading of the counts showed, and is now cleaned before
counting: maths between dollar signs and LaTeX commands, which arXiv
abstracts carry; LaTeX accents, so `K\\"ahler` is one word and not `ahler`;
any word touching a letter outside ASCII, which is a word in another
alphabet or a name cut in two; a word with an apostrophe inside it, so
`Zel'dovich` gives no `dovich`; a word broken across a line, `mol- ecules`,
which is joined, though not `high- and low-`, which is two; and documents in another language, recognised by their
short words (`und`, `les`, `para`), since a Spanish abstract is otherwise a
source of Spanish.  PubMed's `OtherAbstract`, the translation, is left out
for the same reason.

Output is tab separated, `word docs lower mixed`, most used first, and stops
at five documents: below that a string is noise.
"""

import argparse
import gzip
import html
import json
import re
import sys
from collections import Counter
from multiprocessing import Pool

MATHS = re.compile(r"\$\$.*?\$\$|\$[^$]*\$|\\\(.*?\\\)|\\\[.*?\\\]", re.S)
ACCENT = re.compile(r"\\[\"'`^~=.]\s*\{?\\?([A-Za-z])\}?|\\[Hcuvkdbt]\{\\?([A-Za-z])\}")
COMMAND = re.compile(r"\\[A-Za-z]+")
BROKEN = re.compile(r"([a-z])- +(?!(?:and|or|nor|to|than|as|versus|vs)\b)([a-z])")
TOKEN = re.compile(r"[^\W\d_]+(?:['\u2019][^\W\d_]+)*")
ASCII = re.compile(r"[A-Za-z]+")
ARTICLE = re.compile(r"<PubmedArticle>(.*?)</PubmedArticle>", re.S)
OTHER = re.compile(r"<OtherAbstract.*?</OtherAbstract>", re.S)
PROSE = re.compile(r"<(ArticleTitle|AbstractText)[^>]*>(.*?)</\1>", re.S)
TAG = re.compile(r"<[^>]+>")

#: Short words of German, French, Spanish and Portuguese that English never
#: writes.  Three in one document and it is not an English one.
FOREIGN = frozenset(
    "der die und das ist nicht mit von zur zum auf les des est une dans pour "
    "sur sont nous avec qui los las del para con por una como entre pelo "
    "pela uma foram".split()
)

FLOOR = 5


def words(text: str) -> list[str] | None:
    """The English words of a document, as written, or None for a document
    that is not in English."""
    text = BROKEN.sub(r"\1\2", COMMAND.sub(" ", ACCENT.sub(lambda m: m.group(1) or m.group(2), MATHS.sub(" ", text))))
    tokens = TOKEN.findall(text)
    if sum(1 for token in tokens if token.lower() in FOREIGN) >= 3:
        return None
    kept = []
    for token in tokens:
        if token.endswith(("'s", "\u2019s")):
            token = token[:-2]
        if ASCII.fullmatch(token) and 4 <= len(token) <= 30:
            kept.append(token)
    return kept


def tally(texts: list[str]) -> tuple[Counter, Counter, Counter, int]:
    """The three counts over a batch of documents, and how many were English."""
    docs, lower, mixed = Counter(), Counter(), Counter()
    english = 0
    for text in texts:
        found = words(text)
        if found is None:
            continue
        english += 1
        forms: dict[str, set[str]] = {}
        for token in found:
            forms.setdefault(token.lower(), set()).add(token)
        for word, seen in forms.items():
            docs[word] += 1
            if word in seen:
                lower[word] += 1
            elif all(any(c.isupper() for c in form[1:]) for form in seen):
                mixed[word] += 1
    return docs, lower, mixed, english


def arxiv_batches(path: str, size: int = 20_000):
    batch = []
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            batch.append(json.loads(line).get("abstract", ""))
            if len(batch) == size:
                yield batch
                batch = []
    if batch:
        yield batch


def pubmed_file(path: str) -> tuple[Counter, Counter, Counter, int]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        whole = handle.read()
    whole = OTHER.sub(" ", whole)
    texts = []
    for article in ARTICLE.findall(whole):
        parts = [html.unescape(TAG.sub(" ", body)) for _, body in PROSE.findall(article)]
        if parts:
            texts.append(" ".join(parts))
    return tally(texts)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--arxiv", help="arXiv abstracts, JSON lines, gzipped")
    parser.add_argument("--pubmed", nargs="*", default=[], help="PubMed baseline XML files, gzipped")
    args = parser.parse_args()
    if not args.arxiv and not args.pubmed:
        parser.error("name at least one corpus")

    docs, lower, mixed = Counter(), Counter(), Counter()
    documents = 0

    def add(counts: tuple[Counter, Counter, Counter, int]) -> None:
        nonlocal documents
        docs.update(counts[0])
        lower.update(counts[1])
        mixed.update(counts[2])
        documents += counts[3]

    with Pool() as pool:
        if args.arxiv:
            for counts in pool.imap_unordered(tally, arxiv_batches(args.arxiv)):
                add(counts)
        for counts in pool.imap_unordered(pubmed_file, args.pubmed):
            add(counts)

    out = sys.stdout
    for word, n in docs.most_common():
        if n < FLOOR:
            break
        out.write(f"{word}\t{n}\t{lower[word]}\t{mixed[word]}\n")
    print(f"{documents} English documents, {len(docs)} distinct words", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

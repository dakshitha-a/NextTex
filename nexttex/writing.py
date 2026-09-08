"""How prose written into a project should read.

One copy, used by every agent. It lived in the Claude agent's system prompt
and nowhere else, so an install that chose OpenAI got a materially different
standard of writing from the same button: nothing about the tells, the
sentence rhythm, the paragraph shape, or the words to avoid.

Its own module rather than an import from `agent.py`, because importing that
pulls in the Claude SDK -- six hundred milliseconds of pydantic model
building -- and an install that chose OpenAI, or no agent at all, must never
load it.
"""

#: The writing guidance, appended to whatever else an agent is told.
PROSE = """\
# Writing prose that does not read as machine-written

## Two rules with no exceptions

**Never use an em dash.** Not between clauses, not as a parenthetical pair,
not to introduce a list, not anywhere. Use a comma, a colon, a semicolon, or
two sentences. Do not substitute a spaced en dash for it either. This holds
for everything you write, in the document and in what you say to the user.

**Write each paragraph as one line.** Prose is never wrapped at eighty
columns or at any other width: one paragraph is one line in the file, however
long that line is, and the editor wraps it on screen. A paragraph broken
across several source lines makes every later edit reflow every line after
the change, so a one-word correction shows up in the history and in `git
diff` as a rewritten paragraph, and the real change disappears into the
noise. Blank lines still separate paragraphs, and environments, tables,
lists and maths keep their own line structure.

This document will be read by examiners, referees and colleagues who read a
great deal of prose and can tell. The failure mode is not bad grammar; it is
prose that is fluent, symmetrical, hedged, and says less than it appears to.
Everything below is about avoiding that.

## Say the thing

Lead with the claim, then support it. Do not open a paragraph by announcing
what the paragraph will do, and do not close it by summarising what it just
did. If a sentence could be deleted without losing information, delete it.

Commit to what the evidence supports. "The calculations show X" when they do;
"X is consistent with Y, though Z remains possible" when that is the honest
state. What reads as machine-written is the stacked hedge that commits to
nothing -- "may potentially suggest that it could play a role in" -- and its
opposite, the confident sentence that contains no claim at all.

Prefer the specific to the general at every opportunity. Not "significantly
faster" but "roughly four times faster"; not "a range of methods" but the
names of the methods. A number, a compound, a method name or a mechanism is
worth more than any amount of careful phrasing around it.

## Sentences

Vary their length. Machine prose has a characteristic even rhythm -- clause,
comma, clause, full stop, over and over, every sentence between twenty and
thirty words. Real writing alternates: a long sentence that develops an idea,
then a short one that lands it.

Vary how they open. If three consecutive sentences begin with the subject of
the paragraph, or with a participial phrase, or with "This", rewrite one.

Put the grammatical subject early and make it something real. Prefer "the
wave packet crosses the intersection within 40 fs" to "it is observed that a
crossing of the intersection by the wave packet occurs on a timescale of
40 fs". Nominalisations -- "the determination of", "an investigation into" --
are where sentences go to die.

Passive voice is not banned. In a methods section it is often correct: the
apparatus, not the person, is the subject worth naming. Use it when the agent
genuinely does not matter, and use "we" when a choice was made.

## Words and phrases to avoid outright

These are the tells. They are not wrong English; they are the vocabulary of
generated text, and a reader who has seen a lot of it will notice a cluster
immediately.

- *delve, showcase, underscore, highlight (as a verb), leverage, utilise,
  robust, novel, comprehensive, seamless, crucial, pivotal, vital, key (as an
  adjective), significant when you have not tested significance*
- *It is important to note that; It is worth noting that; It should be
  emphasised that* -- if it is important, simply say it
- *plays a crucial role in; sheds light on; paves the way for; opens new
  avenues; holds promise for; a deeper understanding of*
- *In recent years, there has been growing interest in* -- and every other
  opener that describes the literature's mood rather than a fact
- *Moreover, Furthermore, Additionally* stacked at the head of consecutive
  sentences. One connective per paragraph is usually one more than needed
- *In conclusion; To summarise; In this section, we will* -- signposting that
  a heading already provides
- *Not only ... but also*; three-item lists where two items would do; pairs of
  near-synonyms joined by "and" ("robust and reliable", "clear and concise")
- *rich tapestry, landscape, realm, myriad, plethora, testament to, at the
  forefront of, cutting-edge, game-changing*

Do not simply swap a banned word for a synonym. If "this plays a crucial role
in the dynamics" becomes "this is important for the dynamics", nothing has
been fixed. Say what it does: "this coupling is what routes population to the
triplet state".

## Paragraphs

One idea per paragraph, stated in the first sentence. Then evidence,
qualification, or consequence -- and stop. Do not end on a sentence that
restates the opening in different words; that shape is the single most
recognisable feature of generated academic prose.

Let paragraphs be different lengths. Three sentences, then eight, then two.
Uniform blocks read as generated even when every sentence is good.

Use prose. A bulleted list is right for genuinely enumerable things --
parameters, steps in a procedure, conditions -- and wrong for an argument,
which needs the connective tissue that bullets remove.

## Fitting the document

Read the surrounding text before adding to it. Match its terminology exactly
-- if the document says "conical intersection seam", do not write "crossing
region" three paragraphs later. Match its level of hedging, its person
("we" or impersonal), its tense conventions for methods and results, and its
citation density. New prose should be indistinguishable in register from the
paragraph above it, not merely correct.

When you have written something, read it back and ask: does any sentence
exist only to introduce, connect, or summarise another sentence? Would a
specialist reader learn anything from it? Cut what fails."""

# How many textbook exercises are already online? (leak study)

Owner: D. Run on 2026-11-14 with the Bright Data SERP API. Raw results: `services/leakscan/results/study-openstax-study-2026-11-15T01-36-17-981Z.json`. Test set: `services/leakscan/testsets/openstax-study.json`.

## Headline

**77 of 92 real end-of-chapter exercises (84%) were found on homework-help sites**, mostly verbatim (corrected from 78; see Method). Two of the misses are query errors rather than real misses, so among the 90 exercises we could check, 77 (86%) were found.

| Subject (OpenStax book) | Exercises | Found on study sites |
|---|---|---|
| Statistics (Introductory Statistics 2e) | 20 | 19 (95%) |
| Calculus (Calculus Volume 1) | 12 | 11 (92%) |
| Biology (Biology 2e) | 20 | 18 (90%) |
| Microeconomics (Principles of Microeconomics 3e) | 20 | 19 (95%) |
| Physics (College Physics 2e) | 20 | 10 (50%) |

Where they appear (exercises found on each site; one exercise can be on several):

| Site | Exercises |
|---|---|
| Quizlet | 33 |
| Brainly | 33 |
| Vaia | 30 |
| Chegg | 21 |
| Studocu | 3 |
| Numerade | 2 |
| Course Hero | 1 |

- **Answers visible in the search snippet:** 39 of the 78 found exercises have a snippet that mentions an answer, solution, "solved" or "step-by-step". This is a lower bound: Quizlet flashcards often show the answer right after the question in the snippet itself, and our keyword check misses those.
- **Match strength:** 150 of the 159 results matched the exercise text exactly (score 1.00). Only 9 scored below 1.00.
- **Spot check:** 8 randomly sampled hits were read by hand, and all 8 were the same exercise.

## Method

- **Exercises:** 92 real exercises from 5 OpenStax textbooks, about 20 per subject (calculus has 12, because its review pages are mostly symbolic), each identified by book, chapter, number and URL.
- **How the exercise text was collected:** by a plain, non-AI script (`services/leakscan/scripts/collect_openstax.py`). It respects openstax.org's robots.txt (`/books/` is allowed for general crawlers; OpenStax blocks AI crawlers such as GPTBot from it), fetches 1 page per second with a generic research User-Agent, and passes the text straight into the search queries. The text is never read by an AI model and is never committed to git (it stays in a gitignored local folder).
- **Correction:** an earlier version of this study got the exercise excerpts through AI-assisted web fetching. That copy was discarded and the same 102 exercises (these 92 plus 10 from the first test) were re-collected with the script above. 99 matched the old excerpts word for word, so their searches stand. 3 calculus exercises differed and were searched again: 2 were still found and 1 was not. So calculus is 11 of 12, and the total is 77 of 92 (84%), not 78. The larger Textbook Leak Index replaces these numbers once it's published.
- **Queries:** one exact-phrase Google query per exercise through Bright Data's SERP API, using its most distinctive 8–12 word window. If nothing matched, one keyword query restricted to homework sites. 114 queries in total, well under the 200-query budget (about $0.17).
- **What counts as a leak:** all three of the following.
  - the result is on a homework-help site;
  - its title and snippet match the exercise at 0.5 or more;
  - it contains the exercise's ask (60% or more of its content words), so a shared phrase alone doesn't count.

  This excluded 1 partial match and 27 results on other sites (OER mirrors, lecture notes).
- **What we store:** snippets and links only. We never open paywalled pages or store answer content.
- **Licensing:** OpenStax text is used only as search strings. It is never sent to an LLM, in line with OpenStax's terms.

## Caveats

- This is one snapshot. Search results vary by day and region.
- A match score measures text overlap, not proof that the page has the same question with a correct answer. The spot check suggests overlap at 1.00 is reliable here.
- Physics found far less (50%). One likely reason is that College Physics problems are often reposted with different numbers or wording, which an exact-phrase search misses. So physics is probably undercounted, not clean.
- 4 queries errored (Bright Data returned an empty body or a rate-limit message). 2 of those exercises were still found through the fallback query; the other 2 are unknown.
- Sites that paraphrase questions are undercounted by design.

## Why it matters (Data for Good)

If most textbook end-of-chapter questions already sit on Quizlet, Brainly, Vaia and Chegg, often with answers, then any course that reuses them is giving out an answer key. The question isn't whether to assume a quiz has leaked, but which questions to rewrite first. Unprompted's leak radar answers that per question, with evidence.

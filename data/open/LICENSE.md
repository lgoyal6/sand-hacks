# Open dataset: The State of Leaked Homework (Nov 2026)

Files: `leaked-homework-2026-11.csv`, `leaked-homework-2026-11.json` (same rows, plus the summary, method and caveats).

**License:** CC BY 4.0. Credit "Unprompted leak study, 2026".

**What's in it:** for each of 92 real end-of-chapter exercises from 5 OpenStax textbooks, the homework-help pages where a web search (Bright Data SERP API, 2026-11-14) found it. Columns: exercise id, subject, book, link to the exercise on openstax.org, site, link to the public result page, match type (exact, strong, partial or not_found), match score (text overlap 0–1), whether the search snippet mentioned an answer, and whether the query errored.

**What's not in it:** no exercise text, no snippets, no answers, no page content. Exercises are identified by book, chapter and number with a link to OpenStax (textbooks © OpenStax, CC BY / CC BY-NC-SA; OpenStax content is not redistributed here). Result URLs are public links as returned by a search engine.

**Caveats:** this is one search snapshot. A match score measures text overlap, not proof that a page holds the same question with a correct answer. Physics is likely undercounted. See `docs/leak-study.md`.

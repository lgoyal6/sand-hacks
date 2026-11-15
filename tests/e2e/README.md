# tests/e2e: LLM-free smoke suite (owner: A)

`pnpm test:e2e` runs Playwright (installed Google Chrome, headless, one worker) against the shared dev server on :3100.
It never starts a server, makes no LLM calls, and never deletes data.

Covers: home loads; /studio loads with no page errors; a practice attempt tagged `e2e-<ts>` answers all 5 questions
with real key and click events, sees feedback, completes the typed think-aloud probe, finishes with 5/5, is graded
correct server-side (via the runner API), and its telemetry rows land in Tiger (checked by attempt id) or the jsonl
fallback. Any `/api` response with status 400 or higher fails the run with the route and body.

Zero LLM: the one model-backed call on this path, `POST /api/probes/:id/counterfactual`, is stubbed with `page.route`.
Failure screenshots and traces go to `traces/e2e/` (gitignored).

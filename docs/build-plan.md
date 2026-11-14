# ThinkAloud: Build Plan

Working name: **ThinkAloud** (after the "think-aloud protocol" from cognitive psychology, where people say their reasoning out loud while solving a problem).

**One line:** Canvas can't stop AI agents from taking quizzes. ThinkAloud attacks a professor's quiz with the same agents students use, keeps only the question variants that agents fail and that still test the same skill, and asks the student to talk through their reasoning at the moments an agent would have answered for them.

**Thesis:** Stop testing what an agent can produce. Test what only the learner has: a model of the problem in their head, which shows up when they explain it and when they handle a change to it.

---

## 1. The pain point, grounded

### 1.1 What is happening right now
- **Agents can sit in a student's Canvas account and do the coursework.**
  - Companion.AI's "Einstein" (Feb 2026) logged into Canvas with the student's credentials and completed assignments, discussion posts and submissions. It was built on open-source agent software (OpenClaw) and later taken down ([Futurism](https://futurism.com/artificial-intelligence/ai-agent-canvas-homework), [Inside Higher Ed](https://www.insidehighered.com/index%2Ephp/node/203441)).
  - California Virtual Campus's white paper says these tools "can log in to Canvas and complete quizzes, discussions, and assignments on behalf of students" and that "no single technical solution currently exists" ([CVC](https://www.cvc.edu/wp-content/uploads/2025/11/Safeguarding-Academic-Integrity-in-the-Age-of-Agentic-AI.pdf)).
  - A Canvas community request to block agents from logging in for students was reportedly marked "Will not"; the snippet was cut off, so this is unverified.
- **Scale.** A study in *Science* (May 2026) covered 95,513 students at 20 US public research universities. It found about a third regularly use generative AI on assignments and about 9% report using it to cheat. Among daily users, 26% report cheating, and 62% of CS students are regular users. The authors recommend assessments that require students to show their reasoning ([Cornell](https://news.cornell.edu/stories/2026/05/widespread-ai-misuse-means-higher-ed-must-rethink-assessment), [Berkeley CSHE](https://cshe.berkeley.edu/node/1878)).
- **The harm is to learning, not only to integrity.** In a field experiment with about 1,000 high-school students (Bastani et al., *PNAS* 2025), unrestricted GPT-4 raised practice scores 48% but **cut scores on the later exam without AI by 17%**. A tutor with guardrails (hints, not answers) removed the harm ([PNAS via RePEc](https://ideas.repec.org/a/nas/journl/v122y2025pe2422633122.html), [Wharton](https://knowledge.wharton.upenn.edu/article/without-guardrails-generative-ai-can-harm-education/)). Students using the guarded tutor still believed they had done better than they had.
- **Detection-based answers hurt the wrong people.** GPT text detectors flagged more than half of TOEFL essays by non-native English writers as AI-written, with one detector flagging 98% (Liang et al., *Patterns* 2023, [arXiv](https://arxiv.org/abs/2304.02819)). Any product that accuses students based on how their text looks will repeat this harm.
- **Oral exams work and are coming back, but they don't scale.**
  - UCSD's Huihui Qi ran an NSF project with over 7,000 oral exams for about 3,500 engineering students. Its papers report anxiety falls with practice runs and familiarity ([ASEE](https://peer.asee.org/board-400-the-impact-of-oral-exams-on-engineering-students-learning)).
  - NYU Stern ran an AI voice oral exam for 73 students, graded by three LLMs that score separately and then revise, for under $1 per exam to grade ([arXiv 2603.18221](https://arxiv.org/abs/2603.18221)).
  - Cornell runs oral assessment workshops ([WTOP/AP](https://wtop.com/education/2026/04/perfect-homework-blank-stares-why-colleges-are-turning-to-oral-exams-to-combat-ai/)).

### 1.2 The psychology (why this design, not a generic "AI oral exam")
| Finding | What it means for the product |
|---|---|
| **Illusion of explanatory depth** (Rozenblit & Keil 2002): people rate their understanding high, then the rating collapses once they try to explain. The effect is specific to explanatory knowledge, not facts or procedures. | Ask for confidence **before** the explanation and again **after**. The drop is a measurable, honest signal of understanding, and seeing it teaches the student something. Probe causal "why" and "what if" questions, not recall. |
| **Self-explanation effect** (Chi et al. 1989): students who explain worked steps to themselves learn more. | The probe is a learning intervention as well as a check. Position it as practice that helps you, which keeps the product focused on mastery. |
| **Testing effect and desirable difficulties** (Roediger & Karpicke 2006; Bjork; Pan & Rickard 2018 meta-analysis on transfer). | Short, effortful explanation prompts improve retention and transfer. Low-stakes practice mode is a core feature, not an extra. |
| **Why students cheat** (Murdock & Anderman 2006): goals ("why am I doing this?"), expectations ("can I do it?") and costs ("what does it cost me?"). Mastery goals predict less cheating. | Design all three levers: (a) **goals:** mastery framing, calibration feedback, practice mode; (b) **expectations:** scaffolded hints in practice, so students believe they can do it themselves; (c) **costs:** agent-answered questions now require a live explanation, so outsourcing stops paying off. |
| **Cognitive offloading** ("Your Brain on ChatGPT", MIT preprint 2025, n=54, EEG): the LLM group showed the weakest brain connectivity and couldn't quote their own essays. Lee et al. (CHI 2025, 319 knowledge workers): more confidence in AI goes with less critical thinking. | The product must show students the gap between "I submitted it" and "I can explain it", without shaming them. |
| **Oral exam anxiety** (Qi's ASEE papers): anxiety is higher at first and falls with practice. | Unlimited practice probes, a typed alternative, at most 2 probes per quiz, and an option to retry once. |
| **Non-native speakers penalized by detectors** (Liang 2023). | Grade the **content** of the reasoning, never fluency, accent or wording. Offer multilingual probes (Scribe v2 handles 90+ languages). |

**Avoid citing:** the "sign at the top reduces cheating" honesty study (Shu, Mazar, Gino, Ariely, Bazerman 2012). It was retracted over fabricated data. A judge may know.

### 1.3 Product principles derived from the research
1. **Measure understanding; never accuse.** Output is evidence for a conversation, not a verdict. Flags read "suggest a follow-up chat", never "cheater".
2. **Prove AI resistance; don't assert it.** Every transformed question carries a measured agent-failure rate.
3. **Probe causes and counterfactuals, not definitions.** The illusion of explanatory depth only shows up for explanatory knowledge.
4. **Confidence before and after.** Calibration is both the signal and the lesson.
5. **Low stakes first.** Practice mode, typed fallback, a cap on probes, a retry.
6. **Grade content, not delivery.** Rubric scoring with three LLMs plus professor approval.
7. **Keep the professor's intent.** Transformed items must test the same learning objective, verified, and the professor approves.
8. **Privacy by default.** FERPA scope, explicit recording consent (California requires everyone on a recording to consent), audio deleted after grading.

---

## 2. The product

### 2.1 Actors
- **Professor or TA:** imports a quiz, reviews the red-team report, approves the transformed questions, reviews explain-gap evidence.
- **Student:** takes the quiz, answers 0 to 2 voice probes, sees calibration feedback.
- **Admin (stretch):** installs it as an LTI tool across a campus Canvas.

### 2.2 Core flows
1. **Import:** the quiz arrives as a Canvas QTI export, through the New Quizzes REST API, or by paste or Markdown (text2qti format).
2. **Red-team ("Agent Attack"):** run N real browser agents (browser-use, Stagehand) on the quiz in a sandboxed quiz runtime. Record per-question accuracy, time and steps. Result: an **agent solve rate** per question.
3. **Leak scan:** for each question, run exact-phrase and fuzzy searches through Bright Data's search API, collect public result pages (Quizlet sets, Reddit, course-hero-style snippets) and screenshot them. Result: a **leak status** per question, with evidence.
4. **Transform with verification:** for each question flagged as agent-solvable or leaked, generate candidate variants: isomorphic changes, application framing, data-grounded context, "explain the error" items, and counterfactual stems. A candidate survives only if:
   - (a) a solver with a code interpreter gets a consistent answer key (the Chen 2025 method);
   - (b) a three-LLM panel agrees it tests the same learning objective;
   - (c) the **agent's solve rate drops** on a re-run;
   - (d) it passes clarity and ambiguity checks (the Liu et al. 2026 validation).

   Each candidate's experiment runs on its own **Neon branch**; only survivors are merged. The professor approves the final set.
5. **Deliver:** students take the quiz in the ThinkAloud runtime, through an LTI launch from Canvas or a standalone link. Telemetry streams to **Tiger Data**.
6. **ThinkAloud probe:** a policy decides when to probe, mostly on questions agents solved. The student rates confidence from 1 to 7, then talks for 30 to 60 seconds with an ElevenLabs voice agent. The agent asks one counterfactual follow-up built from the student's own answer ("You chose B. What changes if the sample doubled?"). Confidence is rated again afterwards. There is a typed fallback.
7. **Grade:** three LLMs score the transcript against the rubric separately, then revise after seeing each other's scores (the NYU method). Output: understanding score, quoted evidence, and the time taken to answer the counterfactual.
8. **Professor view:**
   - An **explain-gap matrix:** answer correctness against explanation score, per student per question.
   - Agent-likelihood by session, with the telemetry timeline as evidence.
   - Leak alerts.
   - Each question's agent-resistance history.
9. **Student view:** a calibration chart (confidence before vs after vs actual), plus what to review. Mastery framing throughout.

### 2.3 The platform: a lightweight LMS plus a Canvas connection
ThinkAloud ships as a **lightweight LMS built for the agent era** that also **connects to Canvas**, so schools don't have to switch.

**Native platform:** only what ThinkAloud needs.
- **Course home:** what's due this week.
- **Assignments and quizzes:** all run in the ThinkAloud quiz app, with telemetry and voice probes.
- **Gradebook:** shows the explain gap next to each grade.
- **Professor studio:** import, attack, transform, approve.
- **Student progress:** calibration and mastery.
- **Optional:** agent-proof discussions, where a reply needs a short voice or counterfactual follow-up.
- **Not built:** files, calendar, messaging, modules, settings sprawl.
- **Extra signal:** with the whole platform instrumented, login and navigation behavior before a quiz is also visible.

**Canvas connection:** two paths, built in this order.
1. **"Connect Canvas" with an API token (the demo path).** The professor pastes a Canvas access token. ThinkAloud pulls courses, the roster and quizzes (Classic `/api/v1/courses/:id/quizzes` and New Quizzes `/api/quiz/v1/courses/:id/quizzes`), mirrors them, and pushes grades back through the Submissions API.
   - No admin approval is needed, so it works on our own Canvas instance.
   - UCSD's Canvas may restrict tokens, so the demo uses our own instance or a free teacher account. Verify which is available.
2. **LTI 1.3 tool (the adoption path).** A campus admin installs ThinkAloud once. Professors add a ThinkAloud quiz as a Canvas assignment through deep linking, students launch it inside Canvas, and grades return through Assignment and Grade Services.
   - This needs a developer key from a Canvas admin, so demo it on a self-hosted canvas-lms (Docker) where we are the admin.

**Judge answer to "why would a school leave Canvas?":** "They don't have to. Plug ThinkAloud into Canvas today. The full platform is for programs that want agent-proof courses end to end, such as fully online community college courses."

### 2.4 What makes this different from existing tools
| Existing | What it does | ThinkAloud's difference |
|---|---|---|
| NYU AI oral exam ([arXiv](https://arxiv.org/abs/2603.18221)); Georgia Tech Socratic Mind; [Coraltalk](https://www.cisontario.ca/sponsors/our-sponsors/details/~board/sponsors/post/coraltalk); Oregon State [Explain It](https://business.oregonstate.edu/blog/faculty-research/explain-it-jonathan-kalodimos-new-ai-assisted-oral-evaluation-tool) | Voice oral exams, standalone | ThinkAloud (1) **attacks the quiz with real agents first** and probes only where agents succeed; (2) proves transformed questions resist agents through a verification loop; (3) uses confidence calibration (illusion of explanatory depth) as a signal; (4) adds session telemetry for agent detection; (5) scans for leaks; (6) sits inside Canvas via LTI. |
| Canvas IgniteAI (Instructure's own agent) | Helps faculty write content; deliberately won't grade | Does not test whether the quiz resists agents. |
| Turnitin and GPT text detectors | Score submitted text | ThinkAloud never classifies text style, which avoids the bias against non-native speakers. |
| Keystroke-dynamics research ([arXiv 2511.12468](https://arxiv.org/abs/2511.12468)) | Detects transcription in essays | ThinkAloud applies telemetry to quizzes and combines it with the probe. |

---

## 3. Architecture

```
                 ┌──────────────── Canvas (LTI 1.3 launch, AGS grade passback) ────────────────┐
                 │                                                                              │
 Professor UI ───┤  Next.js app (Vultr)                                        Student quiz runtime (React)
 (import, review,│     │                                                        │  rrweb + custom events
  approve, gaps) │     │  Mastra workflows (TypeScript orchestration)           │  BotD, paste/focus hooks
                 │     ├── ingest:    QTI parse (qti2txt) / New Quizzes API    │  ElevenLabs Agent widget
                 │     ├── redteam:   Agent Attack runners (browser-use, Stagehand) ──► sandbox quiz copies
                 │     ├── leakscan:  Bright Data SERP API + Web Unlocker + Browser API screenshots
                 │     │              + Web Archive (last 24h) watch
                 │     ├── transform: Gemini generator + code-interpreter solver + 3-LLM objective panel
                 │     │              + agent re-test  (one Neon branch per candidate, merge survivors)
                 │     ├── probe:     probe policy -> ElevenLabs Agent (client tools) -> Scribe v2 transcript
                 │     ├── grade:     3-LLM council (Gemini + 2 others) -> rubric scores + evidence
                 │     └── detect:    feature extraction from Tiger aggregates -> agent-likelihood model
                 │
   Neon Postgres (app data: courses, items, variants, experiments as branches, grades, consent)
   Tiger Data (hypertables: interaction_events, agent_runs, probe_timing; continuous aggregates; state_agg)
```

### 3.1 Components and open-source pieces
| Component | Build on | Notes |
|---|---|---|
| LTI 1.3 tool (launch, deep linking, grade passback) | [PyLTI1p3](https://pypi.org/project/PyLTI1p3/) (Python) or ltijs (Node) | Canvas fully supports LTI 1.3 Advantage. Deep linking lets a professor place a ThinkAloud quiz as an assignment, and Assignment and Grade Services posts scores back. |
| Quiz import | [qti2txt](https://pypi.org/project/qti2txt/) (reads Canvas QTI 1.2 exports), [text2qti](https://pypi.org/project/text2qti) (Markdown to QTI), Canvas [New Quizzes API](https://developerdocs.instructure.com/services/canvas/resources/new_quizzes) at `/api/quiz/v1/courses/:id/quizzes` | Start with Markdown/QTI. The API is a stretch goal. |
| Demo Canvas | Self-hosted [canvas-lms](https://github.com/instructure/canvas-lms) Docker, or a mock LMS page | Verify whether a free teacher account is still available. If not, use a mock "Canvas-like" page that we control for the agent-attack demo. |
| Agent Attack | [browser-use](https://github.com/browser-use/browser-use) (about 110k stars, Python), [Stagehand](https://github.com/browserbase/stagehand) (TypeScript), Skyvern (vision-first) | Run several agents with different models. These are the same tools a student would use. Only attack our own sandbox copies of quizzes, never live courses. |
| Telemetry | [rrweb](https://github.com/rrweb-io/rrweb) (record and replay the session), custom listeners (keydown timing, paste, focus/blur, pointer), [BotD](https://github.com/fingerprintjs/botd) (open-source automation detection; partial coverage for Playwright and Puppeteer) | Behavioral signals separate agents from humans better than browser fingerprints do ([FP-Agent preprint, May 2026](https://arxivlens.com/paperview/details/fp-agent-fingerprinting-ai-browsing-agents-107-4990a0ed); [Akamai](https://www.akamai.com/blog/security-research/2026/aug/identifying-agentic-automation-behavioral-telemetry)). |
| Voice probe | ElevenLabs Agents (now branded "ElevenAgents") with client tools; Scribe v2 for the timestamped transcript | Fallback: Pipecat (BSD-2) with ElevenLabs TTS if the managed agent's turn-taking is limiting. |
| Item variants | Prompt chaining plus code-interpreter verification ([Chen 2025, arXiv 2508.14755](https://www.arxiv.org/abs/2508.14755)); validation ([Liu et al. 2026, arXiv 2602.05114](https://arxiv.org/abs/2602.05114)); math templates ([arXiv 2511.07932](https://arxiv.org/abs/2511.07932)) | Liu et al. found 73% of deployed physics item banks had statistically equal difficulty across variants. Cite that as the realistic ceiling. |
| Difficulty and mastery models | [py-irt](https://github.com/nd-ball/py-irt) (Bayesian item response theory), [pyBKT](https://arxiv.org/abs/2105.00385) (knowledge tracing, MIT license) | Calibrate item difficulty from pilot responses, and track mastery across quizzes (stretch). |
| Grading council | Gemini plus two other models, run separately then revised (NYU method) | Every grade is a suggestion; the professor approves. |
| Orchestration | Mastra (TypeScript workflows) | Makes the pipeline a real multi-step agent workflow (MLH Mastra track). |
| Hosting | Vultr VM plus GPU (optional) | Agent runners need headless browsers: Docker with Playwright. |

### 3.2 Data model (Neon)
```
course(id, lti_context_id, title)
quiz(id, course_id, source_format, imported_at)
item(id, quiz_id, stem, type, choices_json, answer_key, objective, original_item_id NULL)
variant_experiment(id, item_id, neon_branch, generator, status[proposed|verified|rejected|approved], reasons_json)
agent_run(id, quiz_id, item_id, agent[browser-use|stagehand|skyvern], model, correct, seconds, steps, run_at)
leak_finding(id, item_id, query, url, source_type, snippet, screenshot_url, found_at, match_score)
attempt(id, student_pseudonym, quiz_id, mode[practice|graded], started_at, consent_audio bool)
response(id, attempt_id, item_id, answer, correct, seconds)
probe(id, attempt_id, item_id, confidence_before, confidence_after, transcript, counterfactual_latency_ms,
      council_scores_json, final_score, professor_approved bool)
session_flag(id, attempt_id, agent_likelihood, top_features_json)
```

### 3.3 Time series (Tiger Data)
```
interaction_events(ts, attempt_id, item_id, kind[key|paste|focus|blur|pointer|scroll|select|answer], payload jsonb)  -- hypertable
agent_run_events(ts, run_id, item_id, action, payload)                                                  -- hypertable
probe_timing(ts, probe_id, phase[prompt|speech_start|speech_end|cf_prompt|cf_speech_start], ms)          -- hypertable
```
- **Continuous aggregates:** per-attempt, per-item features: inter-key interval statistics, paste counts, time to first input, pointer path entropy, focus-loss count, and the gap between reading and answering.
- **`state_agg` / `duration_in`:** time spent in `focused`, `blurred` and `idle` per item.
- **`heartbeat_agg`:** "dead ranges" where the page got no human input but answers changed (a strong agent signal).
- **Live dashboard:** agent runs and student sessions streaming side by side.

---

## 4. Key algorithms

### 4.1 Agent Attack and the solve rate
- For each quiz, run K = 3 agents x M = 3 models x R = 3 repeats in fresh sandboxes.
- **Solve rate per item:** `solve_rate = correct_runs / total_runs`.
- Items with a solve rate of 0.6 or higher are marked **agent-solvable**.
- Store full action traces (Tiger) for the demo replay.

### 4.2 Transform and verify (keep only what passes)
For each agent-solvable or leaked item, loop up to N candidates:
1. Generate a candidate. Strategies:
   - (i) isomorphic numbers or context;
   - (ii) application framing on real local data;
   - (iii) "find the error in this worked solution";
   - (iv) a two-step dependency on a figure or table rendered as an image;
   - (v) a counterfactual stem.
2. Create a Neon branch `exp/<item>/<n>` and write the candidate.
3. The solver, using a code interpreter, solves it 3 times; the answer key must agree.
4. The three-LLM objective panel must agree the candidate tests the same learning objective, and that it isn't ambiguous.
5. Re-run the agents on the candidate; it survives only if the new solve rate is 0.3 or lower and at least 0.4 below the original.
6. Survivors are merged into the main branch as `status=verified`; rejected candidates are kept with their reasons, which the demo shows.

**Honesty:** some items cannot be made agent-resistant without changing the learning objective. Those items get **probe priority** instead.

### 4.3 Probe policy (which questions trigger a voice probe)
`priority(item, student) = 0.5*solve_rate + 0.2*leaked + 0.2*session_anomaly + 0.1*random`

- At most 2 probes per graded quiz. Randomize timing so probes can't be predicted.
- Always probe at least once in practice mode.
- Probe only after the student answers, so it reads as "tell me your thinking", not a gate.

### 4.4 Counterfactual follow-up (the core of the probe)
- From the item and the student's answer, generate a **perturbation question** whose answer follows from the same causal model:
  - change one parameter ("What if n doubled?");
  - ask about a boundary condition ("What if it were negative?");
  - name the step that breaks.
- Signals measured:
  - (a) correctness of the reasoning (council);
  - (b) **counterfactual latency:** the gap from the end of the prompt to the start of speech, plus any pause in the middle;
  - (c) consistency with the student's original answer;
  - (d) the confidence drop (illusion of explanatory depth).
- **Do not claim** latency proves outsourcing. Report it as context, alongside the rest.

### 4.5 Understanding score and explain gap
`understanding = council_rubric_score (0-4)`

`explain_gap = correct_answer AND understanding <= 1`

`calibration_error = |confidence_after_scaled - understanding_scaled|`

The professor sees a matrix with **correct vs. understood** quadrants:
- correct and explained;
- correct but not explained (the explain gap);
- wrong but explained (a near miss);
- wrong and not explained.

### 4.6 Agent-likelihood model
- **Features** from Tiger aggregates:
  - inter-key interval variance;
  - paste ratio;
  - pointer path entropy;
  - time per item vs. the item's difficulty;
  - dead ranges from `heartbeat_agg`;
  - focus loss;
  - BotD flags;
  - uniform action spacing;
  - scroll entropy.
- **Training data:** collect it during the event.
  - **Human sessions:** 15 to 30 hackers take a practice quiz, with consent.
  - **Agent sessions:** 30 to 60 browser-use and Stagehand runs on the same quiz.
- **Model:** logistic regression or gradient-boosted trees, evaluated with leave-one-person-out cross-validation.
- **Report** AUC with a confidence interval. Never auto-act on it; it's evidence for the professor.

### 4.7 Leak scan
- **Exact-phrase queries:** use quoted 8 to 12 word windows from each question stem. Then fuzzy queries with key nouns plus a domain filter, through Bright Data's SERP API.
- **Evidence:** keep result titles and snippets. A snippet like "Chegg: Solved ..." is proof by itself, without fetching paywalled pages. Fetch public pages (Quizlet public sets, Reddit) through Web Unlocker. Screenshot them with the Browser API.
- **Leak watch:** after the quiz is released, query the Bright Data Web Archive for the **last 24 hours** of crawled pages containing the question text. Fresh data is delivered right away. Data older than 24 hours takes 48 to 72 hours, so it is not on the critical path.
- **Match scoring:** cosine similarity of embeddings plus a token-overlap threshold. Show the match level next to the evidence.
- **Constraints:** respect Bright Data's compliance rules. Some domains may be restricted without identity verification (KYC). Never fetch or store copyrighted solution content; store the snippet, URL and screenshot only.

---

## 5. Sponsor map: the lesser-known features, each with a real job
| Sponsor | Feature | Job | Why it matters to the product |
|---|---|---|---|
| **Bright Data** | SERP API (structured Google and Bing results) | Exact-phrase leak scan for each question | Reveals whether the answer key is already online, which is the professor's real fear |
| | Web Unlocker | Fetch public Quizlet and Reddit leak pages | Those sites block scrapers |
| | Browser API screenshots | Timestamped evidence for each leak | Evidence a professor can act on |
| | Web Archive API, last 24h | Daily leak watch after the quiz is released | Catches new leaks before the next section takes the quiz |
| | Scraper Studio with self-healing (stretch) | Pull local public datasets for application-framed questions | Grounds rewritten questions in real data |
| **ElevenLabs** | Agents with client tools | Run the voice probe and trigger the counterfactual follow-up | The core experience |
| | Scribe v2 (word timestamps, 90+ languages, audio event tags) | Measure speech-onset latency and pauses; multilingual probes | Grades content in any language, without bias against accents |
| | Keyterm biasing | Correct transcription of course terms ("eigenvalue", "p-value") | Accuracy on technical vocabulary |
| **Neon** | Copy-on-write branches | One branch per transformation experiment; merge only survivors | The "only what passes survives" loop is visible in the database |
| | Branch from timestamp, Time Travel | Freeze the exact quiz version each student took | Audit trail for any appeal |
| **Tiger Data** | Hypertables and continuous aggregates | Telemetry features per attempt and item | Data for the agent-likelihood model |
| | `state_agg`, `heartbeat_agg` | Focus and idle time; dead ranges where answers change without human input | Strong behavioral signals |
| **Gemini (MLH)** | Generation, solving, council member | Transform, solve and grade | The main LLM |
| **Mastra (MLH)** | TypeScript workflows | Orchestrate ingest, red-team, transform, probe and grade | Visible multi-step agent workflow |
| **Vultr (MLH)** | VMs, optional GPU | Host the app and the agent-runner fleet | Headless browsers at scale |
| **GoDaddy (MLH)** | Domain | thinkaloud.something | Free prize entry |
| **GMI Cloud (not a sponsor; allowed under the "any tools" rule)** | Inference API for open models (Qwen, DeepSeek, Llama), plus GPUs | (1) Two of the three grading-council seats run on different open-model families, so the graders are truly independent. (2) Varied attacker models for the Agent Attack. (3) Bulk variant generation at low cost. | Model diversity makes the council and the red-team stronger; it wins no prize, so keep Gemini on the critical path for the MLH Gemini track |

**Honest framing for Data for Good:** the social stake is **online education's credibility and access.** If agents can complete online courses, institutions fall back to in-person proctoring. That hurts working adults, parents and community college students most, and it is the population California Virtual Campus serves. This is inference, so phrase it as the risk. Web data is used for good here: leak detection protects honest students from a curve set by leaked answer keys.

---

## 6. Evidence to produce before judging (results, not claims)
1. **Agent Attack result:** "Original quiz: agents solved X% (n runs). After verified transforms: Y%." Report the confidence interval.
2. **Transform yield:** "N candidates generated, M verified, K rejected (top reasons)."
3. **Telemetry classifier:** "AUC Z on H human vs A agent sessions, leave-one-person-out." Report false positives openly.
4. **Explain-gap pilot:** 5 to 15 hackers take a quiz with probes. "P of Q correct answers had an explain gap"; average confidence drop of D points (replicating the illusion of explanatory depth).
5. **Leak scan on a real public question bank** (OpenStax end-of-chapter problems or a public course): "L of 50 questions found online, with evidence."
6. **Latency distributions:** humans answering the counterfactual live vs. a scripted "lookup" condition, where a teammate pastes the question into ChatGPT and reads the answer aloud. Show the two distributions overlapping or separating honestly.

---

## 7. Ethics, privacy, fairness (answer these before a judge asks)
- **Consent:** explicit audio-recording consent screen (California requires all parties' consent); typed fallback with no penalty.
- **FERPA:** use pseudonymous student IDs, delete audio after grading, keep transcripts only for the appeal window. The demo uses fake students.
- **No accusations:** the system never labels a student a cheater. Flags are prompts for a follow-up conversation, with evidence attached.
- **Bias:** grade content, not fluency; support multilingual probes; give extended time as an accommodation; report false-positive rates for the agent model.
- **Anxiety:** practice mode, 2-probe cap, one retry, warm voice persona, and clear grading weight (for example, probes count for 10%).
- **Attacking agents only touches our own sandboxes,** never real courses or other people's accounts.
- **Bright Data compliance:** only public pages; store snippets and screenshots, never copyrighted solutions.

---

## 8. Workstreams (team of 4)
| Owner | Workstream | Deliverables |
|---|---|---|
| **A: Agents and red-team** | Quiz sandbox, Agent Attack runners (browser-use, Stagehand), solve-rate stats, agent-run traces to Tiger | Repeatable attack command; a demo replay of an agent acing the quiz |
| **B: Transform engine (Mastra and Neon)** | Generator, code-interpreter solver, objective panel, branch-per-experiment, merge of survivors, professor approval UI | Verified variant set with rejection reasons |
| **C: Student runtime, voice and telemetry** | React quiz app, rrweb and custom events to Tiger, BotD, ElevenLabs probe with counterfactual follow-up, confidence ratings, Scribe timing | End-to-end probe on one question; live telemetry |
| **D: Data, Bright Data, dashboards, deploy** | Leak scan (SERP, Unlocker, Browser API, last-24h Archive), Tiger aggregates and features, agent-likelihood model, professor and student dashboards, Vultr deploy, domain | Explain-gap matrix, leak evidence, session timelines, model AUC |
| **Shared: platform and Canvas** | LMS shell (course home, assignments, gradebook) owned by C; "Connect Canvas" token import and grade push owned by B; LTI 1.3 launch on self-hosted canvas-lms owned by D (Phase 3) | A professor connects Canvas, imports a real quiz, and grades flow back |

### Phases (ordered by dependency, not by clock)
- **Phase 0: kill tests, before anything else**
  1. browser-use completes our sandbox quiz with at least 80% accuracy. If not, the hook dies; tune the quiz until a real agent aces it.
  2. An ElevenLabs agent runs a 60-second probe and returns a transcript with timestamps through a client tool.
  3. A Bright Data SERP query on 10 OpenStax-style questions returns at least 1 real leak.
  4. Events land in a Tiger hypertable, and the continuous aggregate computes.
  5. A Neon branch is created, written to and merged from code.
  6. **Apply for Bright Data KYC** (residential and Browser API access to restricted domains), and build nothing that depends on approval.
- **Phase 1: the spine.** One quiz, end to end: import, Agent Attack, transform one item with verification, student takes the quiz with one probe, council grades it, professor sees the explain-gap matrix.
- **Phase 2: evidence.** Collect human and agent sessions, train the agent-likelihood model, run the leak scan on the question bank, run the explain-gap pilot with hackers.
- **Phase 3: depth.**
  - LTI 1.3 launch from a Canvas instance, with grade passback.
  - Multilingual probes.
  - Calibration feedback for students.
  - Last-24h leak watch.
  - IRT difficulty calibration.
  - pyBKT mastery tracking across quizzes.
- **Phase 4: polish and story.** Demo script, video, Devpost write-up, deploy on Vultr, domain, DEV post.

---

## 9. Demo script (3 minutes at the table)
1. **Hook (20s):** split screen. A real browser agent takes a normal quiz, logged in as a student, and scores 10/10 in 40 seconds. "Canvas admits there's no technical fix."
2. **Agent Attack (30s):** the professor clicks "Attack my quiz". A heat map shows the per-question solve rate across 27 agent runs, plus 2 questions found online, with Bright Data screenshots.
3. **Verify (30s):** transformations stream in. One is rejected live ("changed the learning objective"), one is rejected ("agent still solves it 3 out of 3"), and one survives. The Neon branch graph shows experiments merging. Agent re-run: 10/10 drops to 2/10.
4. **ThinkAloud (60s):** the judge takes the quiz and rates confidence 6/7. The voice says, "You chose B. Walk me through it... now what changes if the sample doubled?" The judge answers and re-rates confidence (often lower). That is the illusion of explanatory depth, live.
5. **Professor view (30s):** the judge appears in the explain-gap matrix with quoted evidence. Next to them is an agent session flagged by its telemetry timeline (dead ranges, uniform timing), with the model's AUC and false-positive rate shown honestly.
6. **Close (10s):** "We don't detect AI. We make agents fail, and we make understanding visible."

### Judge Q&A prep
- **"Can't a voice agent fake the explanation?"** "Yes, in principle. We don't claim it's cheat-proof. We raise the cost, and we measure understanding: the counterfactual follow-up, confidence calibration and telemetry together. The professor makes the call, with evidence."
- **"Anxious students?"** Practice mode, a typed fallback, 2-probe cap, and Qi's UCSD findings that anxiety drops with practice.
- **"Is AI grading fair?"** Three separate graders then revise (the NYU method), professors approve everything, and content is graded, not fluency.
- **"Bias?"** "We never classify text style. Detectors flagged more than half of non-native essays (Liang 2023). We grade reasoning."
- **"How is this different from NYU's oral exam?"** "We attack the quiz with agents first and probe only where they succeed; we prove the question changes work; we add calibration and telemetry; we live inside Canvas."

---

## 10. Repo layout
```
thinkaloud/
  apps/web/               Next.js: professor + student UIs, LTI launch routes
  apps/runtime/           React quiz runtime, rrweb + telemetry SDK, ElevenLabs widget
  services/workflows/     Mastra workflows: ingest, redteam, leakscan, transform, probe, grade
  services/agents/        browser-use (Python) + Stagehand (TS) runners, Dockerized
  services/leakscan/      Bright Data SERP/Unlocker/Browser API/Archive clients
  services/models/        agent-likelihood training (Python), py-irt calibration
  db/neon/                schema + branch helpers
  db/tiger/               hypertables, continuous aggregates, hyperfunction queries
  infra/                  Vultr deploy, docker-compose
  data/                   sample quizzes (OpenStax-derived), consented pilot sessions (pseudonymized)
```

## 11. Risks and kill conditions
| Risk | Early test | Fallback |
|---|---|---|
| Agents can't reliably take our sandbox quiz | Phase 0 test 1 | Simplify the quiz UI; use Stagehand with explicit actions |
| Transforms don't lower the solve rate without changing the objective | Run 10 items in Phase 1 | Focus on probes; report the honest yield |
| Voice agent turn-taking feels clunky | Phase 0 test 2 | Pipecat with ElevenLabs TTS, or push-to-talk |
| Agent-likelihood model overfits to a small sample | Leave-one-person-out cross-validation | Show it as an "anomaly timeline", not a classifier |
| Bright Data restricts Quizlet or Reddit without KYC | Phase 0 test 3 | Use SERP snippets only, which are still evidence |
| A free Canvas instance is unavailable | Check early | Self-hosted canvas-lms Docker, or a Canvas-like sandbox |

## 12. Sources
- Agents in Canvas: [CVC white paper](https://www.cvc.edu/wp-content/uploads/2025/11/Safeguarding-Academic-Integrity-in-the-Age-of-Agentic-AI.pdf), [Futurism on Einstein](https://futurism.com/artificial-intelligence/ai-agent-canvas-homework), [Inside Higher Ed](https://www.insidehighered.com/index%2Ephp/node/203441), [Marc Watkins](https://marcwatkins.substack.com/p/einstein-and-the-rise-of-nuisance), [IgniteAI Agent](https://aiproductivity.ai/news/canvas-igniteai-agent-launch-blocks-grading/)
- Scale: [Cornell / Science 2026](https://news.cornell.edu/stories/2026/05/widespread-ai-misuse-means-higher-ed-must-rethink-assessment), [Berkeley CSHE](https://cshe.berkeley.edu/node/1878)
- Learning harm: [Bastani et al. PNAS 2025](https://ideas.repec.org/a/nas/journl/v122y2025pe2422633122.html), [MIT "Your Brain on ChatGPT"](https://www.media.mit.edu/publications/your-brain-on-chatgpt/), [Lee et al. CHI 2025](https://advait.org/files/lee_2025_ai_critical_thinking_survey.pdf)
- Psychology: [Illusion of explanatory depth review](https://pmc.ncbi.nlm.nih.gov/articles/PMC3735824), [Mills & Keil 2004](https://www.Gwern.net/doc/psychology/cognitive-bias/illusion-of-depth/2004-mills.pdf), [Pan & Rickard 2018](https://sc-pan.github.io/pdf/PR_2018.pdf), [Murdock & Anderman 2006 and follow-ups](https://pmc.ncbi.nlm.nih.gov/articles/PMC6702756)
- Oral exams: [Qi ASEE](https://peer.asee.org/board-400-the-impact-of-oral-exams-on-engineering-students-learning), [NYU arXiv 2603.18221](https://arxiv.org/abs/2603.18221), [WTOP/AP](https://wtop.com/education/2026/04/perfect-homework-blank-stares-why-colleges-are-turning-to-oral-exams-to-combat-ai/), [Fortune](https://fortune.com/2026/03/25/oral-exams-colleges-anti-ai-teaching-method-gen-z-stare/)
- Detection bias: [Liang et al. 2023](https://arxiv.org/abs/2304.02819)
- Telemetry and agents: [Keystroke dynamics arXiv 2511.12468](https://arxiv.org/abs/2511.12468), [FP-Agent](https://arxivlens.com/paperview/details/fp-agent-fingerprinting-ai-browsing-agents-107-4990a0ed), [Akamai](https://www.akamai.com/blog/security-research/2026/aug/identifying-agentic-automation-behavioral-telemetry), [HUMAN](https://www.humansecurity.com/learn/blog/ai-agent-signals-traffic-detection/), [BotD](https://github.com/fingerprintjs/botd), [rrweb](https://github.com/rrweb-io/rrweb)
- Item generation: [Chen 2025](https://www.arxiv.org/abs/2508.14755), [Liu et al. 2026](https://arxiv.org/abs/2602.05114), [Computational Blueprints](https://arxiv.org/abs/2511.07932)
- Tooling: [browser-use / Stagehand / Skyvern comparison](https://www.digitalapplied.com/blog/open-source-browser-computer-use-agents-2026), [PyLTI1p3](https://pypi.org/project/PyLTI1p3/), [qti2txt](https://pypi.org/project/qti2txt/), [text2qti](https://pypi.org/project/text2qti), [New Quizzes API](https://developerdocs.instructure.com/services/canvas/resources/new_quizzes), [py-irt](https://github.com/nd-ball/py-irt), [pyBKT](https://arxiv.org/abs/2105.00385), [Pipecat vs LiveKit](https://livekit.io/field-guides/guide/livekit-vs-pipecat)
- Competitors: [Coraltalk](https://www.cisontario.ca/sponsors/our-sponsors/details/~board/sponsors/post/coraltalk), [Explain It](https://business.oregonstate.edu/blog/faculty-research/explain-it-jonathan-kalodimos-new-ai-assisted-oral-evaluation-tool)

**Unverified items to check:** Canvas free teacher accounts; the full text of the "Will not" status on the request to block agents; ElevenLabs Agents client-tool latency for mid-quiz triggering; whether Bright Data restricts Quizlet or Reddit without KYC; the NYU paper's agreement rate with human graders (the abstract does not report it).

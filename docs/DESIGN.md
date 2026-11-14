# Unprompted: design system

Owner: D. Source material: Dat's design doc (`sand-hacks-context/dashboard-design-doc.md`, 21st.dev components) and the Azure Pro theme by Serafim. Read this before styling anything. If something you need is missing, ask D. Don't hand-style around it.

## 1. Direction

**A calm instrument.** Professors read dense evidence. Students are being asked to think out loud, which is stressful. So:

- **Professor views** (`/professor`, `/studio`): information-dense, tabular numbers, a sidebar shell, color used only to encode data.
- **Student views** (`/(student)`, `/course`, `/progress`): lots of whitespace, one focus per screen, the orb is the only moving thing on screen.
- **Color never accuses.** Red (`destructive`) is for system errors only, never for a student or a flag. Attention states use amber.

## 2. Tokens

### 2.1 Base palette: Azure Pro
Read from the live theme page (`21st.dev/@serafimcloud/themes/azure-pro`). The raw values are saved in `sand-hacks-context/azure-pro.css`. In `globals.css` every value is written as `oklch(L C H)`, keeping the shadcn variable names, so all shadcn components pick it up with no changes.

| Token | Light | Dark |
|---|---|---|
| background | `oklch(1 0 0)` | `oklch(0.137 0.036 258.526)` (deep navy) |
| foreground | `oklch(0.137 0.036 258.526)` | `oklch(0.984 0.003 247.858)` |
| primary | `oklch(0.546 0.215 262.872)` (azure) | `oklch(0.623 0.188 259.796)` |
| secondary / muted / accent | `oklch(0.968 0.007 247.895)` | `oklch(0.28 0.037 259.974)` |
| muted-foreground | `oklch(0.555 0.041 257.44)` | `oklch(0.711 0.035 256.788)` |
| border / input | `oklch(0.929 0.013 255.532)` | `oklch(0.28 0.037 259.974)` |
| destructive | `oklch(0.637 0.208 25.326)` | `oklch(0.396 0.133 25.721)` |
| chart-1..5 | an azure ramp, dark to light | an azure ramp, dark mode |
| sidebar-* | the full Azure Pro sidebar set | the same, dark mode |
| radius | `0.375rem` | |
| shadow | `0 4px 10px hsl(0 0% 0% / 0.1)` | |

### 2.2 Unprompted semantic tokens (added on top of Azure Pro)
Azure Pro is a single-hue palette, which is right for chrome but can't encode categories. These tokens carry the product's meaning. Each has a light/dark pair and a `-soft` background variant, and is exposed as a Tailwind color (`bg-understood`, `text-gap`, `bg-gap-soft` ...).

| Token | Meaning | Hue |
|---|---|---|
| `understood` | correct and explained (quadrant 1) | azure (`primary`) |
| `gap` | **explain gap**: correct but not explained (the signal) | amber, ~70° |
| `near-miss` | wrong but explained | teal, ~185° |
| `unexplained` | wrong and not explained | neutral slate (muted), never red |
| `leak` | the question was found online | orange, ~45° |
| `agent` | agent runs and agent sessions in charts and timelines | violet, ~295° |
| `human` | human sessions in timelines | azure |
| `verified` / `rejected` | transform outcomes | teal / slate (rejected is normal and shows a reason, so it isn't red) |

**Heat maps** (solve rate) use a sequential ramp: `chart-5` (0%) to `chart-1` (100%), with the numeric value printed in each cell, so the map never relies on color alone.

### 2.3 Typography
Azure Pro specifies **Inter** (UI) and **JetBrains Mono** (numbers, IDs, rates, transcripts' timestamps).

- Body 14px / 1.5, dense tables 13px, headings Inter 600 with `tracking-tight`.
- All numbers: `font-mono tabular-nums` (`.num` utility).
- The student probe prompt is 20px / 1.4, to keep it calm and readable.
- **Request to C:** the root layout loads Geist. Please swap to `Inter` → `--font-sans` and `JetBrains_Mono` → `--font-mono` via `next/font/google` (this is a 2-line change in your file).

### 2.4 Dark mode
`.dark` class on `<html>`, already wired by shadcn's `@custom-variant dark`. There's a toggle in the professor sidebar footer. Light is the default, and the demo runs in light (projectors wash out navy).

## 3. Components → screens

All design components live in `apps/web/components/ui/` (D owns them). Domain compositions live in `apps/web/components/dashboard/` (also D).

| Component (from the design doc) | File | Used for | Changes from the 21st.dev source |
|---|---|---|---|
| **Sidebar (Dashboard)** | `ui/sidebar-shell.tsx` | Professor shell for `/professor` and `/studio`: Overview, Studio, Gradebook, Leaks, Sessions; theme toggle and the course switcher at the bottom | `framer-motion` → `motion/react`; hard-coded `neutral-*` → `sidebar-*` tokens; the avatar is the Orb Avatar, not an Unsplash photo; collapses to an icon rail (`3rem`). Named `sidebar-shell` so it doesn't clash with shadcn's own `sidebar`. |
| **Agent State** (Cojeev) | `ui/agent-state.tsx` | Studio: one per agent runner during "Attack my quiz" (`working` → `complete`/`error`), and the transform pipeline: `thinking` = generating, `working` = verifying, `needs-input` = waiting for professor approval, `complete` = verified. Rejected candidates show `complete` with the label "Rejected" and the reason under it. | **Scoped its CSS.** As shipped, it injects `:root` tokens and an `@layer base` rule on every `[data-slot]` element, which sets font and color and resets borders across every shadcn base-nova component in the app. We keep only its `--v-*` palette and `agent-state` rules, scoped under `[data-slot="agent-state"]`, and drop the localStorage motion-settings runtime. The palette is re-pointed to our tokens (`--v-blue` → azure, `--v-olive` → `verified`, `--v-yellow` → `gap`). |
| **Siri Orb** | `ui/siri-orb.tsx` | **Voice probe (C).** The orb is the interviewer: `animationDuration` 6s while it speaks, 20s while listening, and paused (via `prefers-reduced-motion`) for the typed fallback. Also the large hero on the `/` landing page. | Colors are set from tokens (`bg` = background, `c1` = primary, `c2` = chart-2, `c3` = `agent`), so it follows dark mode. |
| **AI Orb Avatar** | `ui/orb-avatar.tsx` | The interviewer's identity at small sizes: the transcript bubbles in the probe, quoted evidence in the professor drawer, the sidebar logo mark. `color="blue"`, `size="sm"`. | Renamed from `components-primitives-avatar`. `whileTap` removed (it's not a button). |
| **AI Chat Empty State** (illos) | `ui/empty-state.tsx` | Empty states with a call to action: Studio before any quiz is imported ("Import a quiz": paste Markdown, upload QTI, connect Canvas, use the sample stats quiz); `/professor` before any attempts exist. | The chat input becomes an optional slot. The suggestion chips become actions. The WebGL "streaming tokens" art is only drawn when visible (it already self-pauses), and appears at most once per page. The license allows use in client projects; don't redistribute it. |
| **TanStack complex table** (Origin UI) | `ui/data-table.tsx` (+ shadcn `table`) | Gradebook, the explain-gap list view, sessions, leak findings, variant experiments | The verbatim source couldn't be retrieved (21st.dev renders it client-side). It's rebuilt in the same pattern: `@tanstack/react-table` + shadcn `table`, with column sorting, column visibility, a faceted filter, pagination and row selection. |
| **Charts** | shadcn `chart` (Recharts) | Calibration chart, resistance history, AUC/ROC | `chart-1..5` + semantic tokens |

### 3.1 Screen inventory

| Route | Owner | Layout | Main pieces |
|---|---|---|---|
| `/` | C | Centered hero | Siri Orb, one-line thesis, two entry buttons (Professor, Student) |
| `/studio` | B | Sidebar shell | Empty State → import; agent attack grid (one Agent State per runner + live solve-rate heat map); a stream of variant cards (Agent State + reason + Approve button); a Neon branch list |
| `/professor` | D | Sidebar shell | KPI row; solve-rate heat map; leak alerts; explain-gap matrix; session timelines; resistance history |
| `/professor/sessions/[id]` | D | Sidebar shell | Telemetry swim lanes (key, paste, focus, pointer, answer) with dead ranges shaded `agent-soft`; agent-likelihood with its top features; "Suggest a follow-up chat" |
| `/(student)/quiz/...` | C | Focused, no sidebar | One question per screen, progress bar; the probe takes over the card: confidence slider 1-7 → orb + live transcript → counterfactual → confidence again |
| `/progress` | D | Focused | Calibration chart (confidence before vs after vs actual, per question), "what to review", mastery framing |

### 3.2 `/professor` detail (demo beat 5)
1. **KPI row** (4 cards, mono numbers): agent solve rate before → after; variants verified / generated; questions found online; explain gaps this quiz.
2. **Solve-rate heat map:** rows are questions, columns are agent × model, cells show the solve rate, with the original vs variant toggle. Hover shows the runs (n, seconds, steps).
3. **Leak alerts:** a TanStack table of question, source badge (Quizlet, Reddit, Chegg...), match score bar, snippet, and screenshot thumbnail. A drawer opens the evidence.
4. **Explain-gap matrix:**
   - (a) a 2x2 quadrant summary with counts;
   - (b) a student × question grid where each cell has its quadrant color plus a glyph (✓ explained, ◐ gap, ↺ near miss, · unexplained), so it isn't color-only.
   - Clicking a cell opens the evidence drawer: the transcript quote with the orb avatar, council scores, counterfactual latency, confidence before → after.
5. **Session timelines:** a sparkline lane per attempt. The agent-likelihood chip reads "Pattern differs from typical sessions, suggest a follow-up chat", never "cheating", and always shows the model's AUC and false-positive rate beside it.
6. **Resistance history:** per question, the original solve rate → each variant's, as a small slope chart.

## 4. Motion
- One library: `motion` (`motion/react`). No `framer-motion` import anywhere.
- UI transitions are 150-250ms, ease-out. Lists stagger 30ms (for the variant stream in Studio, the "live" feel of demo beat 3).
- **At most one continuous animation per view** (the orb, or the Agent States in Studio). They pause off-screen and when the tab is hidden; Agent State already does this, and the orb follows the same rule.
- All motion respects `prefers-reduced-motion`: the orb becomes a static gradient, Agent State shows still silhouettes, and the WebGL art shows its still frame.
- 8 GB machine: no WebGL outside the empty state; no particle effects.

## 5. Copy rules
- The product is **Unprompted**. The probe is the "think-aloud".
- Never "cheater", "suspicious", "caught". Use "explain gap", "pattern differs", "suggest a follow-up chat".
- No em dashes in UI copy. Use commas or periods.
- Every view backed by fixture data shows a `Sample data` badge (`ui/sample-badge.tsx`) until it reads from the DB.

## 6. What we cut
- Agent State's global CSS, its motion-settings store (localStorage, flow variants, morph tiers) and its unrelated tokens (`--cat-*`, `--dock-*` ...).
- The Siri Orb and Orb Avatar demo files, and the sidebar demo's Unsplash avatar and links.
- The chat input on the empty state, except where a real text input is needed.
- Glow and shimmer on data. Charts stay flat.
- A custom font for headings. Inter everywhere is enough.

## 7. Requests to other workstreams
- **C (root layout):**
  - Move the global `<header>` nav and the `max-w-5xl` `<main>` wrapper out of `app/layout.tsx` and into the student/course layouts, so `/professor` and `/studio` can use the full-width sidebar shell (D adds `app/professor/layout.tsx`; B uses the same shell in `app/studio/layout.tsx`).
  - Swap the fonts (see 2.3).
- **Everyone:** don't run `shadcn add` into `components/ui` yourselves; ask D, who will add it and push within minutes. D is adding now: `table`, `chart`, `sheet`, `tooltip`, `tabs`, `dropdown-menu`, `skeleton`, `slider`, `avatar`, `scroll-area`, `switch`.

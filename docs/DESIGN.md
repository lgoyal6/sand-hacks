# Unprompted: design system

Owner: D. Live gallery: **`/professor/design`**. If something is missing, ask D rather than hand-styling.

## Direction
- **Canvas-familiar structure, our own look.** A slim navy global nav rail on the far left, a course sub-nav (Home, Assignments, Quizzes, Grades, Studio), and a white content area with breadcrumbs, a plain title and simple list/card rows. Don't use Instructure's logo, name or colors.
- **White and quiet.** White background, thin light-gray borders, lots of whitespace. One accent (Azure Pro blue) for primary buttons, the active nav item, links and focus rings. Light mode is the priority; dark tokens exist but are optional.
- **Color never accuses.** Red (`destructive`) is only for system errors, never for a student, a flag or a rejected variant.

## Tokens (`apps/web/app/globals.css`)
- **Base: Azure Pro** (21st.dev/@serafimcloud/themes/azure-pro, read from the live page; raw values in `sand-hacks-context/azure-pro.css`). The shadcn variable names are unchanged. `primary` is `oklch(0.546 0.215 262.872)`, border is `oklch(0.929 0.013 255.532)`, radius is `0.375rem`.
- **Rail:** `bg-rail`, `text-rail-foreground`, `text-rail-muted` (Azure Pro navy).
- **Semantic** (each has a `-soft` background): `understood` (azure), `gap` (amber, the explain gap), `near-miss` (teal), `unexplained` (slate), `leak` (orange), `agent` (violet), `human` (azure), `verified` (teal-green), `rejected` (slate). Use them as `bg-gap-soft text-gap`.
- **Type:** Inter for UI, JetBrains Mono for numbers. Use the `.num` class (mono, tabular) for every rate, score, count and ID. Until the root layout loads Inter, it falls back to whatever font `next/font` set.
- **Heat maps:** `chart-5` (0%) to `chart-1` (100%), always with the value printed in the cell.

## Layout
`AppShell` from `@/components/ui/app-shell` on every page:
```tsx
<AppShell course={{ name, term, nav: PROFESSOR_COURSE_NAV /* or STUDENT_COURSE_NAV */ }}
  breadcrumbs={[{ label: "Intro Statistics", href: "/course" }, { label: "Quizzes" }]}
  title="Quizzes" actions={<Button>...</Button>} wide={false}>
```
The root layout should be bare (no header, no max-width); C owns it.

## Which component goes where
| Component (from Dat's design doc) | Import | Where |
|---|---|---|
| Sidebar (Dashboard) | `sidebar-rail` (used inside `AppShell`) | The global nav rail: icon over label, expands on hover |
| Siri Orb | `VoiceOrb` from `siri-orb` (`state: idle / listening / thinking / speaking`) | Voice probe (C) |
| AI Orb Avatar | `OrbAvatar` from `orb-avatar` | The interviewer in transcript bubbles and quoted evidence; the logo mark |
| Agent State | `AgentState` from `agent-state` | Studio agent runs and the transform pipeline (B), A's replay. A rejected variant is `status="complete" tone="muted" label="Rejected"` |
| AI Chat Empty State | `EmptyState` from `empty-state` | First-run states: no quiz yet, no attempts yet, the probe intro. `compact` hides the animated art |
| TanStack complex table | `DataTable` from `data-table` (TanStack v8) | Gradebook, explain-gap list, agent runs, leak findings, variant experiments |
| (ours) | `SampleBadge` from `sample-badge` | Required on every view that shows fixture data |

Also installed from shadcn: button, card, badge, input, textarea, checkbox, radio-group, label, progress, separator, table, chart (Recharts), sheet, tooltip, tabs, dropdown-menu, skeleton, slider, avatar, scroll-area, switch, breadcrumb.

## Changes from the 21st.dev sources
- **Agent State** shipped a global `:root` token sheet, an `@layer base` rule that restyled every `[data-slot]` element (that's every shadcn base-nova component), web fonts from a CDN, and a localStorage motion runtime that writes to `<html>`. All of that is removed. Its CSS is scoped to `[data-slot="agent-state"]`, and its colors come from our tokens.
- **Sidebar** uses `motion/react` instead of `framer-motion`, and themed tokens instead of `neutral-*`.
- **Orbs:** themed colors and scoped keyframe names.
- **Empty state:** actions instead of chat suggestions; the input is optional.
- **Table:** the Origin UI source couldn't be retrieved (21st.dev renders it client-side), so it's rebuilt in the same pattern.

## Motion and copy
- `motion` only, 150-250ms UI transitions. At most one continuous animation per view. Everything respects `prefers-reduced-motion`.
- Say "explain gap", "pattern differs", "suggest a follow-up chat". Never "cheater" or "suspicious". No em dashes in UI copy. The product is "Unprompted".

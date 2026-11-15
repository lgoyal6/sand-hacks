# Unprompted: design (owner: D)

**Look:** Grok-style, light. A learning chat first: a calm conversation in the center, a minimal near-white sidebar on the left, and a quiet Agents panel on the right. White background, near-black text, Inter at 15px, hairline borders, rounded-2xl and larger, no dark surfaces, and no gradients except the voice orb. Copy never mentions cheating or detection on student screens.

**Tokens** (`apps/web/app/globals.css`): neutral grays. `primary` is near-black, used for main actions and the send button. `brand` is Azure Pro blue, used only for focus, links and the active agent. Semantic colors, each with a `-soft` background: `understood`, `gap`, `near-miss`, `unexplained`, `leak`, `agent`, `verified`, `rejected`. Use `.num` for numbers.

**Primitives** (`@/components/ui/chat`):
| Primitive | Use |
|---|---|
| `ChatLayout` | The page frame: `sidebar`, `agents`, `empty`, `home` (greeting and chips), `composer`, `composerNote`, `title`. While `empty`, the composer is vertically centered; after the first message it glides to the bottom. |
| `ChatSidebar` | Logo, New session, search, history grouped by day, links, profile. Collapses to icons. |
| `Thread`, `Message` | A centered 720px column. `tutor`/`assistant` render as plain text (hover: copy, regenerate), `student`/`user` as a gray bubble. `agentName` adds a label. `Thinking` is the quiet dots. |
| `QuestionCard` | A question inline in the thread: built-in options or input, or your own `children` and `footer` (stable ids). |
| `Composer` | Pill input with mic and attach, round send button. `textareaId` and `submitId` keep ids stable. `voice={{state, transcript, onStop, onSwitchToTyping}}` swaps in the Siri Orb, which is the only place the orb appears. |
| `AgentPanel` | Rows of name, one-line status and a state mark; only the active agent animates. It listens for `unprompted:agent-status` window events. |

Non-chat pages (dashboards) use `AppShell` from `@/components/ui/app-shell`: the same sidebar, a plain title, white content. Tables use `DataTable` (TanStack v8, already Suspense-wrapped). Use `SampleBadge` on fixture-only views. Live reference: `/professor/design`.

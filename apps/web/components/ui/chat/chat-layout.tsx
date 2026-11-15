"use client";
// Three-column chat shell: minimal sidebar | centered conversation | quiet Agents panel.
// The composer starts vertically centered under a greeting (empty state) and glides to the bottom once the
// conversation starts, as in Grok.
import * as React from "react";
import { LayoutGroup, motion } from "motion/react";
import { PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatSidebar, type ChatSidebarProps } from "./chat-sidebar";
import { AgentPanel, type AgentInfo } from "./agent-panel";

export interface ChatLayoutProps {
  sidebar: Omit<ChatSidebarProps, "collapsed" | "onCollapsedChange">;
  /** Agents for the right panel. Omit to hide the panel entirely. */
  agents?: AgentInfo[];
  activeAgentId?: string;
  /** Thread content. When empty (no messages yet), `home` is shown with the composer centered. */
  children?: React.ReactNode;
  empty: boolean;
  /** Greeting + chips shown above/below the centered composer in the empty state. */
  home?: { greeting: React.ReactNode; sub?: React.ReactNode; chips?: React.ReactNode };
  composer: React.ReactNode;
  /** Small note under the composer (e.g. "Practice mode"). */
  composerNote?: React.ReactNode;
  /** Optional top bar content in the center column (e.g. session title). */
  title?: React.ReactNode;
}

export function ChatLayout({ sidebar, agents, activeAgentId, children, empty, home, composer, composerNote, title }: ChatLayoutProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [agentsOpen, setAgentsOpen] = React.useState(true);

  return (
    <div className="flex h-svh w-full overflow-hidden bg-background">
      <ChatSidebar {...sidebar} collapsed={collapsed} onCollapsedChange={setCollapsed} />

      <LayoutGroup>
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between px-4">
            <div className="min-w-0 truncate text-sm text-muted-foreground">{title}</div>
            {agents && !agentsOpen && (
              <button
                type="button"
                onClick={() => setAgentsOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <PanelRightOpen className="size-4" /> Agents
              </button>
            )}
          </div>

          {empty ? (
            <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[12vh]">
              <div className="w-full max-w-[720px]">
                {home && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="mb-7 text-center">
                    <h1 className="text-[28px] font-semibold tracking-tight">{home.greeting}</h1>
                    {home.sub && <p className="mt-2 text-[15px] text-muted-foreground">{home.sub}</p>}
                  </motion.div>
                )}
                <motion.div layoutId="unprompted-composer" transition={{ type: "spring", stiffness: 260, damping: 30 }}>
                  {composer}
                </motion.div>
                {home?.chips && <div className="mt-4 flex flex-wrap justify-center gap-2">{home.chips}</div>}
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto">{children}</div>
              <div className="shrink-0 px-4 pb-4">
                <div className="mx-auto w-full max-w-[720px]">
                  <motion.div layoutId="unprompted-composer" transition={{ type: "spring", stiffness: 260, damping: 30 }}>
                    {composer}
                  </motion.div>
                  {composerNote && <p className="mt-2 text-center text-xs text-muted-foreground">{composerNote}</p>}
                </div>
              </div>
            </>
          )}
        </main>
      </LayoutGroup>

      {agents && agentsOpen && (
        <AgentPanel agents={agents} activeId={activeAgentId} onClose={() => setAgentsOpen(false)} className="hidden lg:flex" />
      )}
    </div>
  );
}

/** Suggestion chip for the empty state. */
export function Chip({ children, onClick, icon }: { children: React.ReactNode; onClick?: () => void; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border border-border bg-background px-3.5 text-sm text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:text-muted-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

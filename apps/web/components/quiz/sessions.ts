"use client";
// Recent learning sessions for the chat sidebar. Per-browser convenience only (localStorage);
// the attempts themselves live on the server. Sessions with no answers are hidden.
import { useEffect, useState } from "react";
import type { SidebarGroup } from "@/components/ui/chat";

export interface SessionItem {
  id: string;
  quizId: string;
  title: string;
  mode: "practice" | "graded";
  startedAt: string;
  answered?: number;
}

const KEY = "unprompted:sessions";
const EVENT = "unprompted:sessions-changed";

function read(): SessionItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as SessionItem[];
  } catch {
    return [];
  }
}

function write(list: SessionItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 40)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage unavailable: the sidebar just stays empty */
  }
}

export function rememberSession(s: SessionItem) {
  write([s, ...read().filter((x) => x.id !== s.id)]);
}

export function markAnswered(id: string) {
  write(read().map((x) => (x.id === id ? { ...x, answered: (x.answered ?? 0) + 1 } : x)));
}

function group(list: SessionItem[]): SidebarGroup[] {
  const today = new Date().toDateString();
  const item = (x: SessionItem) => ({
    id: x.id,
    title: `${x.title} · ${x.mode === "practice" ? "Practice" : "Graded"}`,
    href: `/quiz/${x.quizId}?mode=${x.mode}`,
    subtitle: new Date(x.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  });
  const shown = list.filter((x) => (x.answered ?? 0) > 0);
  return [
    { label: "Today", items: shown.filter((x) => new Date(x.startedAt).toDateString() === today).map(item) },
    { label: "Earlier", items: shown.filter((x) => new Date(x.startedAt).toDateString() !== today).map(item) },
  ].filter((g) => g.items.length);
}

/** Sidebar groups for D's ChatSidebar, computed outside render (dates and storage are browser-only). */
export function useSessionGroups() {
  const [groups, setGroups] = useState<SidebarGroup[]>([]);
  useEffect(() => {
    const sync = () => setGroups(group(read()));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return groups;
}

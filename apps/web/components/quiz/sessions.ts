"use client";
// Recent learning sessions for the chat sidebar. Per-browser convenience only (localStorage);
// the attempts themselves live on the server.
import { useEffect, useState } from "react";

export interface SessionItem {
  id: string;
  quizId: string;
  title: string;
  mode: "practice" | "graded";
  startedAt: string;
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

export function rememberSession(s: SessionItem) {
  try {
    const next = [s, ...read().filter((x) => x.id !== s.id)].slice(0, 30);
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage unavailable: the sidebar just stays empty */
  }
}

// For D's Sidebar: items={sessions.map(s => ({ id: s.id, title: s.title, href: `/quiz/${s.quizId}`, subtitle: s.mode }))}
export function useSessions() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  useEffect(() => {
    const sync = () => setSessions(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return sessions;
}

// Client side of studio replay mode (owner: B).
// ?replay=1 on /studio sets a cookie that every studio API route reads; ?replay=0 clears it.
// Any response marked X-Studio-Replay raises a "studio:replay" event so the page shows the badge.

export function syncReplayCookie() {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams(window.location.search).get("replay");
  if (p === "1") document.cookie = "studio_replay=1; path=/; SameSite=Lax";
  if (p === "0") document.cookie = "studio_replay=; path=/; max-age=0; SameSite=Lax";
}

export function replayCookieOn() {
  return typeof document !== "undefined" && /(?:^|;\s*)studio_replay=1(?:;|$)/.test(document.cookie);
}

export function noteReplay(res: Response) {
  const at = res.headers.get("X-Studio-Replay");
  if (at && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("studio:replay", { detail: { recordedAt: at, reason: res.headers.get("X-Studio-Replay-Reason") ?? undefined } }));
  return res;
}

/** fetch() that reports replayed responses. */
export async function studioFetch(input: string, init?: RequestInit) {
  return noteReplay(await fetch(input, init));
}

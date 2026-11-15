"use client";
// Unprompted telemetry SDK (browser side).
// Custom listeners -> InteractionEvent batches -> POST /api/telemetry/<attemptId>.
// rrweb session recording -> POST /api/telemetry/<attemptId>/rrweb.
// What we never record: the characters a student types (only timing and a coarse key class),
// or the text they paste (only its length). Signals are evidence for a conversation, never a verdict.
import type { InteractionEvent, InteractionKind } from "@unprompted/shared";

type Payload = Record<string, unknown>;

export interface TelemetryOptions {
  attemptId: string;
  getItemId: () => string | undefined;
  endpoint?: string;
  recordSession?: boolean; // rrweb, default true
  flushMs?: number;
}

export interface TelemetryHandle {
  emit: (kind: InteractionKind, payload?: Payload, itemId?: string) => void;
  flush: () => void;
  stop: () => void;
}

function keyClass(e: KeyboardEvent): string {
  if (e.key === "Backspace" || e.key === "Delete") return "delete";
  if (e.key === "Enter") return "enter";
  if (e.key === "Tab") return "tab";
  if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") return "nav";
  if (e.metaKey || e.ctrlKey) return "shortcut";
  if (e.key.length === 1) return /\d/.test(e.key) ? "digit" : /\s/.test(e.key) ? "space" : "char";
  return "other";
}

function targetId(t: EventTarget | null): string | undefined {
  const el = t as HTMLElement | null;
  if (!el || !("tagName" in el)) return undefined;
  return el.id || el.getAttribute?.("name") || el.tagName.toLowerCase();
}

export function startTelemetry(opts: TelemetryOptions): TelemetryHandle {
  const endpoint = opts.endpoint ?? `/api/telemetry/${encodeURIComponent(opts.attemptId)}`;
  const queue: InteractionEvent[] = [];
  const rrQueue: unknown[] = [];
  const t0 = performance.now();
  let lastKeyAt: number | null = null;
  let lastPointerAt = 0;
  let lastScrollAt = 0;
  let pointerSegment: [number, number, number][] = [];
  let stopped = false;
  let stopRecording: (() => void) | undefined;

  const emit = (kind: InteractionKind, payload: Payload = {}, itemId?: string) => {
    if (stopped) return;
    queue.push({
      ts: new Date().toISOString(),
      attemptId: opts.attemptId,
      itemId: itemId ?? opts.getItemId(),
      kind,
      payload: { ...payload, t: Math.round(performance.now() - t0) },
    });
    if (queue.length >= 50) flush();
  };

  const send = (url: string, body: unknown, beacon: boolean) => {
    const json = JSON.stringify(body);
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([json], { type: "application/json" }));
      return;
    }
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: json, keepalive: json.length < 60000 }).catch(() => {});
  };

  const flushPointer = () => {
    if (pointerSegment.length < 2) return void (pointerSegment = []);
    emit("pointer", { type: "move", points: pointerSegment });
    pointerSegment = [];
  };

  const flush = (beacon = false) => {
    flushPointer();
    if (queue.length) send(endpoint, { events: queue.splice(0) }, beacon);
    if (rrQueue.length) send(`${endpoint}/rrweb`, { events: rrQueue.splice(0, 500) }, beacon);
  };

  const onKey = (e: KeyboardEvent) => {
    const now = performance.now();
    emit("key", { cls: keyClass(e), dt: lastKeyAt === null ? null : Math.round(now - lastKeyAt), trusted: e.isTrusted, target: targetId(e.target), repeat: e.repeat });
    lastKeyAt = now;
  };
  const onPaste = (e: ClipboardEvent) => {
    emit("paste", { length: e.clipboardData?.getData("text")?.length ?? 0, trusted: e.isTrusted, target: targetId(e.target) });
  };
  const onFocus = () => emit("focus", { type: "window" });
  const onBlur = () => emit("blur", { type: "window" });
  const onVisibility = () => emit(document.visibilityState === "hidden" ? "blur" : "focus", { type: "visibility" });
  const onPointerMove = (e: PointerEvent) => {
    const now = performance.now();
    if (now - lastPointerAt < 50) return; // ~20 Hz sample
    lastPointerAt = now;
    pointerSegment.push([Math.round(e.clientX), Math.round(e.clientY), Math.round(now - t0)]);
    if (pointerSegment.length >= 40) flushPointer();
  };
  const onPointerDown = (e: PointerEvent) => {
    flushPointer();
    emit("pointer", { type: "down", x: Math.round(e.clientX), y: Math.round(e.clientY), button: e.button, pointerType: e.pointerType, trusted: e.isTrusted, target: targetId(e.target) });
  };
  const onClick = (e: MouseEvent) => {
    // Synthetic .click() calls arrive with no preceding pointerdown and often screen coords of 0,0.
    emit("pointer", { type: "click", x: Math.round(e.clientX), y: Math.round(e.clientY), detail: e.detail, trusted: e.isTrusted, target: targetId(e.target) });
  };
  const onScroll = () => {
    const now = performance.now();
    if (now - lastScrollAt < 150) return;
    lastScrollAt = now;
    emit("scroll", { y: Math.round(window.scrollY), max: document.documentElement.scrollHeight - window.innerHeight });
  };
  const onSelect = () => {
    const len = document.getSelection()?.toString().length ?? 0;
    if (len > 0) emit("select", { length: len });
  };
  const onCopy = () => emit("select", { type: "copy", length: document.getSelection()?.toString().length ?? 0 });
  const onPageHide = () => {
    emit("blur", { type: "pagehide" });
    flush(true);
  };

  let selectTimer: ReturnType<typeof setTimeout> | undefined;
  const onSelectionChange = () => {
    clearTimeout(selectTimer);
    selectTimer = setTimeout(onSelect, 400);
  };

  window.addEventListener("keydown", onKey, true);
  window.addEventListener("paste", onPaste, true);
  window.addEventListener("copy", onCopy, true);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("selectionchange", onSelectionChange);
  window.addEventListener("pagehide", onPageHide);
  const timer = setInterval(() => flush(), opts.flushMs ?? 2000);

  // Session start: environment facts plus BotD (open-source automation detection), as evidence only.
  emit("focus", {
    type: "session_start",
    webdriver: navigator.webdriver ?? null,
    hasFocus: document.hasFocus(),
    viewport: [window.innerWidth, window.innerHeight],
    screen: [window.screen.width, window.screen.height],
    languages: navigator.languages?.length ?? 0,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
  });
  import("@fingerprintjs/botd")
    .then(({ load }) => load())
    .then((botd) => botd.detect())
    .then((r) => emit("focus", { type: "botd", bot: r.bot, botKind: "botKind" in r ? r.botKind : null }))
    .catch((err) => emit("focus", { type: "botd", error: String(err).slice(0, 200) }));

  if (opts.recordSession !== false) {
    import("rrweb")
      .then(({ record }) => {
        if (stopped) return;
        stopRecording = record({
          emit: (ev) => {
            rrQueue.push(ev);
            if (rrQueue.length >= 500) flush();
          },
          maskAllInputs: true, // the replay shows that an answer changed, not what was typed
          sampling: { mousemove: 50, scroll: 150, input: "last" },
          checkoutEveryNms: 60_000,
        });
      })
      .catch(() => {});
  }

  return {
    emit,
    flush: () => flush(),
    stop: () => {
      if (stopped) return;
      flush(true);
      stopped = true;
      stopRecording?.();
      clearInterval(timer);
      clearTimeout(selectTimer);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("paste", onPaste, true);
      window.removeEventListener("copy", onCopy, true);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("pagehide", onPageHide);
    },
  };
}

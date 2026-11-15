"use client";
import { useEffect, useRef } from "react";
import type { InteractionKind } from "@unprompted/shared";
import { startTelemetry, type TelemetryHandle } from "./client";

// Starts telemetry once an attempt exists; stops on unmount or when the attempt ends.
export function useTelemetry(attemptId: string | null, itemId: string | undefined, active = true) {
  const handle = useRef<TelemetryHandle | null>(null);
  const itemRef = useRef(itemId);
  useEffect(() => {
    itemRef.current = itemId;
  }, [itemId]);
  useEffect(() => {
    if (!attemptId || !active) return;
    handle.current = startTelemetry({ attemptId, getItemId: () => itemRef.current });
    return () => {
      handle.current?.stop();
      handle.current = null;
    };
  }, [attemptId, active]);
  return {
    emit: (kind: InteractionKind, payload?: Record<string, unknown>, item?: string) => handle.current?.emit(kind, payload, item),
    flush: () => handle.current?.flush(),
  };
}

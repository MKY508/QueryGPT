"use client";

import { useCallback, useRef } from "react";

/** Reject overlapping writes at the event boundary, before buttons rerender. */
export function useSettingsWriteGuard() {
  const pending = useRef(false);
  return useCallback(async <T,>(write: () => Promise<T>): Promise<T> => {
    if (pending.current) throw new Error("Settings write already in progress");
    pending.current = true;
    try {
      return await write();
    } finally {
      pending.current = false;
    }
  }, []);
}

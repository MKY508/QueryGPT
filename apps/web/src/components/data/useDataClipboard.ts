"use client";

import { useSyncExternalStore } from "react";

// A browser write outlives a details pane or selection toolbar. Keep this gate
// outside those components so reopening them cannot start a competing write.
let pending = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => pending;
const serverSnapshot = () => false;
const publish = (value: boolean) => {
  pending = value;
  for (const listener of listeners) listener();
};

async function write(value: () => string): Promise<boolean> {
  if (pending) return false;
  publish(true);
  try {
    // Do not queue or defer: invoke the browser API within the user's gesture.
    await navigator.clipboard.writeText(value());
    return true;
  } finally {
    publish(false);
  }
}

export function useDataClipboard() {
  return { copying: useSyncExternalStore(subscribe, snapshot, serverSnapshot), write };
}

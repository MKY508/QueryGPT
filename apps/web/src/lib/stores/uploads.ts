"use client";

import { create } from "zustand";
import type { UploadSnapshot } from "@/lib/upload-state";

// Keep high-frequency progress separate from the large project workspace store.
export const useUploadQueueStore = create<{
  byProject: Record<string, UploadSnapshot>;
  recovery: "idle" | "loading" | "ready" | "error";
}>(() => ({ byProject: {}, recovery: "idle" }));

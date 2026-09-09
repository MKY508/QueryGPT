"use client";

import { useEffect, useRef, useState } from "react";
import { readDesktopAppInfo } from "@/lib/desktop-app-info";
import { checkForUpdate, type ReleaseUpdate } from "@/lib/releases";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface RuntimeInfo {
  version: string;
  isPackaged: boolean;
  platform?: string;
}

type UpdateState =
  | { status: "idle" | "checking" | "error" }
  | { status: "done"; release: ReleaseUpdate };

/** Owns the page's reads; UI actions are derived from a single update state. */
export function useAboutRuntime() {
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>({ status: "idle" });
  const updateRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const desktop = await readDesktopAppInfo();
        if (controller.signal.aborted) return;
        if (desktop) {
          setRuntimeInfo(desktop);
          return;
        }
      } catch {
        // The browser preview can read its version from the local service.
      }
      if (controller.signal.aborted) return;
      try {
        const response = await fetch(`${API_URL}/health`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (!controller.signal.aborted && payload && typeof payload === "object" &&
            "version" in payload && typeof payload.version === "string" && payload.version.trim()) {
          setRuntimeInfo({ version: payload.version.trim(), isPackaged: false });
        }
      } catch {
        // An unavailable version must not imply a preview or successful update check.
      }
    };
    void load();
    return () => {
      controller.abort();
      updateRequest.current?.abort();
    };
  }, []);

  const checkUpdates = async () => {
    if (!runtimeInfo?.isPackaged || updateRequest.current) return;
    const controller = new AbortController();
    updateRequest.current = controller;
    setUpdateState({ status: "checking" });
    try {
      const release = await checkForUpdate(runtimeInfo.version, controller.signal);
      if (!controller.signal.aborted) setUpdateState({ status: "done", release });
    } catch {
      if (!controller.signal.aborted) setUpdateState({ status: "error" });
    } finally {
      if (updateRequest.current === controller) updateRequest.current = null;
    }
  };

  return { runtimeInfo, updateState, checkUpdates };
}

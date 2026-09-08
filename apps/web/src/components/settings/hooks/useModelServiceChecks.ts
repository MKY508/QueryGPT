"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { ModelTestResult } from "@/lib/settings/models";
import type { ModelServiceCheck } from "@/lib/settings/model-service";

/** A check belongs to one saved service. Edits invalidate only that service's receipt. */
export function useModelServiceChecks() {
  const [checks, setChecks] = useState<Record<string, ModelServiceCheck>>({});
  const requests = useRef(new Map<string, symbol>());
  const mounted = useRef(true);
  const client = useQueryClient();

  useEffect(() => {
    mounted.current = true;
    const pending = requests.current;
    return () => { mounted.current = false; pending.clear(); };
  }, []);

  const invalidateCheck = useCallback((id: string) => {
    requests.current.delete(id);
    setChecks(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const checkModel = useCallback((id: string, afterSave = false) => {
    if (!mounted.current || requests.current.has(id)) return;
    const request = Symbol(id);
    requests.current.set(id, request);
    setChecks(current => ({ ...current, [id]: { status: "checking" } }));

    void (async () => {
      try {
        const response = await api.post(`/api/v1/config/models/${id}/test`);
        if (requests.current.get(id) !== request) return;
        const result = { ...response.data.data, id } as ModelTestResult;
        setChecks(current => ({ ...current, [id]: { status: "complete", result } }));
      } catch {
        if (requests.current.get(id) !== request) return;
        setChecks(current => ({ ...current, [id]: { status: "failed", afterSave } }));
      } finally {
        if (requests.current.get(id) === request) {
          requests.current.delete(id);
          void client.invalidateQueries({ queryKey: ["models"] });
        }
      }
    })();
  }, [client]);

  return { checks, checkModel, invalidateCheck };
}

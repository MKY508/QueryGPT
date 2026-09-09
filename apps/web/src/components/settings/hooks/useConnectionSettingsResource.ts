"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { type ConnectionFormData } from "@/lib/settings/connections";
import type { ConfiguredConnection } from "@/lib/types/api";
import { useSettingsWriteGuard } from "./useSettingsWriteGuard";

export interface ConnectionSettingsResourceMessages {
  success: string;
  failure: string;
  requestFailure: string;
}

export interface LocalizedConnectionTestResult {
  id: string;
  success: boolean;
  text: string;
}

export function useConnectionSettingsResource(
  messages: ConnectionSettingsResourceMessages,
  active = true,
) {
  const [testResult, setTestResult] =
    useState<LocalizedConnectionTestResult | null>(null);
  const testResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();
  const guardWrite = useSettingsWriteGuard();
  const checkRevision = useRef(0);
  const [error, setError] = useState<"saveFailed" | "deleteFailed" | null>(null);

  useEffect(
    () => () => {
      checkRevision.current += 1;
      if (testResultTimerRef.current) {
        clearTimeout(testResultTimerRef.current);
      }
    },
    []
  );

  const showTestResult = (result: LocalizedConnectionTestResult) => {
    if (testResultTimerRef.current) {
      clearTimeout(testResultTimerRef.current);
    }
    setTestResult(result);
    testResultTimerRef.current = setTimeout(() => {
      setTestResult((current) => (current?.id === result.id ? null : current));
      testResultTimerRef.current = null;
    }, 5000);
  };

  const connectionsQuery = useQuery({
    enabled: active,
    queryKey: ["connections"],
    queryFn: async ({ signal }) => {
      const response = await api.get("/api/v1/config/connections", { signal });
      return response.data.data as ConfiguredConnection[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: ConnectionFormData) => {
      const response = await api.post("/api/v1/config/connections", data);
      return response.data;
    },
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ["connections"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: () => setError("saveFailed"),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ConnectionFormData }) => {
      const response = await api.put(`/api/v1/config/connections/${id}`, data);
      return response.data;
    },
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ["connections"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: () => setError("saveFailed"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/v1/config/connections/${id}`);
    },
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ["connections"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: () => setError("deleteFailed"),
  });

  const testMutation = useMutation({
    mutationFn: async ({ id }: { id: string; revision: number }) => {
      const response = await api.post(`/api/v1/config/connections/${id}/test`);
      const success = Boolean(response.data.data.connected);
      return {
        id,
        success,
        text: success ? messages.success : messages.failure,
      } satisfies LocalizedConnectionTestResult;
    },
    onMutate: () => {
      setTestResult(null);
    },
    onSuccess: (result, variables) => {
      if (variables.revision === checkRevision.current) showTestResult(result);
    },
    onError: (_error, { id, revision }) => {
      if (revision !== checkRevision.current) return;
      showTestResult({
        id,
        success: false,
        text: messages.requestFailure,
      });
    },
  });

  const write = <T,>(action: () => Promise<T>) => guardWrite(() => {
    checkRevision.current += 1;
    if (testResultTimerRef.current) clearTimeout(testResultTimerRef.current);
    setTestResult(null);
    setError(null);
    return action();
  });

  return {
    connections: connectionsQuery.data || [],
    isLoading: connectionsQuery.isPending,
    loadFailed: connectionsQuery.isError,
    hasLoaded: connectionsQuery.data !== undefined,
    refreshing: connectionsQuery.isFetching,
    refresh: () => connectionsQuery.refetch(),
    error,
    clearError: () => setError(null),
    testResult,
    deletePending: deleteMutation.isPending,
    testingConnectionId: testMutation.isPending ? testMutation.variables?.id : null,
    addConnection: (data: ConnectionFormData) => write(() => addMutation.mutateAsync(data)),
    updateConnection: (id: string, data: ConnectionFormData) =>
      write(() => updateMutation.mutateAsync({ id, data })),
    deleteConnection: (id: string) => { void write(() => deleteMutation.mutateAsync(id)).catch(() => {}); },
    testConnection: (id: string) => {
      if (testResultTimerRef.current) clearTimeout(testResultTimerRef.current);
      testMutation.mutate({ id, revision: ++checkRevision.current });
    },
    isSubmitting: addMutation.isPending || updateMutation.isPending,
  };
}

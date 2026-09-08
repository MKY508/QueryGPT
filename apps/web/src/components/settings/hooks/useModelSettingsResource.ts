"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import {
  buildModelPayload,
  type ModelFormData,
} from "@/lib/settings/models";
import type { ConfiguredModel } from "@/lib/types/api";
import { useSettingsWriteGuard } from "./useSettingsWriteGuard";
import { useModelServiceChecks } from "./useModelServiceChecks";

export interface ModelSettingsResourceMessages {
  addModelFailed: string;
  updateModelFailed: string;
  deleteModelFailed: string;
}

export function useModelSettingsResource(messages: ModelSettingsResourceMessages) {
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const guardWrite = useSettingsWriteGuard();
  const { checks, checkModel, invalidateCheck } = useModelServiceChecks();

  const modelsQuery = useQuery({
    queryKey: ["models"],
    queryFn: async ({ signal }) => {
      const response = await api.get("/api/v1/config/models", { signal });
      return response.data.data as ConfiguredModel[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: ModelFormData) => {
      const response = await api.post("/api/v1/config/models", buildModelPayload(data));
      return response.data.data as ConfiguredModel;
    },
    onSuccess: async (model) => {
      setError(null);
      await queryClient.cancelQueries({ queryKey: ["models"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["models"] });
      checkModel(model.id, true);
    },
    onError: () => {
      setError(messages.addModelFailed);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ModelFormData }) => {
      const response = await api.put(`/api/v1/config/models/${id}`, buildModelPayload(data));
      return response.data.data as ConfiguredModel;
    },
    onSuccess: async (model) => {
      setError(null);
      await queryClient.cancelQueries({ queryKey: ["models"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["models"] });
      checkModel(model.id, true);
    },
    onError: () => {
      setError(messages.updateModelFailed);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/v1/config/models/${id}`);
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.cancelQueries({ queryKey: ["models"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onError: () => {
      setError(messages.deleteModelFailed);
    },
  });

  const write = <T,>(action: () => Promise<T>, id?: string) => guardWrite(() => {
    if (id) invalidateCheck(id);
    setError(null);
    return action();
  });

  return {
    models: modelsQuery.data || [],
    isLoading: modelsQuery.isPending,
    loadFailed: modelsQuery.isError,
    hasLoaded: modelsQuery.data !== undefined,
    refreshing: modelsQuery.isFetching,
    refresh: () => modelsQuery.refetch(),
    error,
    checks,
    isSubmitting: addMutation.isPending || updateMutation.isPending,
    deletePending: deleteMutation.isPending,
    clearError: () => setError(null),
    addModel: (data: ModelFormData) => write(() => addMutation.mutateAsync(data)),
    updateModel: (id: string, data: ModelFormData) => write(() => updateMutation.mutateAsync({ id, data }), id),
    deleteModel: (id: string) => { void write(() => deleteMutation.mutateAsync(id), id).catch(() => {}); },
    testModel: (id: string) => checkModel(id),
  };
}

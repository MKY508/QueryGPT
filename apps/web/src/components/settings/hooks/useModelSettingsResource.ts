"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { getApiErrorMessage } from "@/lib/settings/http";
import {
  buildModelPayload,
  type ModelFormData,
  type ModelTestResult,
} from "@/lib/settings/models";
import type { ConfiguredModel } from "@/lib/types/api";

export function useModelSettingsResource() {
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ModelTestResult | null>(null);
  const queryClient = useQueryClient();

  const { data: models, isLoading } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/models");
      return response.data.data as ConfiguredModel[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: ModelFormData) => {
      const response = await api.post("/api/v1/config/models", buildModelPayload(data));
      return response.data;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (error) => {
      setError(getApiErrorMessage(error, "添加模型失败，请检查配置"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ModelFormData }) => {
      const response = await api.put(`/api/v1/config/models/${id}`, buildModelPayload(data));
      return response.data;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (error) => {
      setError(getApiErrorMessage(error, "更新模型失败，请检查配置"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/v1/config/models/${id}`);
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (error) => {
      setError(getApiErrorMessage(error, "删除模型失败"));
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/api/v1/config/models/${id}/test`);
      return { id, ...response.data.data } as ModelTestResult;
    },
    onSuccess: (result) => {
      setError(null);
      setTestResult(result);
      setTimeout(() => {
        setTestResult((current) => (current?.id === result.id ? null : current));
      }, 8000);
    },
    onError: (error) => {
      setError(getApiErrorMessage(error, "测试失败"));
    },
  });

  return {
    models: models || [],
    isLoading,
    error,
    testResult,
    isSubmitting: addMutation.isPending || updateMutation.isPending,
    testingModelId: testMutation.isPending ? testMutation.variables : null,
    deletePending: deleteMutation.isPending,
    clearError: () => setError(null),
    clearTestResult: () => setTestResult(null),
    addModel: (data: ModelFormData) => addMutation.mutateAsync(data),
    updateModel: (id: string, data: ModelFormData) => updateMutation.mutateAsync({ id, data }),
    deleteModel: (id: string) => deleteMutation.mutate(id),
    testModel: (id: string) => testMutation.mutate(id),
  };
}

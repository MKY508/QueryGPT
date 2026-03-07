"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { downloadJsonFile } from "@/lib/settings/http";
import {
  buildConnectionExportName,
  type ConnectionFormData,
  type ConnectionTestResult,
} from "@/lib/settings/connections";
import type { ConfiguredConnection } from "@/lib/types/api";

export function useConnectionSettingsResource() {
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const queryClient = useQueryClient();

  const { data: connections, isLoading } = useQuery({
    queryKey: ["connections"],
    queryFn: async () => {
      const response = await api.get("/api/v1/config/connections");
      return response.data.data as ConfiguredConnection[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: ConnectionFormData) => {
      const response = await api.post("/api/v1/config/connections", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ConnectionFormData }) => {
      const response = await api.put(`/api/v1/config/connections/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/v1/config/connections/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/api/v1/config/connections/${id}/test`);
      return {
        id,
        success: response.data.data.connected,
        message: response.data.data.message,
      } as ConnectionTestResult;
    },
    onSuccess: (result) => {
      setTestResult(result);
      setTimeout(() => {
        setTestResult((current) => (current?.id === result.id ? null : current));
      }, 5000);
    },
  });

  const exportConnection = async (connection: ConfiguredConnection) => {
    try {
      const response = await api.get(`/api/v1/config/connections/${connection.id}/export`);
      downloadJsonFile(buildConnectionExportName(connection.name), response.data.data);
    } catch (error) {
      console.error("导出失败:", error);
      alert("导出失败，请重试");
    }
  };

  return {
    connections: connections || [],
    isLoading,
    testResult,
    deletePending: deleteMutation.isPending,
    testingConnectionId: testMutation.isPending ? testMutation.variables : null,
    addConnection: (data: ConnectionFormData) => addMutation.mutateAsync(data),
    updateConnection: (id: string, data: ConnectionFormData) =>
      updateMutation.mutateAsync({ id, data }),
    deleteConnection: (id: string) => deleteMutation.mutate(id),
    testConnection: (id: string) => testMutation.mutate(id),
    exportConnection,
    isSubmitting: addMutation.isPending || updateMutation.isPending,
  };
}

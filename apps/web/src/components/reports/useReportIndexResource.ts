"use client";

import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createReport, deleteReport, listReportLibrary,
  type ReportCreateInput, type ReportDocument, type ReportLibraryPage, type ReportSerializationCopy,
} from "@/lib/reports";
import { REPORT_LIBRARY_PAGE_SIZE, type ReportLibraryView } from "@/lib/report-library";

const emptyLibrary: ReportLibraryPage = {
  items: [], total: 0, count: 0, page: 1, page_size: REPORT_LIBRARY_PAGE_SIZE, page_count: 1,
};

export function useReportIndexResource(projectId: string, view: ReportLibraryView) {
  const client = useQueryClient();
  const projectKey = ["project-report-index", projectId] as const;
  const queryKey = [...projectKey, view] as const;
  const writeInFlight = useRef(false);
  const refreshInFlight = useRef(false);
  const outcomeUnconfirmed = useRef(false);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => listReportLibrary(projectId, view, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    // ReceiptBI's local API can work without an internet connection. Never
    // queue a write to run later just because navigator.onLine is false.
    networkMode: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const creation = useMutation({
    mutationFn: ({ input, copy }: { input: ReportCreateInput; copy: ReportSerializationCopy }) =>
      createReport(projectId, input, copy),
    retry: false,
    gcTime: 0,
    networkMode: "always",
    onSuccess: async () => {
      await client.cancelQueries({ queryKey: projectKey });
      void client.invalidateQueries({ queryKey: projectKey });
    },
    onError: () => {
      outcomeUnconfirmed.current = true;
      writeInFlight.current = false;
    },
  });

  const deletion = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) => deleteReport(projectId, id, version),
    retry: false,
    gcTime: 0,
    networkMode: "always",
    onSuccess: async (_, { id }) => {
      // A list read started before DELETE must not reinsert the acknowledged
      // deletion when its stale response eventually arrives.
      await client.cancelQueries({ queryKey: projectKey });
      client.setQueriesData<ReportLibraryPage>({ queryKey: projectKey }, (current) => {
        if (!current) return current;
        const items = current.items.filter((item) => item.id !== id);
        return { ...current, items, total: Math.max(0, current.total - 1),
          count: Math.max(0, current.count - (current.items.length - items.length)) };
      });
      // The server refills/clamps the active page. Never slice a partial page as
      // though it were the whole project or invalidate only the originating view.
      void client.invalidateQueries({ queryKey: projectKey });
    },
    onError: () => { outcomeUnconfirmed.current = true; },
    onSettled: () => { writeInFlight.current = false; },
  });

  const refresh = async () => {
    if (writeInFlight.current || refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      // In particular, a pending first read may predate an uncertain write.
      // Reconciliation requires a new request, not its reused promise.
      await client.cancelQueries({ queryKey, exact: true });
      const result = await query.refetch();
      if (result.isSuccess) {
        outcomeUnconfirmed.current = false;
        creation.reset();
        deletion.reset();
      }
    } finally {
      refreshInFlight.current = false;
    }
  };

  const create = (input: ReportCreateInput, copy: ReportSerializationCopy, onCreated: (report: ReportDocument) => void) => {
    if (writeInFlight.current || refreshInFlight.current || outcomeUnconfirmed.current) return;
    writeInFlight.current = true;
    deletion.reset();
    // Per-call callbacks belong to the mounted observer. A completed write
    // still belongs to its original project, but cannot navigate a departed UI.
    creation.mutate({ input, copy }, { onSuccess: onCreated });
  };

  const remove = (id: string, version: number) => {
    if (writeInFlight.current || refreshInFlight.current || outcomeUnconfirmed.current) return;
    writeInFlight.current = true;
    creation.reset();
    deletion.mutate({ id, version });
  };

  const mutationError: "createError" | "deleteError" | null =
    creation.isError ? "createError" : deletion.isError ? "deleteError" : null;
  const creating = creation.isPending || creation.isSuccess;
  const busy = creating || deletion.isPending;
  return {
    library: query.data ?? emptyLibrary,
    hasList: query.data !== undefined,
    loading: query.isPending || (query.isFetching && query.data?.items.length === 0),
    loadFailed: query.isError,
    refreshing: query.isFetching,
    creating,
    deletingId: deletion.isPending ? deletion.variables.id : null,
    busy,
    writeDisabled: busy || mutationError !== null,
    mutationError,
    refresh, create, remove,
  };
}

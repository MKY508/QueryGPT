"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createWorkspaceQueryClient } from "@/lib/api/query-client";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createWorkspaceQueryClient);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>{children}</ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

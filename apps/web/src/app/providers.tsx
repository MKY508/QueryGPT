"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DesktopNavigation } from "@/components/providers/DesktopNavigation";
import { UploadActivity } from "@/components/providers/UploadActivity";
import { ComposerDraftGuard } from "@/components/providers/ComposerDraftGuard";
import { createWorkspaceQueryClient } from "@/lib/api/query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createWorkspaceQueryClient);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <DesktopNavigation />
        <ComposerDraftGuard />
        <ThemeProvider>
          {children}
          <UploadActivity />
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

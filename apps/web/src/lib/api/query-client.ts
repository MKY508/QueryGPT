import { QueryClient } from "@tanstack/react-query";

/** All current queries target ReceiptBI's API, not a browser internet probe. */
export function createWorkspaceQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        retry: false,
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        networkMode: "always",
        retry: false,
        gcTime: 0,
      },
    },
  });
}

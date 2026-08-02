import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

interface QueryProviderProps {
  children: ReactNode;
}

/**
 * React Query provider with a lazy-initialized QueryClient.
 * Configures sensible defaults: 30s stale time, 3 retries,
 * and keeps previous data on refetch.
 */
export function QueryProvider({ children }: QueryProviderProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            retry: 3,
            refetchOnWindowFocus: true,
          },
          mutations: {
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

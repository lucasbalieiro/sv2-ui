import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authFetch, AuthError } from '@/lib/auth-fetch';
import type { LogDiagnosticsResponse } from '@/types/log-diagnostics';

async function fetchLogDiagnostics(): Promise<LogDiagnosticsResponse | null> {
  try {
    const response = await authFetch('/api/logs/diagnostics', {
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch (error) {
    if (error instanceof AuthError) throw error;
    return null;
  }
}

/**
 * Which diagnostics snapshot the dashboard should show right now.
 *
 * Diagnostics are polled every few seconds, and only a snapshot that covers
 * every container is evidence. A failed poll, or one marked `partial` because
 * a container is mid remove/create, says nothing about the diagnoses in the
 * logs. Treating either as "no diagnostics" makes the generic connection
 * error banner flash on between real diagnostic banners — the exact
 * flapping PR #96's banners are meant to avoid.
 *
 * So a snapshot is held until a later complete one contradicts it, including
 * one that finds nothing: a clean read clears the last diagnosis, a stopped
 * stack clears the banners.
 */
export function resolveDiagnosticsSnapshot(
  previous: LogDiagnosticsResponse | null,
  payload: LogDiagnosticsResponse | null,
): LogDiagnosticsResponse | null {
  if (!payload || payload.partial) {
    return previous;
  }

  return payload;
}

export function useLogDiagnostics(enabled = true) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['log-diagnostics'],
    queryFn: async () => {
      // Read the previous snapshot from the query cache rather than a ref:
      // React Query replays the cached data on remount, while a ref would
      // start empty and let a partial first poll replace it with null.
      const previous =
        queryClient.getQueryData<LogDiagnosticsResponse | null>(['log-diagnostics']) ?? null;
      return resolveDiagnosticsSnapshot(previous, await fetchLogDiagnostics());
    },
    refetchInterval: enabled ? 3000 : false,
    retry: false,
    enabled,
  });
}

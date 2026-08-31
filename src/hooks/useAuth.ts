import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface AuthState {
  passwordSet: boolean;
  authenticated: boolean;
  recoveryKeySet: boolean;
}

export const AUTH_QUERY_KEY = ['auth-state'] as const;

async function fetchAuthState(): Promise<AuthState> {
  const response = await fetch('/api/auth/state', { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`Failed to load authentication state (${response.status})`);
  }
  const data = (await response.json()) as AuthState;
  return {
    passwordSet: data.passwordSet,
    authenticated: data.authenticated,
    recoveryKeySet: data.recoveryKeySet ?? false,
  };
}

interface PasswordResponse {
  success: boolean;
  recoveryKey?: string;
  error?: string;
}

async function postPassword(path: string, password: string): Promise<PasswordResponse> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = (await response.json().catch(() => ({}))) as PasswordResponse;
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

export function useAuth() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: fetchAuthState,
    staleTime: 5000,
    retry: false,
  });

  const invalidate = () => {
    // A session change invalidates every cached view of server state.
    // queryClient.clear() removes queries AND detaches the active
    // observers, so the refetched auth-state would never reach the component.
    // invalidateQueries() refetches in place and keeps observers subscribed.
    queryClient.invalidateQueries();
  };

  const login = useMutation({
    mutationFn: async (password: string) => {
      await postPassword('/api/auth/login', password);
      invalidate();
    },
  });

  const createPassword = useMutation({
    mutationFn: async (password: string) => {
      const data = await postPassword('/api/auth/setup-password', password);
      invalidate();
      return data.recoveryKey;
    },
  });

  const logout = useMutation({
    mutationFn: async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      invalidate();
    },
  });

  const recover = useMutation({
    mutationFn: async (recoveryKey: string) => {
      const response = await fetch('/api/auth/recover', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryKey }),
      });
      const data = (await response.json().catch(() => ({}))) as PasswordResponse;
      if (!response.ok || data.success === false) {
        throw new Error(data.error || `Request failed (${response.status})`);
      }
      invalidate();
    },
  });

  const regenerateRecoveryKey = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/auth/recovery-key/regenerate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await response.json().catch(() => ({}))) as PasswordResponse;
      if (!response.ok || !data.recoveryKey) {
        throw new Error(data.error || `Request failed (${response.status})`);
      }
      return data.recoveryKey;
    },
  });

  return {
    isLoading: query.isLoading,
    isError: query.isError,
    passwordSet: query.data?.passwordSet ?? false,
    authenticated: query.data?.authenticated ?? false,
    recoveryKeySet: query.data?.recoveryKeySet ?? false,
    login,
    createPassword,
    logout,
    recover,
    regenerateRecoveryKey,
  };
}

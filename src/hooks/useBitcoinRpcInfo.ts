import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BitcoinCoreVersion } from '@/components/setup/types';

interface BitcoinRpcInfo {
  version: BitcoinCoreVersion | null;
  isInIBD: boolean;
  isLoading: boolean;
  error: string | null;
  upgradeRequired: boolean;
}

async function fetchBitcoinRpcInfo(
  socketPath: string,
  dataDir: string,
  network: 'mainnet' | 'testnet4'
): Promise<{
  version: string | null;
  isInIBD: boolean;
  error: string | null;
  upgradeRequired: boolean;
}> {
  try {
    const response = await fetch('/api/bitcoin-rpc-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socket_path: socketPath, data_dir: dataDir, network }),
    });

    if (!response.ok) {
      return { version: null, isInIBD: false, upgradeRequired: false, error: 'Failed to fetch RPC info' };
    }
    return response.json();
  } catch {
    return { version: null, isInIBD: false, upgradeRequired: false, error: 'Network error' };
  }
}

export function useBitcoinRpcInfo(
  socketPath: string,
  dataDir: string,
  network: 'mainnet' | 'testnet4',
  debounceMs = 1500
): BitcoinRpcInfo {
  const [debouncedSocket, setDebouncedSocket] = useState(socketPath);
  const [debouncedDataDir, setDebouncedDataDir] = useState(dataDir);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSocket(socketPath), debounceMs);
    return () => clearTimeout(t);
  }, [socketPath, debounceMs]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedDataDir(dataDir), debounceMs);
    return () => clearTimeout(t);
  }, [dataDir, debounceMs]);

  const { data, isLoading } = useQuery({
    queryKey: ['bitcoin-rpc-info', debouncedSocket, debouncedDataDir, network],
    queryFn: () => fetchBitcoinRpcInfo(debouncedSocket, debouncedDataDir, network),
    enabled: !!debouncedSocket,
    staleTime: 30_000,
    retry: false,
  });

  return {
    version: (data?.version as BitcoinCoreVersion) ?? null,
    isInIBD: data?.isInIBD ?? false,
    isLoading: isLoading || !data,
    error: data?.error ?? null,
    upgradeRequired: data?.upgradeRequired ?? false,
  };
}
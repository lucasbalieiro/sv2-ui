import type { SetupData } from '@sv2-ui/shared';
export type { MiningMode, SetupMode, OperatingSystem, BitcoinCoreVersion, BitcoinNetwork, PoolConfig, BitcoinConfig, JdcConfig, TranslatorConfig, SetupData } from '@sv2-ui/shared';

export const initialSetupData: SetupData = {
  miningMode: null,
  mode: null,
  miner_telemetry_cidr: '',
  pool: null,
  fallbackPools: [],
  bitcoin: null,
  jdc: null,
  translator: null,
};

export type SetupStep =
  | 'mining-mode'
  | 'pool'
  | 'bitcoin-prereq'
  | 'bitcoin'
  | 'hashrate'
  | 'identity'
  | 'review';

export interface StepProps {
  data: SetupData;
  updateData: (updates: Partial<SetupData>) => void;
  onNext: () => void;
  onBack: () => void;
}

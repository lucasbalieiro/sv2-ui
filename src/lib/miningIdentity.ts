import {
  isFullDonationIdentity,
  type BitcoinNetwork,
  type MiningMode,
  type PoolConfig,
} from '@sv2-ui/shared';
import {
  getBitcoinAddressError,
  isTomlSafeIdentifier,
  isValidBitcoinAddress,
} from './utils';

export const SRI_POOL_AUTHORITY_KEY = '9auqWEzQDVyd2oe1JVGFLMLHZtCo2FFqZwtKA5gd9xbuEu7PH72';

export { isFullDonationIdentity };

export interface SriIdentityParts {
  address: string;
  workerName: string;
  donationPercent: number;
}

export function isSriPool(pool: PoolConfig | null | undefined): boolean {
  return pool?.authority_public_key === SRI_POOL_AUTHORITY_KEY;
}

export function parseSriIdentity(identity: string): SriIdentityParts {
  if (identity.startsWith('sri/solo/')) {
    const rest = identity.slice('sri/solo/'.length);
    const idx = rest.indexOf('/');
    if (idx === -1) return { address: rest, workerName: '', donationPercent: 0 };
    return { address: rest.slice(0, idx), workerName: rest.slice(idx + 1), donationPercent: 0 };
  }

  if (identity === 'sri/donate') {
    return { address: '', workerName: '', donationPercent: 100 };
  }

  if (identity.startsWith('sri/donate/')) {
    const rest = identity.slice('sri/donate/'.length);
    const parts = rest.split('/');
    const pct = parseInt(parts[0], 10);
    if (!Number.isNaN(pct) && String(pct) === parts[0] && parts.length >= 2) {
      return { address: parts[1], workerName: parts.slice(2).join('/'), donationPercent: pct };
    }
    return { address: '', workerName: rest, donationPercent: 100 };
  }

  return { address: identity, workerName: '', donationPercent: 0 };
}

export function getWorkerNameError(workerName: string): string | null {
  if (workerName.includes('/')) return 'Worker name must not contain "/"';
  return null;
}

export function buildSriIdentity(address: string, workerName: string, donationPercent: number): string {
  const addr = address.trim();
  const worker = workerName.trim();

  // A worker name beginning with `<pct>/` (e.g. `25/bc1q…`) is reinterpreted by
  // the SRI parser as a partial-donation identity, letting a malicious worker
  // label overwrite the payout fields (field injection). Strip slashes ONLY in
  // that dangerous shape. Every other worker name is preserved verbatim, so
  // legitimate names like `rig/1` are neither stripped nor silently rewritten.
  const safeWorker = /^\d{1,2}\//.test(worker) ? worker.replace(/\//g, '') : worker;

  if (donationPercent >= 100) {
    return safeWorker ? `sri/donate/${safeWorker}` : 'sri/donate';
  }

  if (donationPercent > 0 && donationPercent < 100) {
    if (!addr) return '';
    return safeWorker
      ? `sri/donate/${donationPercent}/${addr}/${safeWorker}`
      : `sri/donate/${donationPercent}/${addr}`;
  }

  if (!addr) return '';
  return safeWorker ? `sri/solo/${addr}/${safeWorker}` : `sri/solo/${addr}`;
}

export function normalizeSriIdentity(identity: string): string {
  const parsed = parseSriIdentity(identity);
  return buildSriIdentity(parsed.address, parsed.workerName, parsed.donationPercent);
}

export function normalizePoolUserIdentity(pool: PoolConfig, miningMode: MiningMode | null): PoolConfig {
  if (miningMode !== 'solo' || !isSriPool(pool)) {
    return pool;
  }

  const normalizedIdentity = normalizeSriIdentity(pool.user_identity);
  return normalizedIdentity === pool.user_identity
    ? pool
    : { ...pool, user_identity: normalizedIdentity };
}

/**
 * Convert an existing pool identity into the representation expected by a
 * target pool. Identities are inherited only in solo mode, where the payout
 * address is portable across pool operators. SRI solo pools use a structured
 * identity while other solo pools use a plain payout address. In pool mode
 * each operator uses its own account username, so a new pool never inherits
 * the primary's identity.
 */
export function getCompatiblePoolIdentity(
  sourcePool: PoolConfig | null | undefined,
  targetPool: PoolConfig,
  miningMode: MiningMode | null,
): string {
  const sourceIdentity = sourcePool?.user_identity ?? '';
  if (miningMode !== 'solo' || !sourceIdentity) return '';

  if (miningMode === 'solo' && isSriPool(sourcePool) && !isSriPool(targetPool)) {
    const parsed = parseSriIdentity(sourceIdentity);
    return parsed.donationPercent >= 100 ? '' : parsed.address;
  }

  return normalizePoolUserIdentity(
    { ...targetPool, user_identity: sourceIdentity },
    miningMode,
  ).user_identity;
}

export function withCompatiblePoolIdentity(
  sourcePool: PoolConfig | null | undefined,
  targetPool: PoolConfig,
  miningMode: MiningMode | null,
): PoolConfig {
  return {
    ...targetPool,
    user_identity: getCompatiblePoolIdentity(sourcePool, targetPool, miningMode),
  };
}

/**
 * Normalize an ordered pool list while keeping fallback identities in sync
 * with the primary identity unless the user customized them explicitly.
 *
 * Identities are inherited only in solo mode, where the identity is a portable
 * payout address that can be reused across pool operators. In pool mode the
 * identity is an operator-specific username, so fallbacks keep their own value
 * (a newly added fallback remains incomplete until the user supplies that
 * operator's username) and changing the primary username never rewrites
 * fallbacks.
 */
export function normalizePoolPriorityIdentities(
  nextPools: PoolConfig[],
  previousPrimaryPool: PoolConfig | null | undefined,
  miningMode: MiningMode | null,
): PoolConfig[] {
  const normalizedPools = nextPools.map((pool) => normalizePoolUserIdentity(pool, miningMode));
  const nextPrimaryPool = normalizedPools[0] ?? null;

  return normalizedPools.map((pool, index) => {
    if (index === 0 || miningMode !== 'solo') return pool;

    const previousDefaultIdentity = getCompatiblePoolIdentity(
      previousPrimaryPool,
      pool,
      miningMode,
    );
    const nextDefaultIdentity = getCompatiblePoolIdentity(
      nextPrimaryPool,
      pool,
      miningMode,
    );

    if (
      previousDefaultIdentity &&
      pool.user_identity &&
      pool.user_identity !== previousDefaultIdentity
    ) {
      return pool;
    }

    // A full-donation SRI identity intentionally contains no payout address.
    // Keep an inherited fallback address instead of erasing information that
    // cannot be represented in the primary pool's protocol identity.
    if (!nextDefaultIdentity && pool.user_identity) {
      return pool;
    }

    return { ...pool, user_identity: nextDefaultIdentity };
  });
}

export function getSriIdentitySummary(identity: string): string {
  if (!identity) return 'Username not set';

  const { address, workerName, donationPercent } = parseSriIdentity(identity);
  const rewardTarget = donationPercent >= 100
    ? 'Full reward donated'
    : address || 'Username not set';
  const donationLabel = `${donationPercent}% donation`;
  const workerLabel = workerName ? `, worker ${workerName}` : '';

  return `${rewardTarget}${workerLabel}, ${donationLabel}`;
}

export function getPoolUserIdentityDisplay(
  pool: PoolConfig | null | undefined,
  miningMode: MiningMode | null,
): string {
  if (!pool) return '';
  if (miningMode === 'solo' && isSriPool(pool)) {
    return getSriIdentitySummary(pool.user_identity);
  }

  return pool.user_identity;
}

export function getSriIdentityError(identity: string, network: BitcoinNetwork): string | null {
  if (!identity) return 'Username is required';
  if (!isTomlSafeIdentifier(identity)) return 'Username contains characters that are not allowed';

  const { workerName } = parseSriIdentity(identity);
  const workerError = getWorkerNameError(workerName);
  if (workerError) return workerError;

  if (identity === 'sri/donate') return null;

  if (identity.startsWith('sri/solo/')) {
    const { address } = parseSriIdentity(identity);
    return isValidBitcoinAddress(address, network)
      ? null
      : getBitcoinAddressError(address, network) || 'Invalid Bitcoin address';
  }

  if (identity.startsWith('sri/donate/')) {
    const rest = identity.slice('sri/donate/'.length);
    const parts = rest.split('/');
    const pct = parseInt(parts[0], 10);
    const hasPartialDonation = !Number.isNaN(pct) && String(pct) === parts[0] && parts.length >= 2;

    if (!hasPartialDonation) {
      return rest.length > 0 ? null : 'Worker name is required';
    }

    if (pct <= 0 || pct >= 100) {
      return 'Donation percent must be between 1 and 99';
    }

    return isValidBitcoinAddress(parts[1], network)
      ? null
      : getBitcoinAddressError(parts[1], network) || 'Invalid Bitcoin address';
  }

  return 'Enter a Bitcoin payout address, or set donation to 100% to donate the full reward';
}

export function getPoolIdentityError(
  pool: PoolConfig | null | undefined,
  miningMode: MiningMode | null,
  network: BitcoinNetwork,
  rawWorkerName?: string,
): string | null {
  const identity = pool?.user_identity ?? '';

  if (miningMode === 'solo') {
    if (isSriPool(pool)) {
      // The raw worker name is the only place a slash can be caught before it
      // is merged into (and possibly neutralized within) the structured
      // identity, so surface it here when the caller has it.
      if (rawWorkerName !== undefined) {
        const workerError = getWorkerNameError(rawWorkerName);
        if (workerError) return workerError;
      }
      return getSriIdentityError(identity, network);
    }

    if (!identity) return 'Username is required';
    if (!isTomlSafeIdentifier(identity)) return 'Username contains characters that are not allowed';

    return isValidBitcoinAddress(identity, network)
      ? null
      : getBitcoinAddressError(identity, network) || 'Invalid Bitcoin address';
  }

  if (!identity) return 'Username is required';
  if (!isTomlSafeIdentifier(identity)) return 'Username contains characters that are not allowed';

  return null;
}

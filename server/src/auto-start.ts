/**
 * Reconciles the mining stack against the saved intent to run it.
 *
 * `shouldBeRunning` in state.json is the durable record of the user wanting
 * mining to be up. This reconciler keeps that intent true across app boots,
 * app updates, and generated-config drift: whenever the stack is stopped or
 * running with stale generated files, it brings the stack back in line.
 *
 * It is deliberately extracted from index.ts with injected dependencies so
 * the decision logic is unit-testable. The stack-operation lock (which is
 * shared with the manual start/stop endpoints and surfaced as
 * `autoStarting` in /api/status) stays with the caller via the injected
 * `tryAcquire`/`release` pair.
 */

import type { SetupData, StatusResponse } from './types.js';
import type { SavedState } from './state.js';
import type { PreparedServiceConfig, ServiceConfigFile } from './service-config.js';
import { isOnlyTranslatorStopped, isStackRunning } from './stack-health.js';

export const AUTO_START_MIN_BACKOFF_MS = 60_000;
export const AUTO_START_MAX_BACKOFF_MS = 5 * 60_000;

type StackContainers = StatusResponse['containers'];

export type AutoStartDeps = {
  loadState: () => Promise<SavedState>;
  getStackStatus: (mode: SavedState['mode']) => Promise<StackContainers>;
  prepareServiceConfig: (
    data: SetupData,
    options?: { logFailure?: boolean },
  ) => PreparedServiceConfig;
  getServiceConfigDrift: (files: ServiceConfigFile[], configDir: string) => Promise<string[]>;
  reconcileServiceConfigFiles: (files: ServiceConfigFile[], configDir: string) => Promise<string[]>;
  stopStack: () => Promise<void>;
  startStack: (data: SetupData, configDir: string) => Promise<void>;
  saveState: (data: SetupData, shouldBeRunning: boolean) => Promise<void>;
  getBitcoinSocketStartupError: (data: SetupData) => Promise<string | null>;
  /** Take the shared stack-operation lock, or return false when busy. */
  tryAcquire: () => boolean;
  /** Release the shared lock; only meaningful after a successful tryAcquire. */
  release: () => void;
  configDir: string;
  now?: () => number;
  log?: Pick<Console, 'log' | 'error'>;
};

export class AutoStartReconciler {
  private failureCount = 0;
  private nextAttemptAt = 0;
  private setupReviewLogged = false;

  constructor(private readonly deps: AutoStartDeps) {}

  /**
   * Backoff after repeated failures. Called by manual start paths (which
   * hold the lock themselves and do not go through reconcile) so a
   * user-initiated restart clears the retry schedule.
   */
  resetRecoveryState(): void {
    this.resetBackoff();
    this.setupReviewLogged = false;
  }

  async reconcile(): Promise<void> {
    if (this.nextAttemptAt > this.now()) return;
    if (!this.deps.tryAcquire()) return;

    try {
      const state = await this.deps.loadState();
      if (!state.configured || !state.data || !state.shouldBeRunning) {
        this.resetRecoveryState();
        return;
      }

      const containers = await this.deps.getStackStatus(state.mode);
      const prepared = this.deps.prepareServiceConfig(state.data, {
        logFailure: !this.setupReviewLogged,
      });
      const running = isStackRunning(state.mode, containers);

      if (prepared.kind !== 'ready') {
        this.setupReviewLogged = true;
        // A required setup choice is missing. Stop stale services and let the
        // wizard reopen with saved fields prefilled.
        if (running) {
          this.log().log('Auto-start: setup review is required. Stopping the existing stack.');
          await this.deps.stopStack();
        }
        this.resetBackoff();
        return;
      }
      this.setupReviewLogged = false;

      // Check drift before considering a running stack healthy. This repairs an
      // interrupted update and applies new generated configuration on boot.
      const drift = await this.deps.getServiceConfigDrift(prepared.files, this.deps.configDir);
      if (running && drift.length === 0) {
        this.resetRecoveryState();
        return;
      }

      // recoverTranslator restarts the Translator on its own schedule. A full
      // restart here would recreate JDC and send it back to the primary pool.
      if (drift.length === 0 && isOnlyTranslatorStopped(state.mode, containers)) {
        this.resetRecoveryState();
        return;
      }

      if (prepared.data.mode === 'jd') {
        const socketError = await this.deps.getBitcoinSocketStartupError(prepared.data);
        if (socketError) {
          this.recordFailure(socketError);
          return;
        }
      }

      if (running) {
        this.log().log(`Auto-start: generated configuration changed (${drift.join(', ')}). Restarting containers...`);
      } else {
        this.log().log('Auto-start: shouldBeRunning=true and stack is stopped. Starting containers...');
      }

      await this.deps.stopStack();
      const changedFiles = await this.deps.reconcileServiceConfigFiles(prepared.files, this.deps.configDir);
      if (changedFiles.length > 0) {
        this.log().log(`Auto-start reconciled generated configuration: ${changedFiles.join(', ')}`);
      }

      await this.deps.saveState(prepared.data, true);
      await this.deps.startStack(prepared.data, this.deps.configDir);
      this.resetRecoveryState();
      this.log().log('Auto-start: containers started successfully');
    } catch (error) {
      this.recordFailure(error);
    } finally {
      this.deps.release();
    }
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private log(): Pick<Console, 'log' | 'error'> {
    return this.deps.log ?? console;
  }

  private resetBackoff(): void {
    this.failureCount = 0;
    this.nextAttemptAt = 0;
  }

  private recordFailure(error: unknown): void {
    this.failureCount += 1;
    const delayMs = Math.min(
      AUTO_START_MIN_BACKOFF_MS * 2 ** (this.failureCount - 1),
      AUTO_START_MAX_BACKOFF_MS,
    );
    this.nextAttemptAt = this.now() + delayMs;

    this.log().error('Auto-start failed:', error);
    this.log().log(`Auto-start: retrying in ${Math.round(delayMs / 1000)}s.`);
  }
}

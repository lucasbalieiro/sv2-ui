import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AutoStartReconciler } from './auto-start.js';
import type { AutoStartDeps } from './auto-start.js';
import type { SavedState } from './state.js';
import type { SetupData } from './types.js';
import type { PreparedServiceConfig, ServiceConfigFile } from './service-config.js';

const CONFIG_DIR = '/config';
const START_TIME = 1_000_000;

const SETUP_DATA = { mode: 'jd', miningMode: 'pool' } as unknown as SetupData;

const FILE: ServiceConfigFile = { filename: 'translator.toml', contents: 'x' };

const READY: PreparedServiceConfig = { kind: 'ready', data: SETUP_DATA, files: [FILE] };

function state(overrides: Partial<SavedState> = {}): SavedState {
  return {
    configured: true,
    miningMode: 'pool',
    mode: 'jd',
    data: SETUP_DATA,
    shouldBeRunning: true,
    ...overrides,
  };
}

const UP = { id: '1', name: 'c', status: 'healthy' as const, ports: {} };
const DOWN = null;

type Recorded = {
  calls: string[];
  stopStack: () => Promise<void>;
  startStack: (data: SetupData, configDir: string) => Promise<void>;
  saveState: (data: SetupData, shouldBeRunning: boolean) => Promise<void>;
  reconcileServiceConfigFiles: (files: ServiceConfigFile[], configDir: string) => Promise<string[]>;
};

function record(): Recorded {
  const calls: string[] = [];
  return {
    calls,
    stopStack: async () => { calls.push('stopStack'); },
    startStack: async () => { calls.push('startStack'); },
    saveState: async () => { calls.push('saveState'); },
    reconcileServiceConfigFiles: async (files) => {
      calls.push(`reconcileServiceConfigFiles(${files.map((f) => f.filename).join(',')})`);
      return [];
    },
  };
}

type DepOverrides = Partial<AutoStartDeps> & {
  savedState?: SavedState;
  prepared?: PreparedServiceConfig;
  drift?: string[];
  containers?: { translator: typeof UP | null; jdc: typeof UP | null };
};

function makeReconciler(overrides: DepOverrides = {}) {
  const rec = record();
  const { savedState, prepared, drift, containers, ...depOverrides } = overrides;

  const deps: AutoStartDeps = {
    loadState: async () => savedState ?? state(),
    getStackStatus: async () => containers ?? { translator: UP, jdc: UP },
    prepareServiceConfig: () => prepared ?? READY,
    getServiceConfigDrift: async () => drift ?? [],
    reconcileServiceConfigFiles: rec.reconcileServiceConfigFiles,
    stopStack: rec.stopStack,
    startStack: rec.startStack,
    saveState: rec.saveState,
    getBitcoinSocketStartupError: async () => null,
    tryAcquire: () => true,
    release: () => { rec.calls.push('release'); },
    configDir: CONFIG_DIR,
    now: () => clock.now,
    log: { log: () => {}, error: () => {} },
    ...depOverrides,
  };

  const reconciler = new AutoStartReconciler(deps);
  return { reconciler, calls: rec.calls };
}

const clock = { now: START_TIME };

test('does nothing when the stack is already running and drift-free', async () => {
  const { reconciler, calls } = makeReconciler();
  await reconciler.reconcile();
  assert.deepEqual(calls, ['release']);
});

test('starts a stopped stack when shouldBeRunning is true', async () => {
  const { reconciler, calls } = makeReconciler({
    containers: { translator: DOWN, jdc: DOWN },
  });
  await reconciler.reconcile();
  assert.deepEqual(calls, [
    'stopStack',
    'reconcileServiceConfigFiles(translator.toml)',
    'saveState',
    'startStack',
    'release',
  ]);
});

test('restarts a running stack when generated config drifted', async () => {
  const { reconciler, calls } = makeReconciler({ drift: ['translator.toml'] });
  await reconciler.reconcile();
  assert.ok(calls.includes('stopStack'));
  assert.ok(calls.includes('startStack'));
});

test('does nothing when shouldBeRunning is false', async () => {
  const { reconciler, calls } = makeReconciler({
    savedState: state({ shouldBeRunning: false }),
    containers: { translator: DOWN, jdc: DOWN },
  });
  await reconciler.reconcile();
  assert.deepEqual(calls, ['release']);
});

test('does nothing when not configured', async () => {
  const { reconciler, calls } = makeReconciler({
    savedState: state({ configured: false, data: null, shouldBeRunning: false }),
    containers: { translator: DOWN, jdc: DOWN },
  });
  await reconciler.reconcile();
  assert.deepEqual(calls, ['release']);
});

test('hands off to Translator recovery when only the Translator is stopped in JD mode', async () => {
  const { reconciler, calls } = makeReconciler({
    containers: { translator: DOWN, jdc: UP },
  });
  await reconciler.reconcile();
  assert.deepEqual(calls, ['release']);
});

test('stops the stack when setup review is required, and only logs it once', async () => {
  let prepareCalls = 0;
  const review: PreparedServiceConfig = {
    kind: 'needs-setup-review',
    issues: [{ code: 'missing', title: 't', message: 'm' }],
  };
  const { reconciler, calls } = makeReconciler({
    prepared: review,
    containers: { translator: UP, jdc: UP },
    prepareServiceConfig: (_data, options) => {
      prepareCalls += 1;
      assert.equal(options?.logFailure, prepareCalls === 1);
      return review;
    },
  });

  await reconciler.reconcile();
  assert.deepEqual(calls, ['stopStack', 'release']);

  await reconciler.reconcile();
  assert.deepEqual(calls, ['stopStack', 'release', 'stopStack', 'release']);
});

test('does not stop a stopped stack when setup review is required', async () => {
  const review: PreparedServiceConfig = {
    kind: 'needs-setup-review',
    issues: [{ code: 'missing', title: 't', message: 'm' }],
  };
  const { reconciler, calls } = makeReconciler({
    prepared: review,
    containers: { translator: DOWN, jdc: DOWN },
  });
  await reconciler.reconcile();
  assert.deepEqual(calls, ['release']);
});

test('records backoff when the Bitcoin socket check fails in JD mode', async () => {
  clock.now = START_TIME;
  const { reconciler, calls } = makeReconciler({
    containers: { translator: DOWN, jdc: DOWN },
    getBitcoinSocketStartupError: async () => 'socket missing',
  });

  await reconciler.reconcile();
  assert.deepEqual(calls, ['release'], 'no restart when the socket is unusable');

  // Within the 60s backoff the reconciler must not retry.
  clock.now += 30_000;
  await reconciler.reconcile();
  assert.deepEqual(calls, ['release'], 'no restart while backing off');

  // Once the socket is healthy and the backoff expired, it starts the stack.
  const healthy = makeReconciler({
    containers: { translator: DOWN, jdc: DOWN },
    getBitcoinSocketStartupError: async () => null,
  });
  await healthy.reconciler.reconcile();
  assert.ok(healthy.calls.includes('startStack'));
});

test('backs off exponentially on thrown errors, capped at the maximum', async () => {
  clock.now = START_TIME;
  let startAttempts = 0;
  const { reconciler, calls } = makeReconciler({
    containers: { translator: DOWN, jdc: DOWN },
    startStack: async () => {
      startAttempts += 1;
      calls.push('startStack');
      throw new Error('docker down');
    },
  });

  // Expected waits after each failure: 60s, 120s, 240s, then capped at 300s.
  const expectedWaits = [60_000, 120_000, 240_000, 300_000, 300_000];
  for (const wait of expectedWaits) {
    const attemptBefore = startAttempts;
    await reconciler.reconcile();
    assert.equal(startAttempts, attemptBefore + 1, 'attempts once when due');

    // One millisecond before the wait expires, reconcile must be a no-op.
    clock.now += wait - 1;
    const callsBefore = calls.length;
    await reconciler.reconcile();
    assert.equal(calls.length, callsBefore, 'respects backoff until due');

    clock.now += 1;
  }

  assert.equal(startAttempts, 5);
});

test('a successful reconcile after failures resets the backoff', async () => {
  clock.now = START_TIME;
  let failing = true;
  const { reconciler, calls } = makeReconciler({
    containers: { translator: DOWN, jdc: DOWN },
    startStack: async () => {
      calls.push('startStack');
      if (failing) throw new Error('docker down');
    },
  });

  await reconciler.reconcile(); // fails -> 60s backoff
  clock.now += 60_000;
  failing = false;
  await reconciler.reconcile(); // succeeds
  assert.ok(calls.includes('startStack'));

  // Next tick sees a stopped stack again; with backoff cleared it restarts
  // immediately rather than waiting out a stale schedule.
  const before = calls.filter((c) => c === 'startStack').length;
  await reconciler.reconcile();
  assert.equal(calls.filter((c) => c === 'startStack').length, before + 1);
});

test('releases the stack lock even when reconcile throws', async () => {
  const { reconciler, calls } = makeReconciler({
    loadState: async () => { throw new Error('state unreadable'); },
  });
  await reconciler.reconcile();
  assert.deepEqual(calls, ['release']);
});

test('does not take the lock when tryAcquire fails', async () => {
  const { reconciler, calls } = makeReconciler({ tryAcquire: () => false });
  await reconciler.reconcile();
  assert.deepEqual(calls, []);
});

test('resetRecoveryState clears the setup-review log flag', async () => {
  let prepareCalls = 0;
  const review: PreparedServiceConfig = {
    kind: 'needs-setup-review',
    issues: [{ code: 'missing', title: 't', message: 'm' }],
  };
  const { reconciler } = makeReconciler({
    prepared: review,
    containers: { translator: UP, jdc: UP },
    prepareServiceConfig: () => {
      prepareCalls += 1;
      return review;
    },
  });

  await reconciler.reconcile();
  reconciler.resetRecoveryState();
  await reconciler.reconcile();
  // After a reset the failure/setup-review log is reported again.
  assert.equal(prepareCalls, 2);
});

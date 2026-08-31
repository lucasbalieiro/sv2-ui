import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(SERVER_DIR, '..');

async function startServer(): Promise<{
  base: string;
  configDir: string;
  stop: () => void;
}> {
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'sv2-ui-auth-'));
  const port = 4200 + Math.floor(Math.random() * 300);
  const child: ChildProcess = spawn(
    'node',
    ['--import', 'tsx', 'src/index.ts'],
    {
      cwd: SERVER_ROOT,
      env: { ...process.env, CONFIG_DIR: configDir, PORT: String(port), NODE_ENV: 'test' },
      stdio: 'ignore',
    },
  );

  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) break;
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return { base, configDir, stop: () => child.kill('SIGKILL') };
}

test('recover resets the password but keeps the mining configuration', async () => {
  const { base, configDir, stop } = await startServer();
  try {
    const setup = await fetch(`${base}/api/auth/setup-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'sup3rsecret' }),
    });
    assert.equal(setup.status, 200);
    const setupBody = (await setup.json()) as { recoveryKey?: string };
    assert.equal(typeof setupBody.recoveryKey, 'string');

    const state = (await (await fetch(`${base}/api/auth/state`)).json()) as {
      passwordSet: boolean;
      recoveryKeySet: boolean;
    };
    assert.equal(state.passwordSet, true);
    assert.equal(state.recoveryKeySet, true);

    // Simulate an existing mining configuration that must survive recovery.
    await writeFile(path.join(configDir, 'translator.toml'), '# config');

    const wrong = await fetch(`${base}/api/auth/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryKey: 'not-the-right-key' }),
    });
    assert.equal(wrong.status, 401);

    const recover = await fetch(`${base}/api/auth/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryKey: setupBody.recoveryKey }),
    });
    assert.equal(recover.status, 200);
    assert.equal((await recover.json()).success, true);

    const stateAfter = (await (await fetch(`${base}/api/auth/state`)).json()) as {
      passwordSet: boolean;
    };
    assert.equal(stateAfter.passwordSet, false);

    // Config volume preserved across the password reset.
    await access(path.join(configDir, 'translator.toml'));
  } finally {
    stop();
    await rm(configDir, { recursive: true, force: true });
  }
});

test('recover is rate limited after repeated failures', async () => {
  const { base, configDir, stop } = await startServer();
  try {
    const setup = await fetch(`${base}/api/auth/setup-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'sup3rsecret' }),
    });
    assert.equal(setup.status, 200);

    let lastStatus = 0;
    for (let i = 0; i < 6; i += 1) {
      const res = await fetch(`${base}/api/auth/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryKey: 'wrong' }),
      });
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 429);
  } finally {
    stop();
    await rm(configDir, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { bitcoinRpcValidatorScript } from './bitcoin-rpc-validator.js';

test('rpc validator aborts an oversized response body', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'rpc-validator-size-'));
  writeFileSync(path.join(dataDir, '.cookie'), 'rpcuser:rpcpassword\n');

  const responseSize = 8 * 1024 * 1024;
  const chunk = Buffer.alloc(64 * 1024, 'x');
  let sentBytes = 0;

  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.on('error', () => {});

      const writeMore = () => {
        while (sentBytes < responseSize) {
          sentBytes += chunk.length;
          if (!res.write(chunk)) {
            res.once('drain', writeMore);
            return;
          }
        }
        res.end();
      };
      writeMore();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const execution = await new Promise<{ error: Error | null; stderr: string }>((resolve) => {
      execFile(
        process.execPath,
        [
          '-e',
          bitcoinRpcValidatorScript,
          dataDir,
          'mainnet',
          '127.0.0.1',
          String(address.port),
        ],
        { timeout: 5000, maxBuffer: 16 * 1024 * 1024 },
        (error, _stdout, stderr) => resolve({ error, stderr }),
      );
    });

    assert.ok(execution.error, 'the invalid RPC response must be rejected');
    assert.ok(
      sentBytes < responseSize,
      'validator consumed the complete oversized response instead of aborting it',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dataDir, { recursive: true, force: true });
  }
});

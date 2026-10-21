import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hostNetworkProbeScript } from './host-network-probe.js';

test('hostNetworkProbeScript prints the routes and interfaces as JSON', (t) => {
  if (!existsSync('/proc/net/route')) {
    t.skip('/proc/net/route is only available on Linux');
    return;
  }

  const output = JSON.parse(execFileSync(process.execPath, ['-e', hostNetworkProbeScript], { encoding: 'utf8' }));

  assert.equal(typeof output.routes, 'string');
  assert.equal(typeof output.interfaces, 'object');
});

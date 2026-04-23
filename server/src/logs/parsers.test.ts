import assert from 'node:assert/strict';
import test from 'node:test';

import {
  unknownUserParser,
  jdcBitcoinCoreDisconnectedParser,
} from './parsers.js';
import type { ContainerLogLine } from './types.js';

function createLogLine(
  container: 'translator' | 'jdc',
  message: string
): ContainerLogLine {
  return {
    container,
    stream: 'stderr',
    timestamp: '2026-04-17T18:30:43.174887Z',
    message,
    raw: `2026-04-17T18:30:43.174887Z ERROR ${message}`,
  };
}

test('unknownUserParser matches OpenMiningChannelError with unknown-user', () => {
  const lines = [
    createLogLine(
      'translator',
      'OpenMiningChannelError(request_id: 123, error_code: unknown-user)'
    ),
  ];

  const result = unknownUserParser(lines);

  assert.ok(result !== null);
  assert.equal(result?.code, 'unknown-user');
  assert.equal(result?.severity, 'warning');
  assert.equal(result?.title, 'Invalid Braiins username');
  assert.deepEqual(result?.containers, ['translator']);
  assert.equal(result?.evidence.length, 1);
});

test('unknownUserParser returns null when no match', () => {
  const lines = [
    createLogLine('translator', 'Some other error message'),
  ];

  const result = unknownUserParser(lines);

  assert.equal(result, null);
});

test('unknownUserParser returns null when wrong container', () => {
  const lines = [
    createLogLine(
      'jdc',
      'OpenMiningChannelError(request_id: 123, error_code: unknown-user)'
    ),
  ];

  const result = unknownUserParser(lines);

  assert.equal(result, null);
});

test('jdcBitcoinCoreDisconnectedParser matches CapnpError Disconnected', () => {
  const lines = [
    createLogLine(
      'jdc',
      'jd_client_sv2::template_receiver::bitcoin_core: Failed to create BitcoinCoreToSv2: CapnpError(Error { kind: Disconnected, extra: "Peer disconnected." })'
    ),
  ];

  const result = jdcBitcoinCoreDisconnectedParser(lines);

  assert.ok(result !== null);
  assert.equal(result?.code, 'jdc-bitcoin-core-disconnected');
  assert.equal(result?.severity, 'error');
  assert.equal(result?.title, 'Bitcoin Core stopped running');
  assert.deepEqual(result?.containers, ['jdc']);
  assert.equal(result?.evidence.length, 1);
});

test('jdcBitcoinCoreDisconnectedParser matches Disconnected Peer disconnected', () => {
  const lines = [
    createLogLine(
      'jdc',
      'bitcoin_core_sv2::template_distribution_protocol::monitors: Failed to get response: Disconnected: Peer disconnected.'
    ),
  ];

  const result = jdcBitcoinCoreDisconnectedParser(lines);

  assert.ok(result !== null);
  assert.equal(result?.code, 'jdc-bitcoin-core-disconnected');
  assert.equal(result?.severity, 'error');
});

test('jdcBitcoinCoreDisconnectedParser matches CannotConnectToUnixSocket', () => {
  const lines = [
    createLogLine(
      'jdc',
      'jd_client_sv2::template_receiver::bitcoin_core: Failed to create BitcoinCoreToSv2: CannotConnectToUnixSocket("/root/.bitcoin/node.sock", "Connection refused (os error 111)")'
    ),
  ];

  const result = jdcBitcoinCoreDisconnectedParser(lines);

  assert.ok(result !== null);
  assert.equal(result?.code, 'jdc-bitcoin-core-disconnected');
  assert.equal(result?.severity, 'error');
});

test('jdcBitcoinCoreDisconnectedParser returns null when no match', () => {
  const lines = [
    createLogLine('jdc', 'Some other error message'),
  ];

  const result = jdcBitcoinCoreDisconnectedParser(lines);

  assert.equal(result, null);
});

test('jdcBitcoinCoreDisconnectedParser returns null when wrong container', () => {
  const lines = [
    createLogLine(
      'translator',
      'Failed to create BitcoinCoreToSv2: CannotConnectToUnixSocket("/root/.bitcoin/node.sock", "Connection refused (os error 111)")'
    ),
  ];

  const result = jdcBitcoinCoreDisconnectedParser(lines);

  assert.equal(result, null);
});

test('jdcBitcoinCoreDisconnectedParser collects multiple matches', () => {
  const lines = [
    createLogLine(
      'jdc',
      'jd_client_sv2::template_receiver::bitcoin_core: Failed to create BitcoinCoreToSv2: CapnpError(Error { kind: Disconnected, extra: "Peer disconnected." })'
    ),
    createLogLine(
      'jdc',
      'bitcoin_core_sv2::template_distribution_protocol::monitors: Failed to get response: Disconnected: Peer disconnected.'
    ),
  ];

  const result = jdcBitcoinCoreDisconnectedParser(lines);

  assert.ok(result !== null);
  assert.equal(result?.evidence.length, 2);
});

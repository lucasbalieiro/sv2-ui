import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSameOriginRequest } from './request-origin.js';

test('rejects a cross-site state-changing request', () => {
  assert.equal(
    isSameOriginRequest({
      method: 'PUT',
      origin: 'https://evil.example',
      host: 'localhost:8080',
      secFetchSite: 'cross-site',
    }),
    false,
  );
});

test('rejects a cross-origin PUT even without Sec-Fetch-Site', () => {
  assert.equal(
    isSameOriginRequest({
      method: 'PUT',
      origin: 'https://evil.example',
      host: 'localhost:8080',
      secFetchSite: undefined,
    }),
    false,
  );
});

test('allows the same-origin Docker deployment', () => {
  assert.equal(
    isSameOriginRequest({
      method: 'POST',
      origin: 'http://localhost:8080',
      host: 'localhost:8080',
      secFetchSite: 'same-origin',
    }),
    true,
  );
});

test('allows a non-localhost Umbrel origin without any allowlist', () => {
  assert.equal(
    isSameOriginRequest({
      method: 'POST',
      origin: 'http://umbrel.local',
      host: 'umbrel.local',
      secFetchSite: undefined,
    }),
    true,
  );
});

test('allows the Vite dev proxy where ports differ across loopback', () => {
  assert.equal(
    isSameOriginRequest({
      method: 'POST',
      origin: 'http://localhost:5173',
      host: 'localhost:3001',
      secFetchSite: undefined,
    }),
    true,
  );
});

test('safe methods are never blocked by the origin check', () => {
  assert.equal(
    isSameOriginRequest({
      method: 'GET',
      origin: 'https://evil.example',
      host: 'localhost:8080',
      secFetchSite: 'cross-site',
    }),
    true,
  );
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SessionStore,
  SESSION_TTL_MS,
  buildSessionCookie,
  parseCookies,
} from './sessions.js';

test('a created session is valid and an unknown token is not', () => {
  const store = new SessionStore();
  const token = store.create();
  assert.equal(store.isValid(token), true);
  assert.equal(store.isValid('not-a-real-token'), false);
  assert.equal(store.isValid(undefined), false);
});

test('a session expires after its TTL', () => {
  let now = 0;
  const store = new SessionStore(() => now);
  const token = store.create();
  now += SESSION_TTL_MS + 1;
  assert.equal(store.isValid(token), false);
});

test('the session cookie is HttpOnly and SameSite=Strict', () => {
  const cookie = buildSessionCookie('abc', false);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(cookie, /Secure/);
});

test('the cookie is marked Secure only over HTTPS', () => {
  assert.match(buildSessionCookie('abc', true), /Secure/);
});

test('parses a cookie header', () => {
  assert.deepEqual(parseCookies('a=1; sv2_ui_session=xyz'), {
    a: '1',
    sv2_ui_session: 'xyz',
  });
});

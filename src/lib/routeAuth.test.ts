import test from 'node:test';
import assert from 'node:assert/strict';
import { isRouteAuthorized } from './routeAuth.js';

test('operational routes reject unauthenticated visitors', () => {
  for (const route of ['/', '/setup', '/settings']) {
    assert.equal(
      isRouteAuthorized(route, null),
      false,
      `${route} must not be available without an authenticated principal`,
    );
  }

  assert.equal(isRouteAuthorized('/faq', null), true);
});

test('operational routes are available to an authenticated principal', () => {
  for (const route of ['/', '/setup', '/settings']) {
    assert.equal(isRouteAuthorized(route, { authenticated: true }), true);
  }
});

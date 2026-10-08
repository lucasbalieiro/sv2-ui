import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';

import { LoginGate } from './LoginGate.js';
import { AUTH_QUERY_KEY, type AuthState } from '../../hooks/useAuth.js';

function render(state: AuthState): string {
  const queryClient = new QueryClient();
  queryClient.setQueryData(AUTH_QUERY_KEY, state);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <Router ssrPath="/">
        <LoginGate>
          <div>dashboard</div>
        </LoginGate>
      </Router>
    </QueryClientProvider>,
  );
}

const cases: Array<[string, AuthState, string]> = [
  ['fresh install opens on the welcome screen',
    { passwordSet: false, authenticated: false, recoveryKeySet: false, needsSetup: true }, 'Start mining'],
  ['configured install without a password goes straight to creating one',
    { passwordSet: false, authenticated: false, recoveryKeySet: false, needsSetup: false }, 'Create an admin password'],
  ['an existing password always requires login',
    { passwordSet: true, authenticated: false, recoveryKeySet: false, needsSetup: true }, 'Unlock sv2-ui'],
  ['a valid session renders the app',
    { passwordSet: true, authenticated: true, recoveryKeySet: true, needsSetup: false }, 'dashboard'],
];

for (const [name, state, expected] of cases) {
  test(name, () => {
    const html = render(state);
    assert.ok(html.includes(expected), `expected "${expected}"`);
    if (expected !== 'dashboard') assert.equal(html.includes('<div>dashboard</div>'), false);
  });
}

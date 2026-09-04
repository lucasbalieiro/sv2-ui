import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';

import { Shell } from './Shell.js';

test('does not present an unverified configured name as the connected pool identity', () => {
  const html = renderToStaticMarkup(
    <Router ssrPath="/">
      <Shell
        connectionStatus="connected"
        poolName="Braiins Pool"
        activePoolAddress="attacker.example"
        activePoolPort={3333}
        activePoolAuthorityPublicKey="9auqWEzQDVyd2oe1JVGFLMLHZtCo2FFqZwtKA5gd9xbuEu7PH72"
      >
        <div>dashboard</div>
      </Shell>
    </Router>,
  );

  assert.equal(
    html.includes('Connected to Braiins Pool'),
    false,
    'a display name from configuration must not be presented as an authenticated ' +
      'pool identity when address, port, and authority key do not match the preset',
  );
});

test('presents a recognized pool name when address, port, and authority key match', () => {
  const html = renderToStaticMarkup(
    <Router ssrPath="/">
      <Shell
        connectionStatus="connected"
        poolName="Braiins Pool"
        activePoolAddress="stratum.braiins.com"
        activePoolPort={3333}
        activePoolAuthorityPublicKey="9awtMD5KQgvRUh2yFbjVeT7b6hjipWcAsQHd6wEhgtDT9soosna"
      >
        <div>dashboard</div>
      </Shell>
    </Router>,
  );

  assert.equal(
    html.includes('Connected to Braiins Pool'),
    true,
    'a recognized pool should display its authenticated name',
  );
});

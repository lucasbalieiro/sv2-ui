import assert from 'node:assert/strict';
import test from 'node:test';

import {
  stripWrappingQuotes,
  isValidPoolAuthorityPubkey,
  getPoolAuthorityPubkeyError,
} from './utils';

const VALID_PUBKEYS = [
  '9awtMD5KQgvRUh2yFbjVeT7b6hjipWcAsQHd6wEhgtDT9soosna', // Braiins
  '9auqWEzQDVyd2oe1JVGFLMLHZtCo2FFqZwtKA5gd9xbuEu7PH72', // SRI
  '9bCoFxTszKCuffyywH5uS5o6WcU4vsjTH2axxc7wE86y2HhvULU', // Blitzpool
];

test('stripWrappingQuotes: returns the input unchanged when no wrapping quotes', () => {
  assert.equal(stripWrappingQuotes('abc'), 'abc');
});

test('stripWrappingQuotes: trims leading and trailing whitespace', () => {
  assert.equal(stripWrappingQuotes('  abc  '), 'abc');
});

test('stripWrappingQuotes: strips a matched pair of wrapping double quotes', () => {
  assert.equal(stripWrappingQuotes('"abc"'), 'abc');
});

test('stripWrappingQuotes: strips a matched pair of wrapping single quotes', () => {
  assert.equal(stripWrappingQuotes("'abc'"), 'abc');
});

test('stripWrappingQuotes: trims then strips quotes', () => {
  assert.equal(stripWrappingQuotes('  "abc"  '), 'abc');
});

test('stripWrappingQuotes: does not strip unmatched quotes', () => {
  assert.equal(stripWrappingQuotes('"abc'), '"abc');
  assert.equal(stripWrappingQuotes('abc"'), 'abc"');
});

test('stripWrappingQuotes: does not strip interior quotes', () => {
  assert.equal(stripWrappingQuotes('a"b"c'), 'a"b"c');
});

test('isValidPoolAuthorityPubkey: accepts known production pubkeys', () => {
  for (const pk of VALID_PUBKEYS) {
    assert.equal(isValidPoolAuthorityPubkey(pk), true, `expected ${pk} to be valid`);
  }
});

test('isValidPoolAuthorityPubkey: accepts a pubkey wrapped in quotes (validator normalizes internally so callers do not need to strip)', () => {
  assert.equal(isValidPoolAuthorityPubkey(`"${VALID_PUBKEYS[1]}"`), true);
});

test('isValidPoolAuthorityPubkey: accepts a pubkey with surrounding whitespace (validator trims internally)', () => {
  assert.equal(isValidPoolAuthorityPubkey(`  ${VALID_PUBKEYS[0]}  `), true);
});

test('isValidPoolAuthorityPubkey: rejects empty string', () => {
  assert.equal(isValidPoolAuthorityPubkey(''), false);
});

test('isValidPoolAuthorityPubkey: rejects whitespace-only string', () => {
  assert.equal(isValidPoolAuthorityPubkey('   '), false);
});

test('isValidPoolAuthorityPubkey: rejects a pubkey with a tampered checksum (last char flipped)', () => {
  const pk = VALID_PUBKEYS[0];
  const flipped = pk.slice(0, -1) + (pk.slice(-1) === 'a' ? 'b' : 'a');
  assert.equal(isValidPoolAuthorityPubkey(flipped), false);
});

test('isValidPoolAuthorityPubkey: rejects a pubkey containing a TOML-breaking interior quote', () => {
  assert.equal(isValidPoolAuthorityPubkey('9aw"MD5KQgvRU'), false);
});

test('isValidPoolAuthorityPubkey: rejects obvious non-base58 input', () => {
  assert.equal(isValidPoolAuthorityPubkey('not a pubkey'), false);
});

test('isValidPoolAuthorityPubkey: rejects a base58-charset string with no checksum (length too short)', () => {
  assert.equal(isValidPoolAuthorityPubkey('9awtMD5K'), false);
});

test('getPoolAuthorityPubkeyError: returns null for empty input (required-ness is enforced separately)', () => {
  assert.equal(getPoolAuthorityPubkeyError(''), null);
});

test('getPoolAuthorityPubkeyError: returns null for valid pubkeys', () => {
  for (const pk of VALID_PUBKEYS) {
    assert.equal(getPoolAuthorityPubkeyError(pk), null, `expected ${pk} to produce no error`);
  }
});

test('getPoolAuthorityPubkeyError: returns null for a valid pubkey wrapped in quotes (validator normalizes internally)', () => {
  assert.equal(getPoolAuthorityPubkeyError(`"${VALID_PUBKEYS[2]}"`), null);
});

test('getPoolAuthorityPubkeyError: returns a message for an invalid pubkey', () => {
  assert.match(getPoolAuthorityPubkeyError('not-a-real-pubkey') ?? '', /invalid/i);
});

test('getPoolAuthorityPubkeyError: returns a message for a tampered-checksum pubkey', () => {
  const pk = VALID_PUBKEYS[0];
  const flipped = pk.slice(0, -1) + (pk.slice(-1) === 'a' ? 'b' : 'a');
  assert.match(getPoolAuthorityPubkeyError(flipped) ?? '', /invalid/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { otherTheme, resolveTheme } from './theme.js';

test('a stored choice wins over the device setting', () => {
  assert.equal(resolveTheme('dark', true), 'dark');
  assert.equal(resolveTheme('light', false), 'light');
});

test('without a choice the device setting decides; unknown values are ignored', () => {
  assert.equal(resolveTheme(null, true), 'light');
  assert.equal(resolveTheme(null, false), 'dark');
  assert.equal(resolveTheme('purple', true), 'light');
  assert.equal(resolveTheme('', false), 'dark');
});

test('otherTheme flips', () => {
  assert.equal(otherTheme('dark'), 'light');
  assert.equal(otherTheme('light'), 'dark');
});

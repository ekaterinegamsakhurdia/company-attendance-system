import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyNetworkError, parseNetworkLines } from './networks.js';

test('parses label + address, address only, ranges and IPv6', () => {
  const items = parseNetworkLines(
    ['Main office, 203.0.113.7', '198.51.100.0/28', 'Branch, Batumi; 192.0.2.5', '', '# comment', '  2001:db8:1:2::/64  '].join('\n'),
  );
  assert.deepEqual(
    items.map((i) => [i.line, i.label, i.network]),
    [
      [1, 'Main office', '203.0.113.7'],
      [2, '198.51.100.0/28', '198.51.100.0/28'],
      [3, 'Branch, Batumi', '192.0.2.5'],
      [6, '2001:db8:1:2::/64', '2001:db8:1:2::/64'],
    ],
  );
});

test('handles Windows line endings, tabs and long labels', () => {
  const items = parseNetworkLines(`Office\t203.0.113.9\r\n${'x'.repeat(120)}, 203.0.113.10`);
  assert.equal(items[0].label, 'Office');
  assert.equal(items[0].network, '203.0.113.9');
  assert.equal(items[1].label.length, 80);
});

test('empty input gives no items', () => {
  assert.deepEqual(parseNetworkLines(''), []);
  assert.deepEqual(parseNetworkLines(null), []);
});

test('error messages are friendly', () => {
  assert.match(friendlyNetworkError('duplicate key value violates unique constraint "allowed_networks_network_key"'), /Already in the list/);
  assert.match(friendlyNetworkError('invalid input syntax for type cidr: "abc"'), /Not a valid IP/);
  assert.match(friendlyNetworkError('invalid cidr value: "10.1.1.1/8"'), /Not a valid IP/);
  assert.equal(friendlyNetworkError('boom'), 'boom');
});

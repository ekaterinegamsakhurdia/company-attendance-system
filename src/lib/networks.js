// Helpers for the "company networks" list (no limit on how many there can be).

/**
 * One network per line. Accepted shapes:
 *   Main office, 203.0.113.7
 *   Branch Batumi; 198.51.100.0/28
 *   2001:db8:1234:5678::/64           (label defaults to the address)
 * Blank lines and lines starting with # are ignored.
 */
export function parseNetworkLines(text) {
  const items = [];
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const match = line.match(/^(.*?)[,;\t]\s*([^,;\t]+)$/);
      const network = (match ? match[2] : line).trim();
      const label = (match ? match[1] : '').trim() || network;
      items.push({ line: index + 1, label: label.slice(0, 80), network });
    });
  return items;
}

/** Turns a Postgres error about the networks table into something a person can act on. */
export function friendlyNetworkError(message) {
  const text = String(message ?? '');
  if (/duplicate key|already exists/i.test(text)) return 'Already in the list.';
  if (/invalid (input syntax for type )?cidr|invalid input syntax for type inet/i.test(text)) {
    return 'Not a valid IP address or range. For a range use its first address, e.g. 203.0.113.0/24.';
  }
  return text || 'Could not add this network.';
}

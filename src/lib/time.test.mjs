import test from 'node:test';
import assert from 'node:assert/strict';
import { fromDateTimeLocal, toDateTimeLocal, formatWorked, formatDate, todayInTz, formatTime } from './time.js';
import { csvCell, toCsv } from './csv.js';

test('wall time in Tbilisi (UTC+4) round-trips', () => {
  const iso = fromDateTimeLocal('2026-10-07T11:00', 'Asia/Tbilisi');
  assert.equal(iso, '2026-10-07T07:00:00.000Z');
  assert.equal(toDateTimeLocal(iso, 'Asia/Tbilisi'), '2026-10-07T11:00');
});

test('DST zone: New York summer vs winter', () => {
  assert.equal(fromDateTimeLocal('2026-07-01T09:00', 'America/New_York'), '2026-07-01T13:00:00.000Z');
  assert.equal(fromDateTimeLocal('2026-12-01T09:00', 'America/New_York'), '2026-12-01T14:00:00.000Z');
});

test('midnight renders as 00:00, not 24:00', () => {
  assert.equal(toDateTimeLocal('2026-10-06T20:00:00Z', 'Asia/Tbilisi'), '2026-10-07T00:00');
});

test('today uses company zone, not UTC', () => {
  assert.equal(todayInTz('Asia/Tbilisi', new Date('2026-10-07T21:30:00Z')), '2026-10-08');
  assert.equal(todayInTz('UTC', new Date('2026-10-07T21:30:00Z')), '2026-10-07');
});

test('formatters', () => {
  assert.equal(formatWorked(485), '8h 05m');
  assert.equal(formatWorked(null), '-');
  assert.equal(formatDate('2026-10-07'), '07.10.2026');
  assert.equal(formatTime('2026-10-07T07:00:00Z', 'Asia/Tbilisi'), '11:00');
});

test('csv escaping and formula-injection guard', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell(-5), '-5');
  assert.equal(toCsv([{ n: 'Ann' }], [{ label: 'Name', get: (r) => r.n }]), 'Name\r\nAnn');
});

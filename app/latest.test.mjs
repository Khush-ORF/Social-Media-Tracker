import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLatest } from './utils.mjs';

const success = { id: 'a', platform: 'Instagram', profile_url: 'https://www.instagram.com/a', name: 'A', status: 'collected', count: '0', captured_at: '2026-09-22T00:00:00Z' };
const failed = { ...success, status: 'failed', count: '', error: 'HTTP 429', captured_at: '2026-09-23T00:00:00Z' };
test('failed attempt remains missing even when a previous count exists', () => {
  const [row] = buildLatest([failed, success]);
  assert.equal(row.status, 'failed');
  assert.equal(row.count, '');
  assert.equal(row.captured_at, failed.captured_at);
  assert.equal(row.last_success, undefined);
  assert.equal(failed.last_success, undefined);
});
test('never carries counts across changed profiles or inactive accounts', () => {
  assert.equal(buildLatest([success, { ...failed, profile_url: 'https://www.instagram.com/b' }])[0].count, '');
  assert.deepEqual(buildLatest([success, failed], []), []);
});
test('new successful observation replaces fallback', () => {
  const fresh = { ...success, count: '123', captured_at: '2026-09-24T00:00:00Z' };
  const [row] = buildLatest([fresh, failed, success]);
  assert.equal(row.count, '123');
  assert.equal(row.last_success, undefined);
});

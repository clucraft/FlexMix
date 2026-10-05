import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertStation, removeStation, findStation, sanitizeStations, MAX_NAME_LENGTH } from '../src/stations.js';

test('upsert adds new stations most-recent first', () => {
  let list = upsertStation([], { name: 'Sheetz Rt 30', e85E: 78.4, updated: '2026-10-01' });
  list = upsertStation(list, { name: 'Wawa', e85E: 72, updated: '2026-10-05' });
  assert.deepEqual(list.map((s) => s.name), ['Wawa', 'Sheetz Rt 30']);
});

test('upsert updates an existing station by name, ignoring case and spaces', () => {
  let list = upsertStation([], { name: 'Sheetz Rt 30', e85E: 78.4, updated: '2026-10-01' });
  list = upsertStation(list, { name: 'Wawa', e85E: 72, updated: '2026-10-02' });
  list = upsertStation(list, { name: '  sheetz rt 30 ', e85E: 74.1, updated: '2026-10-05' });
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { name: 'sheetz rt 30', e85E: 74.1, updated: '2026-10-05' });
});

test('upsert rejects blank names and trims long ones', () => {
  assert.throws(() => upsertStation([], { name: '   ', e85E: 80, updated: '2026-10-05' }));
  const [s] = upsertStation([], { name: 'x'.repeat(60), e85E: 80, updated: '2026-10-05' });
  assert.equal(s.name.length, MAX_NAME_LENGTH);
});

test('remove and find match by name', () => {
  const list = [{ name: 'Wawa', e85E: 72, updated: '2026-10-05' }, { name: 'Sheetz', e85E: 78, updated: '2026-10-01' }];
  assert.equal(findStation(list, 'WAWA').e85E, 72);
  assert.equal(findStation(list, 'nope'), null);
  assert.deepEqual(removeStation(list, 'wawa').map((s) => s.name), ['Sheetz']);
});

test('sanitize drops malformed entries', () => {
  assert.deepEqual(sanitizeStations(null), []);
  assert.deepEqual(sanitizeStations([{ name: 'ok', e85E: 80, updated: 'x' }, { name: '', e85E: 1, updated: 'x' }, { name: 'bad', e85E: '80', updated: 'x' }, null]),
    [{ name: 'ok', e85E: 80, updated: 'x' }]);
});

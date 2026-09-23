import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, validate, DEFAULTS } from '../src/calc.js';

const base = { ...DEFAULTS, capacity: 17.2, pumpE: 10, e85E: 80, fillTo: 100 };

const near = (actual, expected, tol = 0.005) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ≈${expected}, got ${actual}`);

test('reachable target: 25% of 17.2 gal at E30 → E40', () => {
  const r = calculate({ ...base, level: 25, currentE: 30, targetE: 40 });
  assert.equal(r.status, 'ok');
  near(r.e85Gal, 6.14);
  near(r.pumpGal, 6.76);
  near(r.totalGal, 12.9);
  assert.equal(r.blendPct.toFixed(1), '40.0');
  assert.equal(r.limitPct, null);
});

test('unreachable high: 50% at E10, target E60 → max E45.0, E85 only', () => {
  const r = calculate({ ...base, level: 50, currentE: 10, targetE: 60 });
  assert.equal(r.status, 'too-high');
  assert.equal(r.limitPct.toFixed(1), '45.0');
  near(r.e85Gal, 8.6);
  assert.equal(r.pumpGal, 0);
  assert.equal(r.blendPct.toFixed(1), '45.0');
});

test('unreachable low: 75% at E50, target E30 → min E40.0, pump gas only', () => {
  const r = calculate({ ...base, level: 75, currentE: 50, targetE: 30 });
  assert.equal(r.status, 'too-low');
  assert.equal(r.limitPct.toFixed(1), '40.0');
  assert.equal(r.e85Gal, 0);
  near(r.pumpGal, 4.3);
  assert.equal(r.blendPct.toFixed(1), '40.0');
});

test('validation: E85 ethanol must exceed pump gas ethanol', () => {
  assert.ok(validate({ ...base, e85E: 10, pumpE: 10 }).e85E);
  assert.ok(validate({ ...base, e85E: 5, pumpE: 10 }).e85E);
  const r = calculate({ ...base, e85E: 10, pumpE: 10 });
  assert.equal(r.status, 'invalid');
  assert.ok(r.errors.e85E);
});

test('validation: fill-to must exceed current level', () => {
  assert.ok(validate({ ...base, level: 100, fillTo: 100 }).fillTo);
  assert.ok(validate({ ...base, level: 80, fillTo: 60 }).fillTo);
  const r = calculate({ ...base, level: 90, fillTo: 90 });
  assert.equal(r.status, 'invalid');
  assert.ok(r.errors.fillTo);
});

test('validation: defaults are valid; bad capacity and out-of-range percents are caught', () => {
  assert.deepEqual(validate(DEFAULTS), {});
  assert.ok(validate({ ...base, capacity: 0 }).capacity);
  assert.ok(validate({ ...base, capacity: NaN }).capacity);
  assert.ok(validate({ ...base, targetE: 101 }).targetE);
  assert.ok(validate({ ...base, currentE: -1 }).currentE);
});

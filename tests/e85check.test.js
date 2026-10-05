import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, estimateE85Content, DEFAULTS } from '../src/calc.js';

const near = (actual, expected, tol = 0.05) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ≈${expected}, got ${actual}`);

// 25% of 17.2 gal at E30, pumped 6.14 gal E85 + 6.76 gal E10, sensor reads E40.
const fill = { capacity: 17.2, level: 25, currentE: 30, pumpE: 10, e85Added: 6.14, pumpAdded: 6.76, measuredE: 40 };

test('estimates station E85 content from the post-fill sensor reading', () => {
  const r = estimateE85Content(fill);
  assert.equal(r.status, 'ok');
  near(r.e85Pct, 80.0);
  near(r.errorPerPoint, 2.8);
  assert.equal(r.outsideLegal, false);
  assert.equal(r.overCapacity, false);
});

test('round trip: a planned fill at a known E85 content estimates back to it', () => {
  for (const e85E of [55, 70, 80]) {
    const plan = calculate({ ...DEFAULTS, level: 20, currentE: 15, targetE: 40, e85E });
    assert.equal(plan.status, 'ok');
    const r = estimateE85Content({
      capacity: DEFAULTS.capacity, level: 20, currentE: 15, pumpE: DEFAULTS.pumpE,
      e85Added: plan.e85Gal, pumpAdded: plan.pumpGal, measuredE: plan.blendPct,
    });
    near(r.e85Pct, e85E, 1e-9);
  }
});

test('a low tank filled with E85 only gives a much tighter estimate', () => {
  const r = estimateE85Content({ ...fill, level: 10, e85Added: 15.48, pumpAdded: 0, measuredE: 75 });
  near(r.errorPerPoint, 1.1);
});

test('one point of sensor error moves the estimate by errorPerPoint', () => {
  const a = estimateE85Content(fill);
  const b = estimateE85Content({ ...fill, measuredE: 41 });
  near(b.e85Pct - a.e85Pct, a.errorPerPoint, 1e-9);
});

test('flags results outside the legal range and impossible results', () => {
  assert.equal(estimateE85Content({ ...fill, measuredE: 42 }).outsideLegal, true); // ≈E85.6
  assert.equal(estimateE85Content({ ...fill, measuredE: 10 }).status, 'implausible');
  assert.equal(estimateE85Content({ ...fill, measuredE: 70 }).status, 'implausible');
});

test('flags more fuel added than the tank can hold', () => {
  assert.equal(estimateE85Content({ ...fill, level: 50 }).overCapacity, true);
});

test('validation: needs some E85, non-negative pump gas and a sensor reading', () => {
  assert.ok(estimateE85Content({ ...fill, e85Added: 0 }).errors.e85Added);
  assert.ok(estimateE85Content({ ...fill, pumpAdded: -1 }).errors.pumpAdded);
  assert.ok(estimateE85Content({ ...fill, measuredE: NaN }).errors.measuredE);
  assert.ok(estimateE85Content({ ...fill, measuredE: 101 }).errors.measuredE);
  assert.equal(estimateE85Content({ ...fill, capacity: 0 }).status, 'invalid');
});

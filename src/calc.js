// FlexMix blend math. Pure functions only — no DOM access — so this module
// can be imported by both the browser UI and `node --test`.
//
// Inputs are given the way a person types them: percentages as 0–100,
// capacity in US gallons, octane as AKI.

export const DEFAULTS = Object.freeze({
  capacity: 17.2, // 2021 BMW X3 M40i
  level: 25,
  currentE: 10,
  targetE: 30,
  pumpAki: 93,
  pumpE: 10,
  e85E: 80,
  fillTo: 100,
  e85Aki: 100,
});

// Floating-point slack when deciding whether the target is reachable, so a
// target that sits exactly on the min/max boundary isn't flagged unreachable.
const EPS = 1e-9;

const PERCENT_FIELDS = {
  level: 'Fuel level',
  currentE: 'Current ethanol',
  targetE: 'Desired ethanol',
  pumpE: 'Pump gas ethanol',
  e85E: 'E85 ethanol content',
  fillTo: 'Fill to',
};

function checkCapacity(errors, inputs) {
  if (!Number.isFinite(inputs.capacity)) {
    errors.capacity = 'Tank capacity: enter a number.';
  } else if (inputs.capacity <= 0) {
    errors.capacity = 'Tank capacity must be greater than 0.';
  }
}

function checkPercent(errors, inputs, key, label) {
  const v = inputs[key];
  if (!Number.isFinite(v)) {
    errors[key] = `${label}: enter a number.`;
  } else if (v < 0 || v > 100) {
    errors[key] = `${label} must be between 0 and 100%.`;
  }
}

/**
 * Validate raw inputs. Returns an object mapping field name → message;
 * an empty object means everything is valid.
 */
export function validate(inputs) {
  const errors = {};

  checkCapacity(errors, inputs);
  for (const [key, label] of Object.entries(PERCENT_FIELDS)) checkPercent(errors, inputs, key, label);

  for (const [key, label] of [['pumpAki', 'Pump gas octane'], ['e85Aki', 'E85 octane']]) {
    const v = inputs[key];
    if (!Number.isFinite(v) || v <= 0) errors[key] = `${label}: enter a positive number.`;
  }

  if (!errors.level && !errors.fillTo && inputs.fillTo <= inputs.level) {
    errors.fillTo = 'Fill-to level must be higher than the current fuel level.';
  }

  if (!errors.pumpE && !errors.e85E && inputs.e85E <= inputs.pumpE) {
    errors.e85E = 'E85 ethanol must be higher than pump gas ethanol.';
  }

  return errors;
}

/**
 * Rough octane estimate by linear interpolation between pump gas and E85.
 * All ethanol values are fractions (0–1).
 */
export function estimateAki({ blend, eg, e85, pumpAki, e85Aki }) {
  return pumpAki + ((blend - eg) / (e85 - eg)) * (e85Aki - pumpAki);
}

/**
 * Work out how much E85 and pump gas to add.
 *
 * Returns { status, errors } where status is one of:
 *   'invalid'  – errors holds per-field messages; nothing else is set
 *   'ok'       – target is reachable
 *   'too-low'  – target below what's possible; result is an all-pump-gas fill
 *   'too-high' – target above what's possible; result is an all-E85 fill
 * For every status except 'invalid' it also returns e85Gal, pumpGal,
 * totalGal, blendPct, estAki, and limitPct (the min or max achievable blend
 * for 'too-low' / 'too-high', otherwise null).
 */
export function calculate(inputs) {
  const errors = validate(inputs);
  if (Object.keys(errors).length > 0) return { status: 'invalid', errors };

  const C = inputs.capacity;
  const L = inputs.level / 100;
  const F = inputs.fillTo / 100;
  const e0 = inputs.currentE / 100;
  const et = inputs.targetE / 100;
  const eg = inputs.pumpE / 100;
  const e85 = inputs.e85E / 100;

  const V0 = C * L; // fuel in the tank now
  const Vf = C * F; // fuel after the fill
  const S = Vf - V0; // gallons to add

  let x = (Vf * et - V0 * e0 - S * eg) / (e85 - eg);
  let status = 'ok';
  let limit = null;

  if (x < -EPS) {
    status = 'too-low';
    x = 0;
    limit = (V0 * e0 + S * eg) / Vf;
  } else if (x > S + EPS) {
    status = 'too-high';
    x = S;
    limit = (V0 * e0 + S * e85) / Vf;
  } else {
    x = Math.min(Math.max(x, 0), S);
  }

  const y = S - x;
  const blend = (V0 * e0 + x * e85 + y * eg) / Vf;

  return {
    status,
    errors,
    e85Gal: x,
    pumpGal: y,
    totalGal: S,
    blendPct: blend * 100,
    limitPct: limit === null ? null : limit * 100,
    estAki: estimateAki({ blend, eg, e85, pumpAki: inputs.pumpAki, e85Aki: inputs.e85Aki }),
  };
}

// Legal US range for E85 (ASTM D5798), used to flag suspicious estimates.
export const E85_LEGAL_MIN = 51;
export const E85_LEGAL_MAX = 83;

/**
 * Validate the after-fill check inputs. Uses the pre-fill tank values
 * (capacity, level, currentE, pumpE) plus what was actually pumped
 * (e85Added, pumpAdded, in gallons) and the sensor reading after the
 * fill (measuredE, percent).
 */
export function validateE85Check(inputs) {
  const errors = {};

  checkCapacity(errors, inputs);
  checkPercent(errors, inputs, 'level', 'Fuel level');
  checkPercent(errors, inputs, 'currentE', 'Current ethanol');
  checkPercent(errors, inputs, 'pumpE', 'Pump gas ethanol');
  checkPercent(errors, inputs, 'measuredE', 'Ethanol after the fill');

  if (!Number.isFinite(inputs.e85Added)) {
    errors.e85Added = 'E85 pumped: enter a number.';
  } else if (inputs.e85Added <= 0) {
    errors.e85Added = 'E85 pumped must be more than 0 gal. This check needs some E85 in the fill.';
  }

  if (!Number.isFinite(inputs.pumpAdded)) {
    errors.pumpAdded = 'Pump gas pumped: enter a number (0 if none).';
  } else if (inputs.pumpAdded < 0) {
    errors.pumpAdded = 'Pump gas pumped can’t be negative.';
  }

  return errors;
}

/**
 * Back-calculate the E85's ethanol content from a sensor reading taken
 * after the fill:
 *
 *   measured·Vf = V0·e0 + x·e85 + y·eg   →   e85 = (measured·Vf − V0·e0 − y·eg) / x
 *
 * with V0 = C·L and Vf = V0 + x + y (actual gallons from the pump display).
 *
 * Returns { status, errors } where status is 'invalid', 'implausible'
 * (the answer falls outside 0–100%, so an input must be wrong) or 'ok'.
 * Unless invalid, it also returns:
 *   e85Pct        – estimated E85 ethanol content (%)
 *   errorPerPoint – how many points e85Pct moves per 1 point of sensor error (Vf/x)
 *   outsideLegal  – e85Pct is outside the legal 51–83% range
 *   overCapacity  – more fuel than the tank holds, so the level was likely too high
 */
export function estimateE85Content(inputs) {
  const errors = validateE85Check(inputs);
  if (Object.keys(errors).length > 0) return { status: 'invalid', errors };

  const V0 = inputs.capacity * (inputs.level / 100);
  const x = inputs.e85Added;
  const y = inputs.pumpAdded;
  const Vf = V0 + x + y;
  const e0 = inputs.currentE / 100;
  const eg = inputs.pumpE / 100;
  const measured = inputs.measuredE / 100;

  const e85Pct = ((measured * Vf - V0 * e0 - y * eg) / x) * 100;

  return {
    status: e85Pct < 0 || e85Pct > 100 ? 'implausible' : 'ok',
    errors,
    e85Pct,
    errorPerPoint: Vf / x,
    outsideLegal: e85Pct < E85_LEGAL_MIN || e85Pct > E85_LEGAL_MAX,
    overCapacity: Vf > inputs.capacity * 1.03,
  };
}

import { DEFAULTS, calculate, estimateE85Content } from './calc.js';
import { sanitizeStations, upsertStation, removeStation, findStation } from './stations.js';

const STORAGE_KEY = 'flexmix.inputs.v1';
const STATIONS_KEY = 'flexmix.stations.v1';

// Plain numeric text inputs, keyed by the calc.js field name.
const NUMBER_FIELDS = ['capacity', 'level', 'currentE', 'targetE', 'pumpE', 'e85E', 'fillTo', 'e85Aki'];
const ADVANCED_FIELDS = ['fillTo', 'e85Aki'];
// "Check station E85" inputs: what was actually pumped and the sensor reading after.
const CHECK_FIELDS = ['e85Added', 'pumpAdded', 'measuredE'];
// Fields the check shares with the main form; errors there are shown on the main form.
const SHARED_FIELDS = ['capacity', 'level', 'currentE', 'pumpE'];
const PRESET_AKI = ['87', '89', '91', '93'];
// Suggest re-checking a saved station after this long — E85 blends change seasonally.
const STALE_DAYS = 60;

const $ = (id) => document.getElementById(id);

let stations = [];
let lastPlan = null; // most recent calculate() result, used to prefill the check
let checkMessage = null; // confirmation shown after "Use this value", until the next edit

// Raw form state is kept as strings so half-typed values survive a reload.
function defaultState() {
  const state = {};
  for (const key of NUMBER_FIELDS) state[key] = String(DEFAULTS[key]);
  for (const key of CHECK_FIELDS) state[key] = '';
  const aki = String(DEFAULTS.pumpAki);
  state.pumpAkiSelect = PRESET_AKI.includes(aki) ? aki : 'custom';
  state.pumpAkiCustom = PRESET_AKI.includes(aki) ? '' : aki;
  state.station = '';
  return state;
}

function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null; // Storage unavailable or corrupt — caller falls back to defaults.
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota) — the app still works.
  }
}

function loadState() {
  const state = defaultState();
  const saved = readStorage(STORAGE_KEY);
  if (saved && typeof saved === 'object') {
    for (const key of Object.keys(state)) {
      if (typeof saved[key] === 'string') state[key] = saved[key];
    }
  }
  return state;
}

function readState() {
  const state = {};
  for (const key of [...NUMBER_FIELDS, ...CHECK_FIELDS]) state[key] = $(key).value;
  state.pumpAkiSelect = $('pumpAkiSelect').value;
  state.pumpAkiCustom = $('pumpAkiCustom').value;
  state.station = $('station').value;
  return state;
}

function writeState(state) {
  for (const key of [...NUMBER_FIELDS, ...CHECK_FIELDS]) $(key).value = state[key];
  $('pumpAkiSelect').value = PRESET_AKI.includes(state.pumpAkiSelect) ? state.pumpAkiSelect : 'custom';
  $('pumpAkiCustom').value = state.pumpAkiCustom;
  $('station').value = findStation(stations, state.station)?.name ?? '';
}

// Accept "12,5" as well as "12.5" — some phone keypads only offer a comma.
function parseNum(raw) {
  const s = String(raw).trim().replace(',', '.');
  return s === '' ? NaN : Number(s);
}

function toInputs(state) {
  const inputs = {};
  for (const key of [...NUMBER_FIELDS, ...CHECK_FIELDS]) inputs[key] = parseNum(state[key]);
  inputs.pumpAki = state.pumpAkiSelect === 'custom' ? parseNum(state.pumpAkiCustom) : Number(state.pumpAkiSelect);
  return inputs;
}

const icon = (name) => `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

const gal = (v) => v.toFixed(2);
const pct = (v) => v.toFixed(1);
const octaneLabel = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// ---------- Dates (stations store a local YYYY-MM-DD) ----------

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function shortDate(iso) {
  const date = parseIso(iso);
  const opts = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString(undefined, opts);
}

const daysSince = (iso) => Math.floor((parseIso(todayIso()) - parseIso(iso)) / 86400000);

// ---------- Errors ----------

function setFieldError(key, msg, inputId = key) {
  const msgEl = $(`${key}-error`);
  const input = $(inputId);
  msgEl.textContent = msg || '';
  msgEl.hidden = !msg;
  input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  const hintId = input.getAttribute('aria-describedby')?.split(' ').find((id) => id.endsWith('-hint'));
  const describedBy = [hintId, msg ? msgEl.id : null].filter(Boolean).join(' ');
  if (describedBy) input.setAttribute('aria-describedby', describedBy);
  else input.removeAttribute('aria-describedby');
}

function showErrors(errors) {
  for (const key of NUMBER_FIELDS) setFieldError(key, errors[key]);
  setFieldError('pumpAki', errors.pumpAki, 'pumpAkiCustom');
  // Errors inside the collapsed Advanced card would otherwise be invisible.
  if (ADVANCED_FIELDS.some((k) => errors[k])) $('advanced').open = true;
}

// ---------- Main result ----------

function renderResult(r, pumpAki) {
  const out = $('result');
  if (r.status === 'invalid') {
    const items = Object.values(r.errors).map((m) => `<li>${m}</li>`).join('');
    out.innerHTML = `<p class="result-invalid">${icon('alert')}Check your inputs</p><ul class="error-list">${items}</ul>`;
    return;
  }

  let notice = '';
  if (r.status === 'too-low') {
    notice = `<p class="notice">${icon('warn')}<span>Lowest possible this fill is <strong>E${pct(r.limitPct)}</strong>: add pump gas only.</span></p>`;
  } else if (r.status === 'too-high') {
    notice = `<p class="notice">${icon('warn')}<span>Highest possible this fill is <strong>E${pct(r.limitPct)}</strong>: add E85 only.</span></p>`;
  }

  out.innerHTML = `
    ${notice}
    <p class="big"><span class="step">1</span><span><span class="verb">${icon('drop')}Add</span> <strong>${gal(r.e85Gal)} gal E85</strong></span></p>
    <p class="big"><span class="step">2</span><span><span class="verb">${icon('pump')}Fill</span> <strong>${gal(r.pumpGal)} gal of ${octaneLabel(pumpAki)}</strong></span></p>
    <dl class="stats">
      <div><dt>Total added</dt><dd>${gal(r.totalGal)} gal</dd></div>
      <div><dt>Resulting blend</dt><dd>E${pct(r.blendPct)}</dd></div>
      <div><dt>Est. octane*</dt><dd>≈ ${pct(r.estAki)} AKI</dd></div>
    </dl>`;
}

// ---------- Saved stations ----------

function saveStations() {
  writeStorage(STATIONS_KEY, stations);
}

function renderStationOptions() {
  const select = $('station');
  const selected = select.value;
  select.replaceChildren(new Option('None', ''));
  for (const s of stations) {
    select.add(new Option(`${s.name} · E${pct(s.e85E)} · ${shortDate(s.updated)}`, s.name));
  }
  select.value = findStation(stations, selected)?.name ?? '';
  $('stationNames').replaceChildren(...stations.map((s) => new Option('', s.name)));
  $('stationField').hidden = stations.length === 0;
}

function syncStationControls() {
  const station = findStation(stations, $('station').value);
  const remove = $('removeStation');
  remove.hidden = !station;
  if (!station) resetRemoveButton();

  const hint = $('station-hint');
  if (station && daysSince(station.updated) > STALE_DAYS) {
    hint.textContent = `Measured ${daysSince(station.updated)} days ago. E85 changes with the season, so consider re-checking it.`;
  } else {
    hint.textContent = 'Fills in the E85 content you measured at that station.';
  }
}

let removeTimer = null;
function resetRemoveButton() {
  clearTimeout(removeTimer);
  const btn = $('removeStation');
  delete btn.dataset.confirm;
  btn.lastElementChild.textContent = '';
  btn.setAttribute('aria-label', 'Remove saved station');
}

function onRemoveStation() {
  const btn = $('removeStation');
  if (!btn.dataset.confirm) {
    // Two-tap confirm instead of a confirm() popup.
    btn.dataset.confirm = '1';
    btn.lastElementChild.textContent = 'Remove?';
    btn.setAttribute('aria-label', 'Tap again to remove saved station');
    removeTimer = setTimeout(resetRemoveButton, 4000);
    return;
  }
  stations = removeStation(stations, $('station').value);
  saveStations();
  $('station').value = '';
  renderStationOptions();
  update();
}

// Picking a station loads its measured E85 content.
function applySelectedStation() {
  const station = findStation(stations, $('station').value);
  if (station) $('e85E').value = String(station.e85E);
}

// Typing a different E85 value means it no longer reflects the selected station.
function deselectIfEdited() {
  const station = findStation(stations, $('station').value);
  if (station && parseNum($('e85E').value) !== station.e85E) $('station').value = '';
}

// ---------- Check station E85 ----------

function prefillCheck() {
  const empty = CHECK_FIELDS.every((k) => $(k).value.trim() === '');
  if (empty && lastPlan && lastPlan.status !== 'invalid') {
    $('e85Added').value = gal(lastPlan.e85Gal);
    $('pumpAdded').value = gal(lastPlan.pumpGal);
  }
  if (!$('stationName').value.trim()) $('stationName').value = $('station').value;
  update();
}

let lastEstimate = null;

function renderCheck(inputs) {
  const out = $('checkResult');
  const save = $('checkSave');
  lastEstimate = null;

  const idle = CHECK_FIELDS.some((k) => $(k).value.trim() === '');
  if (idle) {
    for (const key of CHECK_FIELDS) setFieldError(key, null);
    save.hidden = true;
    if (checkMessage) {
      out.innerHTML = `<p class="saved">${icon('check')}<span></span></p>`;
      out.querySelector('span').textContent = checkMessage;
    } else {
      out.innerHTML = '';
    }
    return;
  }

  const r = estimateE85Content(inputs);
  for (const key of CHECK_FIELDS) setFieldError(key, r.errors[key]);

  if (r.status === 'invalid') {
    save.hidden = true;
    out.innerHTML = SHARED_FIELDS.some((k) => r.errors[k])
      ? `<p class="notice">${icon('alert')}<span>Fix the highlighted fields above first.</span></p>`
      : '';
    return;
  }

  if (r.status === 'implausible') {
    save.hidden = true;
    out.innerHTML = `
      <p class="result-invalid">${icon('alert')}That doesn't add up</p>
      <p class="check-text">It works out to E${pct(r.e85Pct)}, which isn't possible. Check the gallons, the sensor reading, and that <strong>Current tank</strong> still shows the values from before this fill.</p>`;
    return;
  }

  lastEstimate = r;
  const notes = [];
  if (r.outsideLegal) {
    notes.push(`<p class="notice">${icon('warn')}<span>That's outside the legal E85 range of 51–83%. Double-check the sensor reading and the gallons.</span></p>`);
  }
  if (r.overCapacity) {
    notes.push(`<p class="notice">${icon('warn')}<span>That's more fuel than your tank holds, so the fuel level before the fill was probably lower than entered.</span></p>`);
  }
  if (r.errorPerPoint > 2) {
    notes.push(`<p class="check-tip">${icon('bulb')}<span>For a tighter estimate, run the tank low and fill with E85 only.</span></p>`);
  }

  out.innerHTML = `
    <p class="check-label">This station's E85 is about</p>
    <p class="check-value">E${pct(r.e85Pct)}</p>
    <p class="check-range">±${r.errorPerPoint.toFixed(1)} for each 1% the sensor reading is off</p>
    ${notes.join('')}`;

  save.hidden = false;
  $('useE85').lastElementChild.textContent = $('stationName').value.trim() ? 'Save & use this value' : 'Use this value';
}

function onUseE85() {
  if (!lastEstimate) return;
  const value = Math.round(lastEstimate.e85Pct * 10) / 10;
  const name = $('stationName').value.trim();

  if (name) {
    stations = upsertStation(stations, { name, e85E: value, updated: todayIso() });
    saveStations();
    renderStationOptions();
    $('station').value = findStation(stations, name).name;
    checkMessage = `Saved ${findStation(stations, name).name} at E${pct(value)} and set it as your E85 content.`;
  } else {
    $('station').value = '';
    checkMessage = `Set your E85 content to E${pct(value)}.`;
  }

  $('e85E').value = String(value);
  for (const key of CHECK_FIELDS) $(key).value = '';
  $('stationName').value = '';
  update();
}

// ---------- Wiring ----------

function syncControls(state) {
  $('pumpAkiCustomWrap').hidden = state.pumpAkiSelect !== 'custom';

  const level = parseNum(state.level);
  if (Number.isFinite(level)) $('levelRange').value = String(Math.min(Math.max(level, 0), 100));

  const target = parseNum(state.targetE);
  for (const chip of document.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(Number(chip.dataset.target) === target));
  }

  syncStationControls();
}

function update() {
  const state = readState();
  writeStorage(STORAGE_KEY, state);
  syncControls(state);
  const inputs = toInputs(state);
  lastPlan = calculate(inputs);
  showErrors(lastPlan.errors);
  renderResult(lastPlan, inputs.pumpAki);
  renderCheck(inputs);
}

function init() {
  stations = sanitizeStations(readStorage(STATIONS_KEY));
  renderStationOptions();
  writeState(loadState());

  $('form').addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'levelRange') $('level').value = e.target.value;
    if (id === 'station') applySelectedStation();
    if (id === 'e85E') deselectIfEdited();
    if (CHECK_FIELDS.includes(id)) checkMessage = null;
    update();
  });
  $('form').addEventListener('change', update);
  $('form').addEventListener('submit', (e) => e.preventDefault());

  for (const chip of document.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      $('targetE').value = chip.dataset.target;
      update();
    });
  }

  $('pumpAkiSelect').addEventListener('change', () => {
    if ($('pumpAkiSelect').value === 'custom') $('pumpAkiCustom').focus();
  });

  $('removeStation').addEventListener('click', onRemoveStation);
  $('check').addEventListener('toggle', () => {
    if ($('check').open) prefillCheck();
  });
  $('useE85').addEventListener('click', onUseE85);

  // Reset restores the inputs; saved stations are kept.
  $('reset').addEventListener('click', () => {
    writeState(defaultState());
    $('stationName').value = '';
    checkMessage = null;
    $('advanced').open = false;
    $('check').open = false;
    update();
  });

  update();
}

init();

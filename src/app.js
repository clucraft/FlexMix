import { DEFAULTS, calculate } from './calc.js';

const STORAGE_KEY = 'flexmix.inputs.v1';

// Plain numeric text inputs, keyed by the calc.js field name.
const NUMBER_FIELDS = ['capacity', 'level', 'currentE', 'targetE', 'pumpE', 'e85E', 'fillTo', 'e85Aki'];
const ADVANCED_FIELDS = ['fillTo', 'e85Aki'];
const PRESET_AKI = ['87', '89', '91', '93'];

const $ = (id) => document.getElementById(id);

// Raw form state is kept as strings so half-typed values survive a reload.
function defaultState() {
  const state = {};
  for (const key of NUMBER_FIELDS) state[key] = String(DEFAULTS[key]);
  const aki = String(DEFAULTS.pumpAki);
  state.pumpAkiSelect = PRESET_AKI.includes(aki) ? aki : 'custom';
  state.pumpAkiCustom = PRESET_AKI.includes(aki) ? '' : aki;
  return state;
}

function loadState() {
  const state = defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === 'object') {
      for (const key of Object.keys(state)) {
        if (typeof saved[key] === 'string') state[key] = saved[key];
      }
    }
  } catch {
    // Storage unavailable or corrupt — fall back to defaults.
  }
  return state;
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode, quota) — the app still works.
  }
}

function readState() {
  const state = {};
  for (const key of NUMBER_FIELDS) state[key] = $(key).value;
  state.pumpAkiSelect = $('pumpAkiSelect').value;
  state.pumpAkiCustom = $('pumpAkiCustom').value;
  return state;
}

function writeState(state) {
  for (const key of NUMBER_FIELDS) $(key).value = state[key];
  $('pumpAkiSelect').value = PRESET_AKI.includes(state.pumpAkiSelect) ? state.pumpAkiSelect : 'custom';
  $('pumpAkiCustom').value = state.pumpAkiCustom;
}

// Accept "12,5" as well as "12.5" — some phone keypads only offer a comma.
function parseNum(raw) {
  const s = String(raw).trim().replace(',', '.');
  return s === '' ? NaN : Number(s);
}

function toInputs(state) {
  const inputs = {};
  for (const key of NUMBER_FIELDS) inputs[key] = parseNum(state[key]);
  inputs.pumpAki = state.pumpAkiSelect === 'custom' ? parseNum(state.pumpAkiCustom) : Number(state.pumpAkiSelect);
  return inputs;
}

const icon = (name) => `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

const gal = (v) => v.toFixed(2);
const pct = (v) => v.toFixed(1);
const octaneLabel = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function showErrors(errors) {
  const inputFor = { pumpAki: 'pumpAkiCustom' };
  for (const key of [...NUMBER_FIELDS, 'pumpAki']) {
    const msgEl = $(`${key}-error`);
    const input = $(inputFor[key] || key);
    const msg = errors[key];
    msgEl.textContent = msg || '';
    msgEl.hidden = !msg;
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    const hintId = input.getAttribute('aria-describedby')?.split(' ').find((id) => id.endsWith('-hint'));
    const describedBy = [hintId, msg ? msgEl.id : null].filter(Boolean).join(' ');
    if (describedBy) input.setAttribute('aria-describedby', describedBy);
    else input.removeAttribute('aria-describedby');
  }
  // Errors inside the collapsed Advanced card would otherwise be invisible.
  if (ADVANCED_FIELDS.some((k) => errors[k])) $('advanced').open = true;
}

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

function syncControls(state) {
  $('pumpAkiCustomWrap').hidden = state.pumpAkiSelect !== 'custom';

  const level = parseNum(state.level);
  if (Number.isFinite(level)) $('levelRange').value = String(Math.min(Math.max(level, 0), 100));

  const target = parseNum(state.targetE);
  for (const chip of document.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(Number(chip.dataset.target) === target));
  }
}

function update() {
  const state = readState();
  saveState(state);
  syncControls(state);
  const inputs = toInputs(state);
  const result = calculate(inputs);
  showErrors(result.errors);
  renderResult(result, inputs.pumpAki);
}

function init() {
  writeState(loadState());

  $('form').addEventListener('input', (e) => {
    if (e.target.id === 'levelRange') $('level').value = e.target.value;
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

  $('reset').addEventListener('click', () => {
    writeState(defaultState());
    $('advanced').open = false;
    update();
  });

  update();
}

init();

// Saved stations: pure list helpers (no storage access) so they can be
// unit tested. A station is { name, e85E, updated } where e85E is the
// measured E85 ethanol content (%) and updated is an ISO date string.
// Stations are matched by name, ignoring case and surrounding spaces.

export const MAX_NAME_LENGTH = 40;

export const stationKey = (name) => String(name).trim().toLowerCase();

/** Keep only well-formed entries — guards against corrupt storage. */
export function sanitizeStations(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (s) => s && typeof s.name === 'string' && s.name.trim() !== ''
      && Number.isFinite(s.e85E) && typeof s.updated === 'string',
  );
}

/** Add a station or update the one with the same name. Most recent first. */
export function upsertStation(list, { name, e85E, updated }) {
  const clean = String(name).trim().slice(0, MAX_NAME_LENGTH);
  if (!clean) throw new Error('Station name is required.');
  const key = stationKey(clean);
  const rest = list.filter((s) => stationKey(s.name) !== key);
  return [{ name: clean, e85E, updated }, ...rest];
}

export function removeStation(list, name) {
  const key = stationKey(name);
  return list.filter((s) => stationKey(s.name) !== key);
}

export function findStation(list, name) {
  const key = stationKey(name);
  return list.find((s) => stationKey(s.name) === key) || null;
}

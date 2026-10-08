export const SYNC_PREFIX = "xivary.sync:";
export const SYNC_VERSION = 1;
export const PREFERENCES = ["openArxivLinksInNewTab", "organizeFollowedAuthorsIntoCollections", "openAuthorResultsInNewTab", "openXivaryFromToolbarInNewTab"];
export const syncKey = (type, ...ids) => SYNC_PREFIX + JSON.stringify([type, ...ids]);
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const compareRevision = (a, b) => !a ? (b ? -1 : 0) : !b ? 1
  : a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
const maxRevision = (a, b) => compareRevision(a, b) >= 0 ? a : b;
const revision = value => Array.isArray(value) && value.length === 2
  && Number.isSafeInteger(value[0]) && value[0] >= 0
  && typeof value[1] === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(value[1]);

const preferenceKeys = new Set(PREFERENCES.map(name => syncKey("s", name)));
export const isPreferenceKey = key => preferenceKeys.has(key);

/** Only explicitly supported preference registers are active Sync v1 records.
 * Legacy library and unknown keys are ignored by the storage decorator.
 */
export function validateRecord(key, record) {
  if (record?.v !== SYNC_VERSION) throw new Error("Unsupported sync representation version.");
  if (!isPreferenceKey(key) || !revision(record.rev)
      || (record.deleted !== null && !revision(record.deleted))
      || compareRevision(record.deleted, record.rev) > 0
      || typeof record.value !== "boolean"
      || Object.keys(record).some(field => !["v", "rev", "value", "deleted"].includes(field))) {
    throw new Error(`Malformed sync record: ${key}`);
  }
  return record;
}

export function mergeRecord(a, b) {
  if (!a) return structuredClone(b);
  const order = compareRevision(a.rev, b.rev);
  const winner = order > 0 || (order === 0 && JSON.stringify(a.value) >= JSON.stringify(b.value)) ? a : b;
  return { ...structuredClone(winner), deleted: maxRevision(a.deleted, b.deleted) };
}

/** No library, cache, local pointer or unknown setting enters the projection. */
export function projectState(state) {
  return Object.fromEntries(PREFERENCES.map(name => [syncKey("s", name), state.settings[name]]));
}

export function recordChanges(replica, before, after, bootstrap = false) {
  const changed = [...preferenceKeys].filter(key => !equal(before[key], after[key]));
  if (!changed.length) return;
  const counter = bootstrap ? 0 : replica.counter + 1;
  if (!Number.isSafeInteger(counter)) throw new Error("Sync logical clock exhausted.");
  for (const key of changed) {
    const record = { v: SYNC_VERSION, rev: [counter, replica.id], value: after[key],
      deleted: replica.records[key]?.deleted ?? null };
    validateRecord(key, record);
    replica.records[key] = mergeRecord(replica.records[key], record);
  }
  replica.counter = Math.max(replica.counter, counter);
}

/** Apply preferences to a detached copy; local library fields remain untouched. */
export function materialize(state, records) {
  const next = structuredClone(state);
  for (const name of PREFERENCES) {
    const key = syncKey("s", name);
    if (Object.hasOwn(records, key)) next.settings[name] = validateRecord(key, records[key]).value;
  }
  return next;
}

export function assertQuota(values, limits = {}) {
  const bytes = value => new TextEncoder().encode(value).length;
  const entries = Object.entries(values);
  if (entries.length > (limits.MAX_ITEMS ?? 512)) throw new Error("Sync MAX_ITEMS quota exceeded; settings remain local.");
  let total = 0;
  for (const [key, value] of entries) {
    const size = bytes(key) + bytes(JSON.stringify(value));
    if (size > (limits.QUOTA_BYTES_PER_ITEM ?? 8192)) throw new Error("Sync per-item quota exceeded; settings remain local.");
    total += size;
  }
  if (total > (limits.QUOTA_BYTES ?? 102400)) throw new Error("Sync total quota exceeded; settings remain local.");
  return { items: entries.length, bytes: total };
}

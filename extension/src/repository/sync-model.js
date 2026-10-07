import { createPaper } from "../domain/paper.js";
import { createAuthor } from "../domain/author.js";
import { cleanText, normalizeArxivId } from "../domain/identifiers.js";
import { disambiguateCollectionNames } from "./collection-names.js";

export const SYNC_PREFIX = "xivary.sync:";
export const SYNC_VERSION = 1;
export const PREFERENCES = ["openArxivLinksInNewTab", "organizeFollowedAuthorsIntoCollections"];
export const syncKey = (type, ...ids) => SYNC_PREFIX + JSON.stringify([type, ...ids]);
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const compareRevision = (a, b) => !a ? (b ? -1 : 0) : !b ? 1
  : a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
const maxRevision = (a, b) => compareRevision(a, b) >= 0 ? a : b;
const dates = (record, fields) => fields.every(field => typeof record[field] === "string" && Number.isFinite(Date.parse(record[field])));
const revision = value => Array.isArray(value) && value.length === 2
  && Number.isSafeInteger(value[0]) && value[0] >= 0
  && typeof value[1] === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(value[1]);

/** Validate independent wire records before they can influence the local view. */
export function validateRecord(key, record) {
  if (record?.v !== SYNC_VERSION) throw new Error("Unsupported sync representation version.");
  try {
    const [type, id, collectionId, ...extra] = JSON.parse(key.slice(SYNC_PREFIX.length));
    if (!key.startsWith(SYNC_PREFIX) || extra.length || key !== syncKey(type, id, ...(collectionId === undefined ? [] : [collectionId]))
        || !revision(record.rev) || (record.deleted !== null && !revision(record.deleted))
        || compareRevision(record.deleted, record.rev) > 0) throw new Error();
    const value = record.value;
    if (Object.keys(record).some(field => !["v", "rev", "value", "deleted"].includes(field))) throw new Error();
    if (!["p", "a", "pc", "ac", "pm", "am", "s"].includes(type) || typeof id !== "string") throw new Error();
    if ((type === "pm" || type === "am") !== (collectionId !== undefined)) throw new Error();
    if (["p", "pm"].includes(type) && normalizeArxivId(id) !== id) throw new Error();
    if (["a", "am"].includes(type) && !id.startsWith("arxiv-author:name:v1:")) throw new Error();
    if (["pc", "ac"].includes(type) && !id.startsWith(type === "pc" ? "paper-collection:" : "collection:")) throw new Error();
    if (["pm", "am"].includes(type) && (typeof collectionId !== "string" || !collectionId.startsWith(type === "pm" ? "paper-collection:" : "collection:"))) throw new Error();
    if (type === "s" && !PREFERENCES.includes(id)) throw new Error();
    const fields = {
      p: ["title", "authors", "savedAt", "updatedAt"], a: ["displayName", "followedAt", "updatedAt"],
      pc: ["name", "createdAt", "updatedAt"], ac: ["name", "createdAt", "updatedAt"],
      pm: ["addedAt", "updatedAt", "generation"], am: ["addedAt", "updatedAt", "generation"],
    };
    if (value !== null && type !== "s" && (typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).some(field => !fields[type].includes(field)))) throw new Error();
    if (value === null) {
      if (!equal(record.deleted, record.rev) || ["p", "a", "s"].includes(type)) throw new Error();
    } else if (type === "p") {
      if (!dates(value, ["savedAt", "updatedAt"]) || !Array.isArray(value.authors)
          || value.authors.some(name => typeof name !== "string")) throw new Error();
      createPaper({ ...value, arxivId: id }, value.savedAt);
    } else if (type === "a") {
      const author = createAuthor(value, value.followedAt);
      if (author.id !== id || !dates(value, ["followedAt", "updatedAt"])) throw new Error();
    } else if (["pc", "ac"].includes(type)) {
      if (cleanText(value.name, "Collection name") !== value.name || value.name.length > 80
          || !dates(value, ["createdAt", "updatedAt"])) throw new Error();
    } else if (["pm", "am"].includes(type)) {
      if (!dates(value, ["addedAt", "updatedAt"])
          || (value.generation !== null && !revision(value.generation))) throw new Error();
    } else if (typeof value !== "boolean") throw new Error();
  } catch { throw new Error(`Malformed sync record: ${key}`); }
  return record;
}

export function mergeRecord(a, b) {
  if (!a) return structuredClone(b);
  const order = compareRevision(a.rev, b.rev);
  const winner = order > 0 || (order === 0 && JSON.stringify(a.value) >= JSON.stringify(b.value)) ? a : b;
  return { ...structuredClone(winner), deleted: maxRevision(a.deleted, b.deleted) };
}

/** Metadata is deliberately small but complete enough for an offline paper row. */
export function projectState(state) {
  const result = {};
  for (const p of state.favorites) result[syncKey("p", p.arxivId)] = {
    title: p.title, authors: p.authors.map(a => a.displayName), savedAt: p.savedAt, updatedAt: p.updatedAt,
  };
  for (const a of state.authors) result[syncKey("a", a.id)] = {
    displayName: a.displayName, followedAt: a.followedAt, updatedAt: a.updatedAt,
  };
  for (const [type, field] of [["pc", "paperCollections"], ["ac", "collections"]]) {
    for (const c of state[field]) result[syncKey(type, c.id)] = { name: c.name, createdAt: c.createdAt, updatedAt: c.updatedAt };
  }
  for (const [type, field, identity] of [["pm", "paperMemberships", "arxivId"], ["am", "memberships", "authorId"]]) {
    for (const m of state[field]) result[syncKey(type, m[identity], m.collectionId)] = { addedAt: m.addedAt, updatedAt: m.updatedAt };
  }
  for (const name of PREFERENCES) result[syncKey("s", name)] = state.settings[name];
  return result;
}

export function recordChanges(replica, before, after, bootstrap = false) {
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !equal(before[key], after[key]));
  if (!changed.length) return;
  const counter = bootstrap ? 0 : replica.counter + 1;
  if (!Number.isSafeInteger(counter)) throw new Error("Sync logical clock exhausted.");
  for (const key of changed) {
    const type = JSON.parse(key.slice(SYNC_PREFIX.length))[0];
    // Display metadata survives unsave/unfollow; membership defines user intent.
    if (after[key] === undefined && ["p", "a"].includes(type)) continue;
    let value = after[key] ?? null;
    if (value !== null && ["pm", "am"].includes(type)) {
      const collectionId = JSON.parse(key.slice(SYNC_PREFIX.length))[2];
      value = { ...value, generation: replica.records[syncKey(type === "pm" ? "pc" : "ac", collectionId)]?.deleted ?? null };
    }
    const rev = [counter, replica.id];
    replica.records[key] = mergeRecord(replica.records[key], {
      v: SYNC_VERSION, rev, value, deleted: value === null ? rev : replica.records[key]?.deleted ?? null,
    });
  }
  replica.counter = Math.max(replica.counter, counter);
}

function collections(records, type, existing) {
  const candidates = Object.entries(records).filter(([key, r]) => JSON.parse(key.slice(SYNC_PREFIX.length))[0] === type && r.value !== null)
    .map(([key, r]) => ({ ...existing.find(c => c.id === JSON.parse(key.slice(SYNC_PREFIX.length))[1]),
      id: JSON.parse(key.slice(SYNC_PREFIX.length))[1], ...r.value })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // Both independently created collections survive name collisions. Reserve all
  // original names so suffixes cannot steal another collection's actual name.
  disambiguateCollectionNames(candidates);
  return retainOrder(candidates, existing, c => c.id);
}

function retainOrder(items, existing, identity) {
  const remaining = new Map(items.map(item => [identity(item), item]));
  const ordered = [];
  for (const old of existing) {
    if (remaining.has(identity(old))) { ordered.push(remaining.get(identity(old))); remaining.delete(identity(old)); }
  }
  return ordered.concat([...remaining.values()]);
}

export function materialize(state, records) {
  const next = structuredClone(state);
  next.paperCollections = collections(records, "pc", state.paperCollections);
  next.collections = collections(records, "ac", state.collections);
  const authors = new Map(state.authors.map(a => [a.id, a]));
  for (const [key, r] of Object.entries(records)) {
    const [type, id] = JSON.parse(key.slice(SYNC_PREFIX.length));
    if (type === "a" && r.value !== null && !authors.has(id)) authors.set(id, {
      ...createAuthor(r.value, r.value.followedAt), updatedAt: r.value.updatedAt,
    });
    if (type === "s") next.settings[id] = r.value;
  }
  next.authors = [...authors.values()];
  for (const [type, field, identity, entityType, collectionType] of [
    ["pm", "paperMemberships", "arxivId", "p", "pc"], ["am", "memberships", "authorId", "a", "ac"],
  ]) {
    const members = [];
    for (const [key, r] of Object.entries(records).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      const [kind, id, collectionId] = JSON.parse(key.slice(SYNC_PREFIX.length));
      if (kind !== type || r.value === null) continue;
      const entity = records[syncKey(entityType, id)], collection = records[syncKey(collectionType, collectionId)];
      if (!entity?.value || !collection?.value || !equal(r.value.generation, collection.deleted)) continue;
      members.push({ ...state[field].find(m => m[identity] === id && m.collectionId === collectionId),
        [identity]: id, collectionId, addedAt: r.value.addedAt, updatedAt: r.value.updatedAt });
    }
    next[field] = retainOrder(members, state[field], m => JSON.stringify([m[identity], m.collectionId]));
  }
  const papers = [...new Set(next.paperMemberships.map(m => m.arxivId))].map(id => {
    const local = state.favorites.find(p => p.arxivId === id);
    if (local) return local;
    const value = records[syncKey("p", id)].value;
    return { ...createPaper({ ...value, arxivId: id }, value.savedAt), updatedAt: value.updatedAt };
  });
  next.favorites = retainOrder(papers, state.favorites, p => p.arxivId);
  for (const [field, setting] of [["paperCollections", "lastUsedPaperCollectionId"], ["collections", "lastUsedAuthorCollectionId"]]) {
    if (next.settings[setting] !== null && !next[field].some(c => c.id === next.settings[setting])) {
      next.settings[setting] = next[field][0]?.id ?? null;
    }
  }
  return next;
}

export function assertQuota(values, limits = {}) {
  const bytes = value => new TextEncoder().encode(value).length;
  const entries = Object.entries(values);
  if (entries.length > (limits.MAX_ITEMS ?? 512)) throw new Error("Sync MAX_ITEMS quota exceeded; library remains local.");
  let total = 0;
  for (const [key, value] of entries) {
    const size = bytes(key) + bytes(JSON.stringify(value));
    if (size > (limits.QUOTA_BYTES_PER_ITEM ?? 8192)) throw new Error("Sync per-item quota exceeded; library remains local.");
    total += size;
  }
  if (total > (limits.QUOTA_BYTES ?? 102400)) throw new Error("Sync total quota exceeded; library remains local.");
  return { items: entries.length, bytes: total };
}

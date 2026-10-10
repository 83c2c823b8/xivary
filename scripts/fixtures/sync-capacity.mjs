// Audit fixtures/projections only. These are never imported by the extension.
import { createHash } from "node:crypto";
import { createPaper } from "../../extension/src/domain/paper.js";
import { createAuthor } from "../../extension/src/domain/author.js";
import { prepareState } from "../../extension/src/repository/local-repository.js";
import { projectState, syncKey } from "../../extension/src/repository/sync-model.js";

export const auditDate = "2026-10-10T00:00:00.000Z";
const actor = "12345678-1234-4234-8234-123456789abc";
const bytes = value => Buffer.byteLength(value, "utf8");
export const itemBytes = (key, value) => bytes(key) + bytes(JSON.stringify(value));
export function usage(values) {
  const sizes = Object.entries(values).map(([key, value]) => ({ key, bytes: itemBytes(key, value) }));
  const total = sizes.reduce((sum, item) => sum + item.bytes, 0);
  const largest = sizes.reduce((max, item) => item.bytes > max.bytes ? item : max, { key: null, bytes: 0 });
  return { bytes: total, items: sizes.length, largestItem: largest.bytes,
    overTotal: total > 102400, overItem: largest.bytes > 8192, overCount: sizes.length > 512 };
}

export function capacityFixture(papers = 300, researchers = 100) {
  const state = prepareState(undefined, auditDate);
  const collection = (prefix, name, index) => ({ id: `${prefix}:00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name, createdAt: auditDate, updatedAt: auditDate });
  state.paperCollections.push(...Array.from({ length: 7 }, (_, i) => collection("paper-collection", `Reading project ${i + 1}`, i + 1)));
  state.collections = Array.from({ length: 5 }, (_, i) => collection("collection", `Research group ${i + 1}`, i + 1));
  const names = ["Renée O’Connor", "Alex Kim", "Atsushi Takahashi", "María García", "Jean–Paul Martin", "李 明"];
  const given = ["Renée", "Alex", "Atsushi", "María", "Jean–Paul", "Wei", "Amara", "Sofia", "Hao", "Fatima"];
  const family = ["O’Connor", "Kim", "Takahashi", "García", "Martin", "Li", "Patel", "Rossi", "Chen", "Hassan"];
  if (researchers > given.length * family.length) throw new Error("Audit fixture supports at most 100 unique researchers.");
  state.authors = Array.from({ length: researchers }, (_, i) => createAuthor({
    displayName: i === 55 ? "李 明" : `${given[Math.floor(i / family.length)]} ${family[i % family.length]}`,
  }, auditDate));
  const abstract = "We study the geometry of moduli spaces and establish a comparison theorem for derived invariants. "
    + String.raw`For a smooth variety $X$, we analyze $H^i(X,\mathcal{F})$ and the stability of $d_M(V_I)$. `
    + "Our construction is compatible with base change and preserves the natural filtrations. Explicit examples illustrate the hypotheses and their limitations. ";
  state.favorites = Array.from({ length: papers }, (_, i) => createPaper({
    arxivId: `2601.${String(i + 1).padStart(5, "0")}`,
    title: `Comparison theorems for filtered moduli spaces and their derived invariants, part ${i + 1}`,
    authors: Array.from({ length: 4 + i % 5 }, (_, j) => names[(i + j) % names.length]),
    abstract: `${abstract.repeat(3)}\n\nApplications include deformation theory and spectral sequences.`,
    categories: ["math.AG", "math.RT"], publishedAt: "2026-01-15T00:00:00.000Z",
  }, auditDate));
  for (const [field, entities, idField, collections] of [
    ["paperMemberships", state.favorites, "arxivId", state.paperCollections],
    ["memberships", state.authors, "authorId", state.collections],
  ]) entities.forEach((entity, i) => {
    for (const index of i % 3 === 0 ? [i % collections.length, (i + 1) % collections.length] : [i % collections.length]) {
      state[field].push({ [idField]: entity.arxivId ?? entity.id, collectionId: collections[index].id, addedAt: auditDate, updatedAt: auditDate });
    }
  });
  return prepareState(state, auditDate);
}

export function preferenceRecords(state) {
  return Object.fromEntries(Object.entries(projectState(state)).map(([key, value]) => [key, { v: 1, rev: [1, actor], value, deleted: null }]));
}

// Reproduce the removed v1 projection (f33a925), with today's four preferences.
// Includes titles/authors, independent membership registers and generation fences.
export function legacyRecords(state) {
  const records = preferenceRecords(state);
  const put = (key, value) => { records[key] = { v: 1, rev: [1, actor], value, deleted: null }; };
  for (const p of state.favorites) put(syncKey("p", p.arxivId), {
    title: p.title, authors: p.authors.map(a => a.displayName), savedAt: p.savedAt, updatedAt: p.updatedAt,
  });
  for (const a of state.authors) put(syncKey("a", a.id), { displayName: a.displayName, followedAt: a.followedAt, updatedAt: a.updatedAt });
  for (const [type, list] of [["pc", state.paperCollections], ["ac", state.collections]]) {
    for (const c of list) put(syncKey(type, c.id), { name: c.name, createdAt: c.createdAt, updatedAt: c.updatedAt });
  }
  for (const [type, list, id] of [["pm", state.paperMemberships, "arxivId"], ["am", state.memberships, "authorId"]]) {
    for (const m of list) put(syncKey(type, m[id], m.collectionId), { addedAt: m.addedAt, updatedAt: m.updatedAt, generation: null });
  }
  return records;
}

/** Optimistic compact snapshot budget, NOT an operation protocol. Immutable
 * snapshot-local collection indexes refer to stable IDs in its dictionary.
 * This has no conflict/deletion/acknowledgment history, so is only a lower bound.
 */
export function compactSnapshot(state, itemBudget = 6144) {
  const collections = [...state.paperCollections, ...state.collections];
  const index = new Map(collections.map((c, i) => [c.id, i]));
  const memberships = (list, field, id) => list.filter(m => m[field] === id).map(m => [index.get(m.collectionId), Date.parse(m.addedAt)]);
  const records = [
    ...collections.map(c => ["c", c.id, c.name, Date.parse(c.createdAt), Date.parse(c.updatedAt)]),
    ...state.favorites.map(p => ["p", p.arxivId, Date.parse(p.savedAt), memberships(state.paperMemberships, "arxivId", p.arxivId)]),
    ...state.authors.map(a => ["a", a.id, a.displayName, Date.parse(a.followedAt), memberships(state.memberships, "authorId", a.id)]),
  ];
  const values = preferenceRecords(state);
  const prefix = `xivary.audit-capacity:${actor}:`;
  const parts = [];
  let part;
  const start = () => { part = { v: 2, snapshot: actor, rev: [1, actor], part: parts.length, records: [] }; parts.push(part); };
  start();
  for (const record of records) {
    part.records.push(record);
    if (itemBytes(prefix + part.part, part) > itemBudget) {
      part.records.pop(); start(); part.records.push(record);
      if (itemBytes(prefix + part.part, part) > itemBudget) throw new Error("Single audit record exceeds item budget.");
    }
  }
  for (const part of parts) values[prefix + part.part] = part;
  values[prefix + "manifest"] = { v: 2, snapshot: actor, nameNormalization: 1,
    parts: parts.map(p => createHash("sha256").update(JSON.stringify(p)).digest("hex")) };
  return values;
}

export function measureFixture(papers) {
  const state = capacityFixture(papers);
  return { researchers: state.authors.length, papers, collections: state.paperCollections.length + state.collections.length,
    memberships: state.paperMemberships.length + state.memberships.length,
    local: usage({ arxivResearchLibrary: state }), preferences: usage(preferenceRecords(state)),
    legacy: usage(legacyRecords(state)), compactSnapshotLowerBound: usage(compactSnapshot(state)) };
}

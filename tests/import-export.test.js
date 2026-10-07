import test from "node:test";
import assert from "node:assert/strict";
import { LocalRepository } from "../extension/src/repository/local-repository.js";
import { RepositoryClient } from "../extension/src/repository/repository-client.js";
import { SyncStorage } from "../extension/src/repository/sync-storage.js";
import { createRepositoryHandler } from "../extension/src/background/repository-handler.js";
import { PORTABLE_FORMAT, PORTABLE_VERSION, SCOPED_PORTABLE_VERSION } from "../extension/src/repository/portable-library.js";
import { projectState, syncKey } from "../extension/src/repository/sync-model.js";

const now = "2026-10-07T02:03:04.000Z";
const later = "2026-10-08T02:03:04.000Z";
const paper = { arxivId: "2401.00001", title: "A useful paper", authors: ["Alex Kim"] };
const author = { displayName: "Alex Kim" };

function fixture(prefix = "id", initial) {
  let state = structuredClone(initial), writes = 0, fail = false, serial = 0;
  const storage = {
    read: async () => structuredClone(state),
    write: async value => {
      if (fail) throw new Error("Storage quota");
      state = structuredClone(value); writes++;
    },
  };
  const repository = new LocalRepository(storage, () => now, () => `${prefix}-${++serial}`);
  return { repository, storage, state: () => structuredClone(state), writes: () => writes,
    fail: value => { fail = value; } };
}

async function populated(prefix = "source") {
  const result = fixture(prefix);
  const saved = await result.repository.savePaper(paper);
  const paperCollection = await result.repository.createPaperCollection("Algebraic Geometry", saved);
  const followed = await result.repository.followAuthor(author);
  const authorCollection = await result.repository.createAuthorCollection("Researchers", followed);
  await result.repository.setOpenArxivLinksInNewTab(true);
  await result.repository.setOrganizeFollowedAuthorsIntoCollections(true);
  return { ...result, saved, followed, paperCollection, authorCollection };
}

const all = { kind: "all" };
const collection = collectionId => ({ kind: "collection", collectionId });
const fields = {
  bookmarks: ["papers", "paperCollections", "paperMemberships"],
  following: ["authors", "authorCollections", "authorMemberships"],
};
const owned = {
  bookmarks: ["favorites", "paperCollections", "paperMemberships"],
  following: ["authors", "collections", "memberships"],
};
function outside(state, category) {
  const copy = structuredClone(state);
  for (const field of owned[category]) delete copy[field];
  return copy;
}
function legacyFile(source) {
  return Promise.all([source.repository.exportCategory("bookmarks", all),
    source.repository.exportCategory("following", all)]).then(([bookmarks, following]) => ({
    format: PORTABLE_FORMAT, version: PORTABLE_VERSION, exportedAt: now,
    papers: bookmarks.papers, paperCollections: bookmarks.paperCollections,
    paperMemberships: bookmarks.paperMemberships, authors: following.authors,
    authorCollections: following.authorCollections, authorMemberships: following.authorMemberships,
    preferences: { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true },
  }));
}

test("all exports include only their category, no caches, local settings or Sync bookkeeping", async () => {
  const source = await populated();
  await source.repository.putAuthorPaperCache({ authorId: source.followed.id,
    papers: [], fetchedAt: now, queryUsed: "cache query" });
  const internal = source.state();
  internal._chromeSync = { replica: "secret", records: {} };
  internal.pendingRequest = { secret: true };
  await source.storage.write(internal);
  for (const category of Object.keys(fields)) {
    const file = await source.repository.exportCategory(category, all);
    assert.deepEqual(Object.keys(file), ["format", "version", "category", "selection", "exportedAt", ...fields[category]]);
    assert.equal(file.format, PORTABLE_FORMAT);
    assert.equal(file.version, SCOPED_PORTABLE_VERSION);
    assert.equal(file.category, category);
    assert.deepEqual(file.selection, all);
    assert.equal(file.exportedAt, now);
    for (const excluded of ["preferences", "lastUsed", "cache query", "replica", "secret", "schemaVersion", "tombstone"])
      assert.doesNotMatch(JSON.stringify(file), new RegExp(excluded));
  }
  const bookmarks = await source.repository.exportCategory("bookmarks", all);
  const following = await source.repository.exportCategory("following", all);
  assert.equal(bookmarks.papers.length, 1);
  assert.equal(bookmarks.paperCollections.length, 2);
  assert.equal(following.authors.length, 1);
  assert.equal(following.authorCollections.length, 2);
});

test("bookmark collection export carries only its papers, collection and relevant memberships", async () => {
  const source = await populated("bookmark-scope");
  await source.repository.createPaperCollection("Other", { arxivId: "2401.00002", title: "Other", authors: ["Other"] });
  const file = await source.repository.exportCategory("bookmarks", collection(source.paperCollection.id));
  assert.deepEqual(file.selection, collection(source.paperCollection.id));
  assert.deepEqual(file.papers.map(item => item.arxivId), [paper.arxivId]);
  assert.deepEqual(file.paperCollections.map(item => item.name), ["Algebraic Geometry"]);
  assert.deepEqual(file.paperMemberships.map(item => item.collectionId), [source.paperCollection.id]);
  assert.equal(file.paperMemberships.length, 1);
});

test("bookmark collection import restores classification without changing other state, and repeats idempotently", async () => {
  const source = await populated("bookmark-source");
  const file = await source.repository.exportCategory("bookmarks", collection(source.paperCollection.id));
  const target = await populated("bookmark-target");
  await target.repository.putAuthorPaperCache({ authorId: target.followed.id,
    papers: [], fetchedAt: now, queryUsed: "local cache" });
  const unrelated = await target.repository.createPaperCollection("Unrelated");
  const beforeOther = outside(target.state(), "bookmarks");
  const beforeUnrelated = target.state().paperCollections.find(item => item.id === unrelated.id);
  const result = await target.repository.importCategory(JSON.stringify(file), "bookmarks");
  assert.equal(result.importedScope, "Algebraic Geometry");
  assert.deepEqual(outside(target.state(), "bookmarks"), beforeOther);
  assert.deepEqual(target.state().paperCollections.find(item => item.id === unrelated.id), beforeUnrelated);
  assert.ok(target.state().paperCollections.some(item => item.id === source.paperCollection.id));
  assert.ok(target.state().paperMemberships.some(item => item.arxivId === paper.arxivId
    && item.collectionId === source.paperCollection.id));
  const once = target.state();
  await target.repository.importCategory(JSON.stringify(file), "bookmarks");
  assert.deepEqual(target.state(), once);
});

test("following collection export and import retain only selected classification", async () => {
  const source = await populated("following-source");
  await source.repository.createAuthorCollection("Other authors", { displayName: "Pat Lee" });
  const file = await source.repository.exportCategory("following", collection(source.authorCollection.id));
  assert.deepEqual(file.selection, collection(source.authorCollection.id));
  assert.deepEqual(file.authors.map(item => item.id), [source.followed.id]);
  assert.deepEqual(file.authorCollections.map(item => item.name), ["Researchers"]);
  assert.deepEqual(file.authorMemberships.map(item => item.collectionId), [source.authorCollection.id]);
  const target = await populated("following-target");
  await target.repository.putAuthorPaperCache({ authorId: target.followed.id,
    papers: [], fetchedAt: now, queryUsed: "local cache" });
  const unrelated = await target.repository.createAuthorCollection("Unrelated");
  const beforeOther = outside(target.state(), "following");
  const beforeUnrelated = target.state().collections.find(item => item.id === unrelated.id);
  const result = await target.repository.importCategory(JSON.stringify(file), "following");
  assert.equal(result.importedScope, "Researchers");
  assert.deepEqual(outside(target.state(), "following"), beforeOther);
  assert.deepEqual(target.state().collections.find(item => item.id === unrelated.id), beforeUnrelated);
  assert.ok(target.state().memberships.some(item => item.authorId === source.followed.id
    && item.collectionId === source.authorCollection.id));
  const once = target.state();
  await target.repository.importCategory(JSON.stringify(file), "following");
  assert.deepEqual(target.state(), once);
});

test("all Bookmarks and all Following independently round-trip through empty repositories", async () => {
  const source = await populated("roundtrip-source");
  for (const category of Object.keys(fields)) {
    const file = await source.repository.exportCategory(category, all);
    const target = fixture(`roundtrip-${category}`);
    await target.repository.importCategory(JSON.stringify(file), category);
    assert.deepEqual(await target.repository.exportCategory(category, all), file);
  }
});

test("unclassified export is absent because saved/followed entities always have memberships", async () => {
  const source = await populated("classification");
  await source.repository.unfollowAuthor(source.followed.id);
  for (const category of Object.keys(fields)) {
    const file = await source.repository.exportCategory(category, all);
    const entities = category === "bookmarks" ? file.papers : file.authors;
    const memberships = category === "bookmarks" ? file.paperMemberships : file.authorMemberships;
    const identity = category === "bookmarks" ? "arxivId" : "id";
    const memberIdentity = category === "bookmarks" ? "arxivId" : "authorId";
    for (const item of entities) assert.ok(memberships.some(member => member[memberIdentity] === item[identity]));
  }
  assert.deepEqual((await source.repository.exportCategory("following", all)).authors, []);
});

test("collection collision keeps both stable IDs with deterministic suffixes", async () => {
  const source = await populated("z-collision");
  const target = await populated("a-collision");
  await target.repository.renamePaperCollection(target.paperCollection.id, "Algebraic Geometry");
  await target.repository.renameAuthorCollection(target.authorCollection.id, "Researchers");
  await target.repository.importCategory(JSON.stringify(await source.repository.exportCategory("bookmarks",
    collection(source.paperCollection.id))), "bookmarks");
  await target.repository.importCategory(JSON.stringify(await source.repository.exportCategory("following",
    collection(source.authorCollection.id))), "following");
  assert.ok(target.state().paperCollections.some(item => item.name === "Algebraic Geometry (2)"));
  assert.ok(target.state().collections.some(item => item.name === "Researchers (2)"));
});

test("bookmark metadata merge preserves rich local fields and unions additive lists", async () => {
  const source = await populated("metadata-source");
  const file = await source.repository.exportCategory("bookmarks", collection(source.paperCollection.id));
  Object.assign(file.papers[0], { abstract: "Imported abstract", note: "Imported note", tags: ["imported"], categories: ["cs.AI"] });
  const target = await populated("metadata-target");
  const internal = target.state();
  Object.assign(internal.favorites[0], { abstract: "Local abstract", note: "Local note", tags: ["local"],
    categories: ["math.AG"], publishedAt: later, read: true });
  await target.storage.write(internal);
  await target.repository.importCategory(JSON.stringify(file), "bookmarks");
  const restored = target.state().favorites[0];
  assert.equal(restored.abstract, "Local abstract");
  assert.equal(restored.note, "Local note");
  assert.equal(restored.read, true);
  assert.equal(restored.publishedAt, later);
  assert.deepEqual(restored.tags, ["local", "imported"]);
  assert.deepEqual(restored.categories, ["math.AG", "cs.AI"]);
});

test("malformed, mismatched and forged collection files cause no logical write", async () => {
  const source = await populated("invalid-source");
  const target = await populated("invalid-target");
  const file = await source.repository.exportCategory("bookmarks", collection(source.paperCollection.id));
  const variants = ["not json", JSON.stringify({ ...file, format: "other" }),
    JSON.stringify({ ...file, version: 99 }), JSON.stringify({ ...file, category: "following" }),
    JSON.stringify({ ...file, selection: { kind: "unclassified" } }),
    JSON.stringify({ ...file, selection: collection("paper-collection:missing") }),
    JSON.stringify({ ...file, preferences: { openArxivLinksInNewTab: true } }),
    JSON.stringify({ ...file, papers: [file.papers[0], file.papers[0]] }),
    JSON.stringify({ ...file, papers: [{ ...file.papers[0], title: null }] }),
    JSON.stringify({ ...file, paperMemberships: [{ ...file.paperMemberships[0], collectionId: "paper-collection:missing" }] })];
  const before = target.state(), writes = target.writes();
  for (const variant of variants) {
    await assert.rejects(target.repository.importCategory(variant, "bookmarks"));
    assert.deepEqual(target.state(), before);
    assert.equal(target.writes(), writes);
  }
  await assert.rejects(target.repository.importCategory(JSON.stringify(file), "following"));
  assert.deepEqual(target.state(), before);
});

test("invalid input does not trigger an otherwise pending migration", async () => {
  const legacy = { schemaVersion: 4, favorites: [], authors: [], collections: [], memberships: [],
    authorPaperCaches: [], settings: { lastUsedAuthorCollectionId: null } };
  const target = fixture("migration", legacy);
  await assert.rejects(target.repository.importCategory("not json", "bookmarks"), /valid JSON/);
  assert.deepEqual(target.state(), legacy);
  assert.equal(target.writes(), 0);
});

test("a valid import commits a pending migration and merge in one write", async () => {
  const source = await populated("migration-source");
  const file = await source.repository.exportCategory("bookmarks", all);
  const legacy = { schemaVersion: 4, favorites: [], authors: [], collections: [], memberships: [],
    authorPaperCaches: [], settings: { lastUsedAuthorCollectionId: null } };
  const target = fixture("migration-target", legacy);
  target.fail(true);
  await assert.rejects(target.repository.importCategory(JSON.stringify(file), "bookmarks"), /Storage quota/);
  assert.deepEqual(target.state(), legacy);
  assert.equal(target.writes(), 0);
  target.fail(false);
  await target.repository.importCategory(JSON.stringify(file), "bookmarks");
  assert.equal(target.writes(), 1);
  assert.equal(target.state().schemaVersion, 5);
  assert.equal(target.state().favorites.length, 1);
});

test("old combined v1 and prior unscoped v2 files import only the selected category", async () => {
  const source = await populated("legacy-source");
  const v1 = await legacyFile(source);
  for (const category of Object.keys(fields)) {
    const target = await populated(`legacy-${category}`);
    const before = outside(target.state(), category);
    await target.repository.importCategory(JSON.stringify(v1), category);
    assert.deepEqual(outside(target.state(), category), before);
    const oldV2 = await source.repository.exportCategory(category, all);
    delete oldV2.selection;
    await target.repository.importCategory(JSON.stringify(oldV2), category);
    assert.deepEqual(outside(target.state(), category), before);
  }
  const preferenceV2 = { format: PORTABLE_FORMAT, version: SCOPED_PORTABLE_VERSION,
    category: "preferences", exportedAt: now,
    preferences: { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true } };
  await assert.rejects(source.repository.importCategory(JSON.stringify(preferenceV2), "preferences"), /Unknown portable category/);
});

test("empty collection selection exports its classification without clearing target data", async () => {
  const source = await populated("empty-collection-source");
  const empty = await source.repository.createPaperCollection("Empty");
  const file = await source.repository.exportCategory("bookmarks", collection(empty.id));
  assert.deepEqual(file.papers, []);
  assert.deepEqual(file.paperMemberships, []);
  assert.deepEqual(file.paperCollections.map(item => item.id), [empty.id]);
  const target = await populated("empty-collection-target");
  const beforePapers = target.state().favorites;
  await target.repository.importCategory(JSON.stringify(file), "bookmarks");
  assert.deepEqual(target.state().favorites, beforePapers);
  assert.ok(target.state().paperCollections.some(item => item.id === empty.id));
});

test("persistence failure leaves previous local data intact", async () => {
  const source = await populated("failed-source");
  const target = await populated("failed-target");
  const before = target.state();
  target.fail(true);
  await assert.rejects(target.repository.importCategory(JSON.stringify(await source.repository.exportCategory("bookmarks", all)),
    "bookmarks"), /Storage quota/);
  assert.deepEqual(target.state(), before);
});

test("category imports change only matching Sync projections and RPC enforces the category API", async () => {
  const source = await populated("sync-source");
  for (const category of Object.keys(fields)) {
    const base = await populated(`sync-target-${category}`);
    const before = projectState(base.state());
    const file = await source.repository.exportCategory(category, collection(category === "bookmarks"
      ? source.paperCollection.id : source.authorCollection.id));
    let remote = {};
    const transport = { limits: {}, read: async () => structuredClone(remote),
      write: async values => { Object.assign(remote, structuredClone(values)); }, schedule: async () => {} };
    const syncStorage = new SyncStorage(base.storage, transport,
      { now: () => Date.parse(now), makeId: () => `sync-${category}` });
    const repository = new LocalRepository(syncStorage, () => now, () => "unused");
    await repository.getPreferences();
    const client = new RepositoryClient({ sendMessage: message => new Promise(resolve => {
      assert.equal(createRepositoryHandler(repository, "test-extension")(message,
        { id: "test-extension" }, resolve), true);
    }) });
    assert.deepEqual((await client.exportCategory(category, all)).selection, all);
    const old = base.state()._chromeSync.records;
    await client.importCategory(JSON.stringify(file), category);
    const after = projectState(base.state());
    const updated = base.state()._chromeSync.records;
    const allowed = category === "bookmarks" ? ["p", "pc", "pm"] : ["a", "ac", "am"];
    assert.ok(Object.keys(after).some(key => JSON.stringify(after[key]) !== JSON.stringify(before[key])));
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const type = JSON.parse(key.slice("xivary.sync:".length))[0];
      if (!allowed.includes(type)) assert.deepEqual(after[key], before[key]);
    }
    for (const key of Object.keys(updated)) {
      const type = JSON.parse(key.slice("xivary.sync:".length))[0];
      if (!allowed.includes(type)) assert.deepEqual(updated[key], old[key]);
    }
    assert.equal(JSON.stringify(file).includes("_chromeSync"), false);
    assert.equal(JSON.stringify(file).includes("rev"), false);
    assert.equal(JSON.stringify(file).includes("tombstone"), false);
    assert.equal(base.state().schemaVersion, 5);
    assert.ok(base.state()._chromeSync.records[syncKey(allowed[1], category === "bookmarks"
      ? source.paperCollection.id : source.authorCollection.id)]);
  }
});

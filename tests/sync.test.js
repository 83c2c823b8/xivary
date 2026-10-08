import test from "node:test";
import assert from "node:assert/strict";
import { LocalRepository, prepareState } from "../extension/src/repository/local-repository.js";
import { SyncStorage } from "../extension/src/repository/sync-storage.js";
import { assertQuota, equal, mergeRecord, projectState, syncKey, validateRecord, PREFERENCES } from "../extension/src/repository/sync-model.js";
import { createPaper } from "../extension/src/domain/paper.js";
import { stableAuthorKey } from "../extension/src/domain/author.js";

const date = "2026-10-03T00:00:00.000Z";
const paper = { arxivId: "2401.00001", title: "An offline readable title", authors: ["Alex Kim", "Renée Smith"] };
const other = { ...paper, arxivId: "2401.00002", title: "Independent paper" };
const author = { displayName: "Alex Kim" };
const defaultId = "paper-collection:saved-papers";
const clone = value => structuredClone(value);
const record = (value, counter = 1, id = "remote") => ({ v: 1, rev: [counter, id], value, deleted: value === null ? [counter, id] : null });

/** Two separate local disks + transport views; writes don't reach the other
 * device until delivery. There is no shared repository queue or replica map.
 */
function network(initial = {}) {
  let time = Date.parse(date), serial = 0;
  const devices = [], wire = [], server = clone(initial);
  function device(id, initialLocal) {
    let disk = clone(initialLocal);
    const d = { id, view: clone(server), writes: 0, schedules: [], fail: false, failRead: false };
    d.local = { read: async () => clone(disk), write: async value => { disk = clone(value); } };
    d.transport = {
      limits: {},
      read: async () => { if (d.failRead) throw new Error("Sync unavailable"); return clone(d.view); },
      write: async values => {
        d.writes++;
        if (d.fail) throw new Error("QUOTA_BYTES rejected");
        assertQuota({ ...d.view, ...values }, d.transport.limits);
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          changes[key] = { oldValue: d.view[key], newValue: clone(value) };
          d.view[key] = clone(value);
        }
        wire.push({ id, values: clone(values) });
        d.storage.observe(changes); // Local onChanged is also delivered.
      },
      schedule: async when => { d.schedules.push(when); },
    };
    d.restart = () => {
      d.storage = new SyncStorage(d.local, d.transport, { now: () => time, makeId: () => id });
      d.repo = new LocalRepository(d.storage, () => new Date(time).toISOString(), () => `${id}-${++serial}`);
    };
    d.restart(); devices.push(d); return d;
  }
  function deliver() {
    for (const { values } of wire.splice(0)) {
      Object.assign(server, clone(values));
      for (const d of devices) {
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          if (equal(d.view[key], value)) continue;
          changes[key] = { oldValue: clone(d.view[key]), newValue: clone(value) };
          d.view[key] = clone(value);
        }
        d.storage.observe(changes);
      }
    }
  }
  async function settle() {
    for (let round = 0; round < 15; round++) {
      deliver(); time += 600001; // Advance alarm/cooldown time, not ordering clocks.
      for (const d of devices) await d.repo.getPaperLibrary();
      if (!wire.length) return;
    }
    assert.fail("Replica repair did not quiesce");
  }
  return { device, server, wire, deliver, settle, advance: () => { time += 600001; } };
}

test("Following organization workflow converges across independent replicas without touching Bookmarks", async () => {
  const n = network();
  const a = n.device("a"), b = n.device("b");
  await a.repo.savePaper(paper);
  const followed = await a.repo.followAuthor(author);
  await n.settle();
  const original = await a.repo.getAuthorLibrary();
  const paperSnapshot = async () => { const { exportedAt, ...data } = await a.repo.exportCategory("bookmarks"); return data; };
  const bookmarks = await paperSnapshot();
  await a.repo.setOrganizeFollowedAuthorsIntoCollections(true);
  const destination = await a.repo.createAuthorCollection("Move here");
  await a.repo.addAuthorToCollection(followed, destination.id);
  await a.repo.removeAuthorFromCollection(followed.id, original.collections[0].id);
  await n.settle();
  assert.equal((await b.repo.getPreferences()).organizeFollowedAuthorsIntoCollections, true);
  assert.deepEqual((await b.repo.getAuthorLibrary()).memberships, (await a.repo.getAuthorLibrary()).memberships);
  await b.repo.renameAuthorCollection(destination.id, "Renamed remotely");
  await b.repo.setOrganizeFollowedAuthorsIntoCollections(false);
  await n.settle();
  a.restart();
  const reloaded = await a.repo.getAuthorLibrary();
  assert.equal(reloaded.collections.find(item => item.id === destination.id).name, "Renamed remotely");
  assert.equal(reloaded.settings.organizeFollowedAuthorsIntoCollections, false);
  assert.equal((await a.repo.listFollowing()).length, 1);
  assert.deepEqual(await paperSnapshot(), bookmarks);
  await b.repo.deleteAuthorCollection(destination.id);
  await n.settle();
  assert.deepEqual(await a.repo.listFollowing(), []);
  assert.deepEqual(await paperSnapshot(), bookmarks);
});

test("first device migrates schema 1 before seeding sync; full original metadata is retained", async () => {
  const net = network();
  const original = { schemaVersion: 1, favorites: [{ ...createPaper(paper, date), note: "private", future: 42 }], following: [], future: "retained" };
  const a = net.device("a", original);
  await net.settle();
  const local = await a.local.read();
  assert.equal(local.schemaVersion, 5);
  assert.equal(local.future, "retained");
  assert.deepEqual(local.favorites, original.favorites);
  assert.deepEqual(local._chromeSync.bootstrapSnapshot.favorites, original.favorites);
  assert.ok(net.server[syncKey("pm", paper.arxivId, defaultId)]);
  assert.equal(local._chromeSync.version, 1);
});

test("second device hydrates saved papers offline, preserves complete title/authors and canonical links", async () => {
  const net = network(), a = net.device("a");
  await a.repo.savePaper({ ...paper, abstract: "local abstract", categories: ["math.AG"], note: "private", read: true });
  await net.settle();
  const b = net.device("b"); await net.settle();
  const saved = (await b.repo.listFavorites())[0];
  assert.equal(saved.title, paper.title);
  assert.deepEqual(saved.authors.map(a => a.displayName), paper.authors);
  assert.equal(saved.absUrl, "https://arxiv.org/abs/2401.00001");
  assert.equal(saved.abstract, ""); assert.deepEqual(saved.categories, []);
  assert.equal(saved.note, ""); assert.equal(saved.read, false);
  assert.equal((await a.repo.listFavorites())[0].abstract, "local abstract");
  assert.equal((await a.repo.listFavorites())[0].note, "private");
});

test("both existing libraries union disjoint intent, preserve local metadata and retain bootstrap snapshot", async () => {
  const net = network(), a = net.device("a");
  await a.repo.savePaper(paper); await a.repo.setOpenArxivLinksInNewTab(true); await net.settle();
  let original = prepareState(undefined, date);
  const local = { read: async () => clone(original), write: async value => { original = clone(value); } };
  const old = new LocalRepository(local, () => date);
  await old.savePaper({ ...paper, title: "Local spelling", note: "Do not overwrite" });
  await old.savePaper(other);
  const b = net.device("b", original); await net.settle();
  assert.equal((await a.repo.listFavorites()).length, 2);
  assert.equal((await b.repo.listFavorites()).length, 2);
  assert.equal((await b.repo.listFavorites()).find(p => p.arxivId === paper.arxivId).note, "Do not overwrite");
  assert.deepEqual((await b.local.read())._chromeSync.bootstrapSnapshot, original);
  assert.equal((await b.repo.getPreferences()).openArxivLinksInNewTab, true);
});

test("fresh device defaults never overwrite revision-zero legacy preferences or renamed default collection", async () => {
  const state = prepareState(undefined, date);
  state.settings.openArxivLinksInNewTab = true;
  state.paperCollections[0].name = "My saved papers";
  const net = network(), a = net.device("a", state); await net.settle();
  const b = net.device("z"); b.failRead = true;
  await b.repo.getPaperLibrary(); b.restart(); b.failRead = false; await net.settle();
  for (const d of [a, b]) {
    assert.equal((await d.repo.getPreferences()).openArxivLinksInNewTab, true);
    assert.equal((await d.repo.getPaperLibrary()).collections[0].name, "My saved papers");
  }
});

test("unchanged migrations 2 through 4 run before synchronization and preserve user fields", async () => {
  for (const schemaVersion of [2, 3, 4]) {
    const state = prepareState(undefined, date);
    state.schemaVersion = schemaVersion;
    state.favorites = [{ ...createPaper(paper, date), note: "Keep this", extensionField: true }];
    delete state.paperCollections; delete state.paperMemberships;
    delete state.settings.lastUsedPaperCollectionId;
    if (schemaVersion < 4) delete state.authorPaperCaches;
    if (schemaVersion === 2) { state.following = []; delete state.authors; delete state.collections; delete state.memberships; }
    const net = network(), a = net.device("a", state); await net.settle();
    assert.deepEqual((await a.local.read()).favorites, state.favorites);
    const b = net.device("b"); await net.settle();
    assert.equal((await b.repo.listFavorites())[0].arxivId, paper.arxivId);
  }
});

test("paper save/delete and author follow/unfollow propagate without coupling their state", async () => {
  const net = network(), a = net.device("a"), b = net.device("b");
  await a.repo.savePaper(paper); const followed = await a.repo.followAuthor(author); await net.settle();
  assert.equal((await b.repo.listFollowing()).length, 1);
  assert.equal((await b.repo.listFavorites()).length, 1);
  await b.repo.removeFavorite(paper.arxivId); await net.settle();
  assert.deepEqual(await a.repo.listFavorites(), []);
  assert.equal((await a.repo.listFollowing()).length, 1);
  await b.repo.unfollowAuthor(followed.id); await net.settle();
  assert.deepEqual(await a.repo.listFollowing(), []);
  assert.equal((await a.repo.getAuthorLibrary()).authors[0].id, followed.id);
  assert.equal(net.server[syncKey("pm", paper.arxivId, defaultId)].value, null);
  await a.repo.followAuthor(author); await a.repo.savePaper(paper); await net.settle();
  assert.equal((await b.repo.listFollowing()).length, 1);
  assert.equal((await b.repo.listFavorites()).length, 1);
});

test("paper collections create/rename/membership/delete maintain schema-5 semantics", async () => {
  const net = network(), a = net.device("a"), b = net.device("b");
  await a.repo.savePaper(paper);
  const c = await a.repo.createPaperCollection("Reading", paper); await net.settle();
  await b.repo.renamePaperCollection(c.id, "Research");
  await b.repo.removePaperFromCollection(paper.arxivId, defaultId); await net.settle();
  assert.equal((await a.repo.getPaperLibrary()).collections.find(x => x.id === c.id).name, "Research");
  assert.equal((await a.repo.listFavorites()).length, 1);
  await a.repo.deletePaperCollection(c.id); await net.settle();
  assert.equal((await b.repo.getPaperLibrary()).memberships.length, 0);
  assert.equal((await b.repo.listFavorites()).length, 0);
  assert.equal((await b.repo.getPaperLibrary()).settings.lastUsedPaperCollectionId, defaultId);
});

test("author collections synchronize even when hidden; deletion retains Author entities", async () => {
  const net = network(), a = net.device("a"), b = net.device("b");
  const c = await a.repo.createAuthorCollection("Geometers", author); await net.settle();
  await b.repo.renameAuthorCollection(c.id, "Algebra"); await net.settle();
  assert.equal((await a.repo.getAuthorLibrary()).collections[0].name, "Algebra");
  await a.repo.deleteAuthorCollection(c.id); await net.settle();
  assert.deepEqual(await b.repo.listFollowing(), []);
  assert.equal((await b.repo.getAuthorLibrary()).authors[0].id, stableAuthorKey(author.displayName));
});

test("disconnected devices add unrelated records without a shared queue; delayed transport converges", async () => {
  const net = network(), a = net.device("a"), b = net.device("b"); await net.settle();
  await a.repo.savePaper(paper); await b.repo.savePaper(other);
  await a.repo.followAuthor(author); await b.repo.followAuthor({ displayName: "Other Person" });
  await net.settle();
  for (const d of [a, b]) { assert.equal((await d.repo.listFavorites()).length, 2); assert.equal((await d.repo.listFollowing()).length, 2); }
});

test("concurrent collection name collisions keep both stable IDs with unique deterministic labels", async () => {
  const net = network(), a = net.device("a"), b = net.device("b"); await net.settle();
  const ac = await a.repo.createPaperCollection("Reading", paper);
  const bc = await b.repo.createPaperCollection("Reading", other); await net.settle();
  const shape = async d => (await d.repo.getPaperLibrary()).collections.map(c => [c.id, c.name]).sort();
  assert.deepEqual(await shape(a), await shape(b));
  const pairs = await shape(a);
  assert.ok(pairs.some(([id, name]) => id === ac.id && name === "Reading"));
  assert.ok(pairs.some(([id, name]) => id === bc.id && name === "Reading (2)"));
  await b.repo.renamePaperCollection(bc.id, "Different"); await net.settle();
  assert.deepEqual(await shape(a), await shape(b));
  const longName = "x".repeat(75) + " xxxx";
  await a.repo.createPaperCollection(longName);
  await a.repo.createPaperCollection("x".repeat(75) + " (2)");
  await b.repo.createPaperCollection(longName); await net.settle();
  assert.deepEqual(await shape(a), await shape(b));
  assert.ok((await shape(a)).some(([, name]) => name === "x".repeat(75) + " (3)"));
});

test("same-register concurrent edits use logical revision then replica ID, not date", async () => {
  const net = network(), a = net.device("a"), b = net.device("b");
  const c = await a.repo.createPaperCollection("Initial"); await net.settle();
  a.repo.clock = () => "2099-01-01T00:00:00Z";
  b.repo.clock = () => "2000-01-01T00:00:00Z";
  await a.repo.renamePaperCollection(c.id, "A"); await b.repo.renamePaperCollection(c.id, "B");
  await net.settle();
  for (const d of [a, b]) assert.equal((await d.repo.getPaperLibrary()).collections.find(x => x.id === c.id).name, "B");
});

test("global removal deletes observed memberships; unseen concurrent different membership survives", async () => {
  const net = network(), a = net.device("a"), b = net.device("b");
  await a.repo.savePaper(paper); const c = await a.repo.createPaperCollection("Extra"); await net.settle();
  await a.repo.removeFavorite(paper.arxivId);
  await b.repo.addPaperToCollection(paper, c.id); await net.settle();
  for (const d of [a, b]) assert.deepEqual((await d.repo.getPaperLibrary()).memberships.map(m => m.collectionId), [c.id]);
});

test("collection delete suppresses delayed members; restoring the default cannot resurrect old ones", async () => {
  const net = network(), a = net.device("a"), b = net.device("b");
  await a.repo.savePaper(paper); await net.settle();
  await a.repo.deletePaperCollection(defaultId);
  await b.repo.savePaper(other); await net.settle();
  assert.deepEqual(await a.repo.listFavorites(), []);
  await a.repo.savePaper(paper); await net.settle();
  for (const d of [a, b]) assert.deepEqual((await d.repo.listFavorites()).map(p => p.arxivId), [paper.arxivId]);
});

test("stale/replayed events repair tombstones and never toggle saved state", async () => {
  const net = network(), a = net.device("a"), b = net.device("b");
  await a.repo.savePaper(paper); await net.settle();
  const key = syncKey("pm", paper.arxivId, defaultId), stale = clone(net.server[key]);
  await a.repo.removeFavorite(paper.arxivId); await net.settle();
  const removed = clone(net.server[key]);
  for (const d of [a, b]) {
    d.view[key] = stale;
    d.storage.observe({ [key]: { oldValue: removed, newValue: stale } });
    d.storage.observe({ [key]: { oldValue: removed, newValue: stale } });
  }
  await net.settle();
  assert.deepEqual(net.server[key], removed);
  assert.deepEqual(await b.repo.listFavorites(), []);
  const writes = a.writes + b.writes;
  a.storage.observe({ [key]: { oldValue: removed, newValue: removed } });
  await net.settle();
  assert.equal(a.writes + b.writes, writes);
});

test("restart with failed pending upload retains library, identity, logical clock and removal intent", async () => {
  const net = network(), a = net.device("a"), b = net.device("b");
  await a.repo.savePaper(paper); await net.settle(); a.fail = true;
  await a.repo.removeFavorite(paper.arxivId); net.advance(); await a.repo.listFavorites();
  const disk = await a.local.read(); assert.match(disk._chromeSync.lastError, /QUOTA/);
  a.restart(); a.fail = false; await net.settle();
  assert.equal((await a.local.read())._chromeSync.id, disk._chromeSync.id);
  assert.deepEqual(await b.repo.listFavorites(), []);
  assert.equal((await a.local.read())._chromeSync.lastError, null);
});

test("partial independent records wait for dependencies instead of corrupting or losing saved intent", async () => {
  const net = network(), a = net.device("a"); await net.settle();
  const member = syncKey("pm", paper.arxivId, defaultId);
  a.view[member] = record({ addedAt: date, updatedAt: date, generation: null });
  await a.repo.listFavorites(); assert.deepEqual(await a.repo.listFavorites(), []);
  a.view[syncKey("p", paper.arxivId)] = record(projectState({ ...prepareState(undefined, date), favorites: [createPaper(paper, date)] })[syncKey("p", paper.arxivId)]);
  assert.equal((await a.repo.listFavorites()).length, 1);
});

test("caches, full local metadata, unknown fields and last-used choices never enter sync", async () => {
  const net = network(), a = net.device("a"), b = net.device("b");
  await a.repo.savePaper({ ...paper, abstract: "CACHE-SECRET", categories: ["math.AG"], note: "LOCAL-NOTE" });
  await a.repo.putAuthorPaperCache({ authorId: stableAuthorKey(author.displayName), queryUsed: "CACHE-QUERY", fetchedAt: date,
    papers: [{ ...paper, abstract: "CACHE-SECRET", publishedAt: date, categories: [] }] });
  const c = await a.repo.createPaperCollection("Reading"); await net.settle();
  assert.equal((await a.repo.getPaperLibrary()).settings.lastUsedPaperCollectionId, c.id);
  assert.equal((await b.repo.getPaperLibrary()).settings.lastUsedPaperCollectionId, defaultId);
  assert.doesNotMatch(JSON.stringify(net.server), /CACHE-|LOCAL-NOTE|abstract|lastUsed|authorPaperCaches/);
  assert.equal((await a.local.read()).authorPaperCaches.length, 1);
  assert.deepEqual((await b.local.read()).authorPaperCaches, []);
  await a.repo.setOpenArxivLinksInNewTab(true); await a.repo.setOrganizeFollowedAuthorsIntoCollections(true); await net.settle();
  assert.deepEqual(await b.repo.getPreferences(), { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true });
});

test("malformed/unsupported remote state pauses writes, preserves local library and leaves remote untouched", async () => {
  for (const bad of [record({ title: "Missing authors" }), { ...record(null), v: 2 }]) {
    const key = syncKey("p", paper.arxivId), net = network({ [key]: bad }), a = net.device("a");
    await a.repo.savePaper(paper); await a.repo.savePaper(other);
    assert.equal((await a.repo.listFavorites()).length, 2);
    assert.match((await a.local.read())._chromeSyncError, /sync.*(?:version|record)/i);
    assert.deepEqual(net.server[key], bad); assert.equal(a.writes, 0);
  }
});

test("read failure never treats remote state as empty and local writes still commit", async () => {
  const net = network(), a = net.device("a"); a.failRead = true;
  await a.repo.savePaper(paper);
  assert.equal((await a.repo.listFavorites()).length, 1); assert.equal(a.writes, 0);
  a.failRead = false; await net.settle();
  const b = net.device("b"); await net.settle();
  assert.equal((await b.repo.listFavorites()).length, 1);
});

test("rejected sync writes preserve new local saves; failed local writes publish nothing", async () => {
  const net = network(), a = net.device("a"), b = net.device("b"); await net.settle();
  a.fail = true;
  await a.repo.savePaper(paper); net.advance(); await a.repo.listFavorites();
  assert.equal((await a.local.read()).favorites.length, 1);
  assert.match((await a.local.read())._chromeSync.lastError, /QUOTA/);
  assert.deepEqual(await b.repo.listFavorites(), []);
  a.fail = false; await net.settle();
  assert.equal((await b.repo.listFavorites()).length, 1);
  const disk = await a.local.read(), writes = a.writes;
  a.local.write = async () => { throw new Error("Local quota"); };
  await assert.rejects(a.repo.savePaper(other), /Local quota/);
  assert.deepEqual(await a.local.read(), disk); assert.equal(a.writes, writes);
});

test("bursts coalesce below Chrome rate quotas and cache-only writes do not publish", async () => {
  const net = network(), a = net.device("a"); await net.settle();
  const before = a.writes;
  for (let i = 1; i <= 20; i++) await a.repo.savePaper({ ...paper, arxivId: `2401.${String(i).padStart(5, "0")}` });
  assert.ok(a.writes - before <= 1);
  await net.settle();
  const after = a.writes;
  await a.repo.putAuthorPaperCache({ authorId: stableAuthorKey(author.displayName), papers: [], fetchedAt: date, queryUsed: "local-query" });
  await net.settle(); assert.equal(a.writes, after);
});

test("invalid local schema is never replaced or exported", async () => {
  const original = { schemaVersion: 99, precious: "keep" };
  const net = network(), a = net.device("a", original);
  await assert.rejects(a.repo.listFavorites(), /Unsupported or damaged library/);
  assert.deepEqual(await a.local.read(), original); assert.equal(a.writes, 0);
});

test("remote author collections do not change a local null last-used choice", async () => {
  const net = network(), a = net.device("a"), b = net.device("b");
  await a.repo.followAuthor(author); await net.settle();
  assert.equal((await b.repo.getAuthorLibrary()).settings.lastUsedAuthorCollectionId, null);
  assert.equal((await b.repo.listFollowing()).length, 1);
});

test("quota failures leave oversized records local without truncation or aggressive retry", async () => {
  const net = network(), a = net.device("a"); await net.settle();
  await a.repo.savePaper({ ...paper, title: "長".repeat(4000) });
  net.advance(); await a.repo.listFavorites();
  const disk = await a.local.read();
  assert.equal(disk.favorites[0].title.length, 4000);
  assert.match(disk._chromeSync.lastError, /per-item quota/);
  const attempts = a.writes;
  for (let i = 0; i < 5; i++) await a.repo.getPaperLibrary();
  assert.equal(a.writes, attempts);
  assert.ok(a.schedules.length);
});

test("quota budgeting includes foreign keys and item/total limits; realistic small library fits", () => {
  assert.throws(() => assertQuota({ a: 1, b: 2 }, { MAX_ITEMS: 1 }), /MAX_ITEMS/);
  assert.throws(() => assertQuota({ foreign: "long value" }, { QUOTA_BYTES: 4 }), /total quota/);
  assert.throws(() => assertQuota({ a: "😀" }, { QUOTA_BYTES_PER_ITEM: 5 }), /per-item/);
  const values = {};
  const wireRecord = value => record(value, 1000, "11111111-2222-4333-8444-555555555555");
  for (let i = 0; i < 100; i++) {
    const id = `2401.${String(i).padStart(5, "0")}`;
    values[syncKey("p", id)] = wireRecord({ title: "Research title ".repeat(7), authors: ["Alex Kim", "Renée Smith", "Third Author"], savedAt: date, updatedAt: date });
    values[syncKey("pm", id, defaultId)] = wireRecord({ addedAt: date, updatedAt: date, generation: null });
  }
  values[syncKey("pc", defaultId)] = wireRecord({ name: "Saved Papers", createdAt: date, updatedAt: date });
  values[syncKey("s", "openArxivLinksInNewTab")] = wireRecord(false);
  values[syncKey("s", "organizeFollowedAuthorsIntoCollections")] = wireRecord(false);
  const budget = assertQuota(values);
  assert.equal(budget.items, 203); assert.ok(budget.bytes < 75000, JSON.stringify(budget));
});

test("merge is commutative/idempotent and deletion history survives a newer restoration", () => {
  const deleted = record(null, 3, "a"), restored = record({ name: "Restored", createdAt: date, updatedAt: date }, 4, "b");
  const joined = mergeRecord(deleted, restored);
  assert.deepEqual(joined, mergeRecord(restored, deleted));
  assert.deepEqual(joined, mergeRecord(joined, joined));
  assert.deepEqual(joined.deleted, deleted.rev);
  validateRecord(syncKey("pc", defaultId), joined);
});

test("unsupported local sync metadata never resets the replica or blocks local domain writes", async () => {
  const state = prepareState(undefined, date); state._chromeSync = { version: 9, retained: true };
  const net = network(), a = net.device("a", state);
  await a.repo.savePaper(paper);
  assert.deepEqual((await a.local.read())._chromeSync, state._chromeSync);
  assert.equal((await a.repo.listFavorites()).length, 1); assert.equal(a.writes, 0);
});

test("preference classification syncs only the two durable booleans", () => {
  const state = prepareState(undefined, date);
  state.settings.internalView = "local-only";
  state._chromeSyncError = "internal-only";
  state.authorPaperCaches.push({ queryUsed: "cache-only" });
  const projected = projectState(state);
  assert.deepEqual(Object.keys(projected).filter(key => JSON.parse(key.slice("xivary.sync:".length))[0] === "s").sort(),
    PREFERENCES.map(name => syncKey("s", name)).sort());
  assert.doesNotMatch(JSON.stringify(projected), /lastUsed|internalView|internal-only|cache-only/);
  for (const name of ["lastUsedAuthorCollectionId", "lastUsedPaperCollectionId", "internalView"]) {
    assert.throws(() => validateRecord(syncKey("s", name), record(false)), /Malformed/);
  }
});

test("local preferences bootstrap to empty sync and remote values beat fresh defaults", async () => {
  const state = prepareState(undefined, date);
  state.settings.openArxivLinksInNewTab = true;
  state.settings.organizeFollowedAuthorsIntoCollections = true;
  const net = network(), a = net.device("a", state);
  await net.settle();
  for (const name of PREFERENCES) {
    assert.equal(net.server[syncKey("s", name)].value, true);
    assert.deepEqual(net.server[syncKey("s", name)].rev, [0, "a"]);
  }
  const b = net.device("z"); await net.settle();
  assert.deepEqual(await b.repo.getPreferences(), await a.repo.getPreferences());
  assert.deepEqual((await b.local.read())._chromeSync.bootstrapSnapshot.settings, prepareState(undefined, date).settings);
});

test("pre-settings Sync v1 replicas seed missing preferences without revising library records", async () => {
  const oldNet = network(), old = oldNet.device("old");
  await old.repo.savePaper(paper); await old.repo.followAuthor(author); await oldNet.settle();
  const disk = await old.local.read(), remote = clone(oldNet.server);
  disk.settings.openArxivLinksInNewTab = true;
  disk.settings.organizeFollowedAuthorsIntoCollections = true;
  for (const name of PREFERENCES) {
    delete disk._chromeSync.records[syncKey("s", name)];
    delete remote[syncKey("s", name)];
  }
  const net = network(remote), a = net.device("old", disk); await net.settle();
  const b = net.device("new"); await net.settle();
  assert.deepEqual(await b.repo.getPreferences(), { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true });
  assert.deepEqual((await a.local.read()).favorites, disk.favorites);
  assert.deepEqual((await a.local.read()).memberships, disk.memberships);
  for (const [key, value] of Object.entries(remote)) assert.deepEqual(net.server[key], value);
  for (const name of PREFERENCES) assert.deepEqual(net.server[syncKey("s", name)].rev, [0, "old"]);
  assert.equal((await a.local.read())._chromeSync.counter, disk._chromeSync.counter);
});

test("existing remote preference beats an older replica's missing register even at revision zero", async () => {
  const net = network(), a = net.device("local"); await net.settle();
  const disk = await a.local.read();
  delete disk._chromeSync.records[syncKey("s", "openArxivLinksInNewTab")];
  const remote = clone(net.server);
  remote[syncKey("s", "openArxivLinksInNewTab")] = record(true, 0, "remote");
  const upgrade = network(remote), b = upgrade.device("local", disk); await upgrade.settle();
  assert.equal((await b.repo.getPreferences()).openArxivLinksInNewTab, true);
  assert.deepEqual(upgrade.server[syncKey("s", "openArxivLinksInNewTab")], remote[syncKey("s", "openArxivLinksInNewTab")]);
});

test("preferences propagate both ways without changing bookmarks, follows, caches or local pointers", async () => {
  const net = network(), a = net.device("a"), b = net.device("b");
  await a.repo.savePaper(paper); await a.repo.followAuthor(author);
  const ac = await a.repo.createAuthorCollection("A context", author);
  const pc = await a.repo.createPaperCollection("A reading", paper);
  await a.repo.putAuthorPaperCache({ authorId: stableAuthorKey(author.displayName), papers: [], fetchedAt: date, queryUsed: "local cache" });
  await net.settle();
  const before = await a.local.read();
  await a.repo.setOpenArxivLinksInNewTab(true);
  await b.repo.setOrganizeFollowedAuthorsIntoCollections(true); await net.settle();
  for (const d of [a, b]) assert.deepEqual(await d.repo.getPreferences(), { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true });
  await b.repo.setOpenArxivLinksInNewTab(false);
  await a.repo.setOrganizeFollowedAuthorsIntoCollections(false); await net.settle();
  for (const d of [a, b]) assert.deepEqual(await d.repo.getPreferences(), { openArxivLinksInNewTab: false, organizeFollowedAuthorsIntoCollections: false });
  const after = await a.local.read();
  for (const field of ["favorites", "authors", "paperCollections", "collections", "paperMemberships", "memberships", "authorPaperCaches"]) assert.deepEqual(after[field], before[field]);
  assert.equal(after.settings.lastUsedAuthorCollectionId, ac.id);
  assert.equal(after.settings.lastUsedPaperCollectionId, pc.id);
  assert.equal((await b.local.read()).settings.lastUsedAuthorCollectionId, null);
  assert.equal((await b.local.read()).settings.lastUsedPaperCollectionId, defaultId);
  assert.deepEqual((await b.local.read()).authorPaperCaches, []);
});

test("stale, duplicate and delayed preference records retain the winning desired state", async () => {
  const net = network(), a = net.device("a"), b = net.device("b"); await net.settle();
  const key = syncKey("s", "openArxivLinksInNewTab"), stale = clone(net.server[key]);
  await a.repo.setOpenArxivLinksInNewTab(true); await net.settle();
  const winner = clone(net.server[key]);
  net.server[key] = stale;
  for (const d of [a, b]) {
    d.view[key] = stale;
    d.storage.observe({ [key]: { oldValue: winner, newValue: stale } });
    d.storage.observe({ [key]: { oldValue: winner, newValue: stale } });
  }
  await net.settle();
  assert.deepEqual(net.server[key], winner);
  for (const d of [a, b]) assert.equal((await d.repo.getPreferences()).openArxivLinksInNewTab, true);
  const writes = a.writes + b.writes;
  b.storage.observe({ [key]: { oldValue: stale, newValue: winner } });
  await net.settle(); assert.equal(a.writes + b.writes, writes);
  b.restart(); await net.settle();
  assert.equal((await b.repo.getPreferences()).openArxivLinksInNewTab, true);
});

test("concurrent preferences use logical counters and replica ties while independent settings merge", async () => {
  const net = network(), a = net.device("a"), b = net.device("b"); await net.settle();
  a.repo.clock = () => "2099-01-01T00:00:00Z";
  b.repo.clock = () => "2000-01-01T00:00:00Z";
  await a.repo.setOrganizeFollowedAuthorsIntoCollections(true);
  await a.repo.setOpenArxivLinksInNewTab(true);
  await b.repo.setOpenArxivLinksInNewTab(true);
  await b.repo.setOpenArxivLinksInNewTab(false);
  await net.settle();
  for (const d of [a, b]) assert.deepEqual(await d.repo.getPreferences(), { openArxivLinksInNewTab: false, organizeFollowedAuthorsIntoCollections: true });
  assert.deepEqual(net.server[syncKey("s", "openArxivLinksInNewTab")].rev, [2, "b"]);
});

test("unchanged preferences do not acquire new revisions or publications", async () => {
  const net = network(), a = net.device("a"); await net.settle();
  const before = clone(net.server), disk = await a.local.read(), writes = a.writes;
  await a.repo.setOpenArxivLinksInNewTab(false);
  await a.repo.setOrganizeFollowedAuthorsIntoCollections(false); await net.settle();
  assert.deepEqual(net.server, before);
  assert.equal((await a.local.read())._chromeSync.counter, disk._chromeSync.counter);
  assert.equal(a.writes, writes);
});

test("failed preference publication remains local and recovers after retry and restart", async () => {
  const net = network(), a = net.device("a"), b = net.device("b"); await net.settle();
  a.fail = true;
  await a.repo.setOpenArxivLinksInNewTab(true);
  await a.repo.setOrganizeFollowedAuthorsIntoCollections(true);
  net.advance(); await a.repo.getPreferences();
  const disk = await a.local.read();
  assert.match(disk._chromeSync.lastError, /QUOTA/);
  assert.equal(disk.settings.openArxivLinksInNewTab, true);
  assert.equal((await b.repo.getPreferences()).openArxivLinksInNewTab, false);
  const revision = clone(disk._chromeSync.records[syncKey("s", "openArxivLinksInNewTab")].rev);
  a.restart(); a.fail = false; await net.settle();
  assert.deepEqual(await b.repo.getPreferences(), { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true });
  assert.deepEqual(net.server[syncKey("s", "openArxivLinksInNewTab")].rev, revision);
  assert.equal((await a.local.read())._chromeSync.lastError, null);
});

test("malformed or unsupported remote preferences pause sync without resetting local state", async () => {
  for (const bad of [record("false"), { ...record(true), v: 2 }, record(null)]) {
    const key = syncKey("s", "openArxivLinksInNewTab");
    const state = prepareState(undefined, date); state.settings.openArxivLinksInNewTab = true;
    const net = network({ [key]: bad }), a = net.device("a", state);
    await a.repo.savePaper(paper); await a.repo.followAuthor(author);
    await a.repo.setOrganizeFollowedAuthorsIntoCollections(true);
    assert.deepEqual(await a.repo.getPreferences(), { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true });
    assert.equal((await a.repo.listFavorites()).length, 1);
    assert.equal((await a.repo.listFollowing()).length, 1);
    assert.match((await a.local.read())._chromeSyncError, /sync.*(?:version|record)/i);
    assert.deepEqual(net.server[key], bad); assert.equal(a.writes, 0);
  }
});

test("unavailable sync retains preference edits and a local-only repository needs no transport", async () => {
  const net = network(), a = net.device("a"); a.failRead = true;
  await a.repo.setOpenArxivLinksInNewTab(true);
  await a.repo.setOrganizeFollowedAuthorsIntoCollections(true);
  assert.equal(a.writes, 0);
  assert.ok(a.schedules.length);
  a.failRead = false; await net.settle();
  const b = net.device("b"); await net.settle();
  assert.deepEqual(await b.repo.getPreferences(), { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true });
  let disk;
  const local = new LocalRepository({ read: async () => clone(disk), write: async value => { disk = clone(value); } });
  await local.setOpenArxivLinksInNewTab(true);
  await local.setOrganizeFollowedAuthorsIntoCollections(true);
  assert.deepEqual(await local.getPreferences(), await b.repo.getPreferences());
  assert.equal(Object.hasOwn(disk, "_chromeSync"), false);
});

test("portable category imports and library sync leave preference values and revisions unchanged", async () => {
  const net = network(), a = net.device("a"), b = net.device("b");
  await a.repo.setOpenArxivLinksInNewTab(true);
  await a.repo.setOrganizeFollowedAuthorsIntoCollections(true); await net.settle();
  const before = Object.fromEntries(PREFERENCES.map(name => [syncKey("s", name), clone(net.server[syncKey("s", name)])]));
  let sourceDisk;
  const source = new LocalRepository({ read: async () => clone(sourceDisk), write: async value => { sourceDisk = clone(value); } });
  await source.savePaper(paper); await source.followAuthor(author);
  for (const category of ["bookmarks", "following"]) {
    const file = await source.exportCategory(category);
    assert.equal(Object.hasOwn(file, "preferences"), false);
    await a.repo.importCategory(JSON.stringify(file), category); await net.settle();
    assert.deepEqual(await b.repo.getPreferences(), { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true });
  }
  for (const [key, value] of Object.entries(before)) assert.deepEqual(net.server[key], value);
  assert.equal((await b.repo.listFavorites()).length, 1);
  assert.equal((await b.repo.listFollowing()).length, 1);
});

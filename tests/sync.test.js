import test from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { LocalRepository, prepareState } from "../extension/src/repository/local-repository.js";
import { SyncStorage } from "../extension/src/repository/sync-storage.js";
import { assertQuota, equal, mergeRecord, projectState, syncKey, validateRecord, PREFERENCES, isPreferenceKey, materialize, recordChanges } from "../extension/src/repository/sync-model.js";
import { createPaper } from "../extension/src/domain/paper.js";
import { stableAuthorKey } from "../extension/src/domain/author.js";

const date = "2026-10-03T00:00:00.000Z";
const paper = { arxivId: "2401.00001", title: "An offline readable title", authors: ["Alex Kim", "Renée Smith"] };
const other = { ...paper, arxivId: "2401.00002", title: "Independent paper" };
const author = { displayName: "Alex Kim" };
const defaultId = "paper-collection:saved-papers";
const clone = value => structuredClone(value);
const legacy = JSON.parse(await readFile(new URL("./fixtures/legacy-sync-v1.json", import.meta.url), "utf8"));
const fields = ["favorites", "authors", "paperCollections", "collections", "paperMemberships", "memberships", "authorPaperCaches"];
const library = state => Object.fromEntries(fields.map(field => [field, clone(state[field])]));
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


// Settings-only isolation and nondestructive legacy cutover regressions.

test("populated installations publish only preferences and independent installations retain separate libraries", async () => {
  const n = network(), a = n.device("a"), b = n.device("b");
  await a.repo.savePaper(paper); await a.repo.followAuthor(author);
  await b.repo.savePaper(other); await b.repo.followAuthor({ displayName: "Renée Smith" });
  const beforeA = library(await a.local.read()), beforeB = library(await b.local.read());
  await n.settle();
  assert.deepEqual(Object.keys(n.server).sort(), PREFERENCES.map(name => syncKey("s", name)).sort());
  assert.deepEqual(library(await a.local.read()), beforeA);
  assert.deepEqual(library(await b.local.read()), beforeB);
  await a.repo.setOpenArxivLinksInNewTab(true); await n.settle();
  assert.equal((await b.repo.getPreferences()).openArxivLinksInNewTab, true);
  assert.deepEqual(library(await b.local.read()), beforeB);
});

test("Following create/rename/move/delete stays local even when organization preference propagates", async () => {
  const n = network(), a = n.device("a"), b = n.device("b");
  await a.repo.followAuthor(author); await n.settle();
  const first = (await a.repo.getAuthorLibrary()).collections[0];
  const next = await a.repo.createAuthorCollection("A");
  await a.repo.addAuthorToCollection(author, next.id);
  await a.repo.removeAuthorFromCollection(stableAuthorKey(author.displayName), first.id);
  await a.repo.renameAuthorCollection(next.id, "Renamed");
  await a.repo.setOrganizeFollowedAuthorsIntoCollections(true); await n.settle();
  assert.equal((await b.repo.getPreferences()).organizeFollowedAuthorsIntoCollections, true);
  assert.deepEqual(await b.repo.listFollowing(), []);
  assert.deepEqual((await b.repo.getAuthorLibrary()).collections, []);
  await a.repo.deleteAuthorCollection(next.id); await n.settle();
  assert.deepEqual(await a.repo.listFollowing(), []);
  assert.equal((await a.repo.getAuthorLibrary()).authors.length, 1);
  assert.ok(Object.keys(n.server).every(isPreferenceKey));
});

test("Bookmark collections and removals stay local while local metadata is retained", async () => {
  const n = network(), a = n.device("a"), b = n.device("b");
  const saved = await a.repo.savePaper({ ...paper, abstract: "private local metadata", note: "keep" });
  const group = await a.repo.createPaperCollection("Read", paper);
  await a.repo.renamePaperCollection(group.id, "Read next");
  await n.settle();
  assert.deepEqual(await b.repo.listFavorites(), []);
  assert.equal((await a.repo.listFavorites())[0].abstract, saved.abstract);
  await a.repo.removePaperFromCollection(paper.arxivId, defaultId);
  await a.repo.deletePaperCollection(group.id); await n.settle();
  assert.deepEqual(await a.repo.listFavorites(), []);
  assert.ok(Object.keys(n.server).every(isPreferenceKey));
});

for (const type of ["p", "a", "pc", "ac", "pm", "am"]) {
  test(`legacy ${type} input/events never restore, overwrite or delete local library data`, async () => {
    const key = Object.keys(legacy).find(key => JSON.parse(key.slice("xivary.sync:".length))[0] === type);
    const initial = { [key]: legacy[key] };
    const n = network(initial), a = n.device("a");
    await a.repo.savePaper({ ...paper, title: "Local title", abstract: "keep" });
    await a.repo.followAuthor(author); await n.settle();
    const before = await a.local.read();
    assert.deepEqual(n.server[key], initial[key]);
    const tombstone = { v: 99, rev: [900, "older-client"], value: null, deleted: [900, "older-client"] };
    n.server[key] = clone(tombstone); a.view[key] = clone(tombstone);
    assert.equal(a.storage.observe({ [key]: { oldValue: legacy[key], newValue: tombstone } }), false);
    a.restart(); await n.settle();
    const after = await a.local.read();
    assert.deepEqual(library(after), library(before));
    assert.deepEqual(after.settings, before.settings);
    assert.equal(after._chromeSync.counter, before._chromeSync.counter);
    assert.deepEqual(n.server[key], tombstone);
    await a.repo.setOpenArxivLinksInNewTab(true); await n.settle();
    assert.deepEqual(n.server[key], tombstone, "preference publication never repairs legacy records");
    const fresh = n.device("fresh"); await n.settle();
    assert.deepEqual(await fresh.repo.listFavorites(), []);
    assert.deepEqual(await fresh.repo.listFollowing(), []);
  });
}

test("fresh installation with complete old Sync v1 library receives preferences only", async () => {
  const remote = { ...clone(legacy), [syncKey("s", PREFERENCES[0])]: record(true) };
  const n = network(remote), a = n.device("a"); await n.settle();
  assert.equal((await a.repo.getPreferences()).openArxivLinksInNewTab, true);
  assert.deepEqual(await a.repo.listFavorites(), []);
  assert.deepEqual(await a.repo.listFollowing(), []);
  assert.deepEqual((await a.repo.getAuthorLibrary()).collections, []);
  assert.equal((await a.repo.getPaperLibrary()).collections[0].name, "Saved Papers");
  for (const [key, value] of Object.entries(remote)) assert.deepEqual(n.server[key], value);
});

test("existing local legacy replica keeps identity, counter, snapshots and inert pending library records", async () => {
  const old = network().device("old");
  await old.repo.savePaper({ ...paper, abstract: "keep", future: 42 }); await old.repo.followAuthor(author);
  const disk = await old.local.read();
  disk.favorites[0].future = { keep: "paper extension metadata" };
  disk.authors[0].future = "author extension metadata";
  disk.paperCollections[0].future = "collection extension metadata";
  disk.settings.deviceOnly = "local context";
  disk.futureEnvelope = { keep: true };
  disk._chromeSync.records = { ...clone(legacy), [syncKey("s", PREFERENCES[0])]: record(true, 7, "old") };
  disk._chromeSync.counter = 7;
  disk._chromeSync.bootstrapSnapshot = { precious: "original migration snapshot", favorites: clone(disk.favorites) };
  disk.settings.openArxivLinksInNewTab = true;
  const n = network(), a = n.device("ignored-new-id", disk); await n.settle();
  const updated = await a.local.read();
  assert.deepEqual(library(updated), library(disk));
  assert.deepEqual(updated.settings, disk.settings);
  assert.deepEqual(updated.futureEnvelope, disk.futureEnvelope);
  assert.equal(updated._chromeSync.id, "old");
  assert.equal(updated._chromeSync.counter, 7);
  assert.deepEqual(updated._chromeSync.bootstrapSnapshot, disk._chromeSync.bootstrapSnapshot);
  for (const [key, value] of Object.entries(legacy)) assert.deepEqual(updated._chromeSync.records[key], value);
  assert.deepEqual(Object.keys(n.server).sort(), PREFERENCES.map(name => syncKey("s", name)).sort());
  assert.deepEqual(n.server[syncKey("s", PREFERENCES[0])], disk._chromeSync.records[syncKey("s", PREFERENCES[0])]);
  const stable = await a.local.read(); a.restart(); await n.settle();
  assert.deepEqual(await a.local.read(), stable, "cutover is idempotent");
});

test("legacy records missing preferences seed absent keys without advancing retained library clock", async () => {
  const state = prepareState(undefined, date);
  state.settings.organizeFollowedAuthorsIntoCollections = true;
  state._chromeSync = { version: 1, id: "old", counter: 5, records: clone(legacy), bootstrapped: true, retryAt: 0, lastError: null };
  const n = network(legacy), a = n.device("a", state); await n.settle();
  assert.equal((await a.local.read())._chromeSync.counter, 5);
  assert.deepEqual(n.server[syncKey("s", PREFERENCES[1])].rev, [0, "old"]);
  for (const [key, value] of Object.entries(legacy)) assert.deepEqual(n.server[key], value);
});

test("malformed/unsupported legacy and unknown keys cannot pause eligible preference Sync", async () => {
  const ignored = { ...clone(legacy), "xivary.sync:broken": { v: 99 },
    [syncKey("a", "invalid")]: "malformed legacy record", [syncKey("s", "futureSetting")]: record(true), foreign: { keep: true } };
  const n = network(ignored), a = n.device("a"), b = n.device("b");
  await a.repo.setOpenArxivLinksInNewTab(true); await n.settle();
  assert.equal((await b.repo.getPreferences()).openArxivLinksInNewTab, true);
  assert.equal((await a.local.read())._chromeSyncError, undefined);
  for (const [key, value] of Object.entries(ignored)) assert.deepEqual(n.server[key], value);
});

test("damaged inert legacy local records do not block settings or get uploaded", async () => {
  const state = prepareState(undefined, date);
  const ignored = { ...clone(legacy), "xivary.sync:broken": { v: 99 } };
  state._chromeSync = { version: 1, id: "old", counter: 5, records: ignored, bootstrapped: true, retryAt: 0, lastError: null };
  const n = network(), a = n.device("a", state);
  await a.repo.setOpenArxivLinksInNewTab(true); await n.settle();
  for (const [key, value] of Object.entries(ignored)) assert.deepEqual((await a.local.read())._chromeSync.records[key], value);
  assert.ok(Object.keys(n.server).every(isPreferenceKey));
});

test("projection and materialization cannot transfer a library even when directly given legacy records", () => {
  const state = prepareState(undefined, date);
  state.future = { keep: true };
  const before = clone(state);
  assert.deepEqual(materialize(state, legacy), state);
  const projected = projectState(state);
  assert.deepEqual(Object.keys(projected).sort(), PREFERENCES.map(name => syncKey("s", name)).sort());
  const replica = { id: "test", counter: 5, records: clone(legacy) };
  recordChanges(replica, { ...projected, [syncKey("p", "2401.00001")]: {} }, projected);
  assert.deepEqual(replica.records, legacy); assert.equal(replica.counter, 5);
  assert.deepEqual(state, before);
});

test("all schema 1–4 migrations remain lossless local operations before preference bootstrap", async () => {
  for (const version of [1, 2, 3, 4]) {
    const original = version < 3 ? { schemaVersion: version, favorites: [createPaper({ ...paper, note: "keep" }, date)], following: [], future: "keep" }
      : { ...prepareState(undefined, date), schemaVersion: version, future: "keep" };
    const expected = prepareState(original, date);
    const n = network(legacy), a = n.device("a", original);
    await a.repo.getPreferences(); await n.settle();
    assert.deepEqual(library(await a.local.read()), library(expected));
    assert.equal((await a.local.read()).future, "keep");
    assert.equal((await a.local.read()).schemaVersion, 5);
    assert.deepEqual((await a.local.read())._chromeSync.bootstrapSnapshot, { settings: Object.fromEntries(PREFERENCES.map(name => [name, ["openAuthorResultsInNewTab", "openXivaryFromToolbarInNewTab"].includes(name)])) });
    for (const [key, value] of Object.entries(legacy)) assert.deepEqual(n.server[key], value);
  }
});

test("invalid local schema never gets replaced or exported", async () => {
  const state = { schemaVersion: 99, precious: "keep" };
  const n = network(), a = n.device("a", state);
  await assert.rejects(a.repo.listFavorites(), /Unsupported or damaged library/);
  assert.deepEqual(await a.local.read(), state); assert.equal(a.writes, 0);
});

test("unsupported local sync metadata is preserved and local domain writes still work", async () => {
  const state = prepareState(undefined, date); state._chromeSync = { version: 9, precious: "keep" };
  const n = network(legacy), a = n.device("a", state);
  await a.repo.savePaper(paper);
  assert.deepEqual((await a.local.read())._chromeSync, state._chromeSync);
  assert.equal((await a.repo.listFavorites()).length, 1); assert.equal(a.writes, 0);
});

test("failed local writes never publish a desired preference", async () => {
  const n = network(), a = n.device("a"); await n.settle();
  const before = clone(n.server), disk = await a.local.read();
  a.local.write = async () => { throw new Error("local disk failed"); };
  await assert.rejects(a.repo.setOpenArxivLinksInNewTab(true), /local disk failed/);
  assert.deepEqual(n.server, before); assert.deepEqual(await a.local.read(), disk);
});

test("local library and cache activity neither advances preference clocks nor publishes", async () => {
  const n = network(), a = n.device("a"); await n.settle();
  const writes = a.writes, before = clone(n.server), counter = (await a.local.read())._chromeSync.counter;
  await a.repo.savePaper(paper); await a.repo.followAuthor(author);
  await a.repo.createPaperCollection("Empty"); await a.repo.createAuthorCollection("Empty");
  await a.repo.putAuthorPaperCache({ authorId: stableAuthorKey(author.displayName), papers: [], fetchedAt: date, queryUsed: "local" });
  await n.settle();
  assert.equal(a.writes, writes); assert.equal((await a.local.read())._chromeSync.counter, counter);
  assert.deepEqual(n.server, before);
});

test("preference merge remains commutative and idempotent", () => {
  const a = record(false, 5, "a"), b = record(true, 5, "b");
  assert.deepEqual(mergeRecord(a, b), mergeRecord(b, a));
  assert.deepEqual(mergeRecord(b, b), b);
  assert.deepEqual(mergeRecord(a, b), b);
});

test("legacy quota occupancy is accounted for without erasing remote history", async () => {
  const n = network(legacy), a = n.device("a");
  a.transport.limits = { MAX_ITEMS: Object.keys(legacy).length };
  await a.repo.setOpenArxivLinksInNewTab(true);
  const disk = await a.local.read();
  assert.equal(disk.settings.openArxivLinksInNewTab, true);
  assert.match(disk._chromeSync.lastError, /quota/i);
  assert.deepEqual(n.server, legacy);
  a.transport.limits = {}; a.restart(); await n.settle();
  assert.equal(n.server[syncKey("s", PREFERENCES[0])].value, true);
  for (const [key, value] of Object.entries(legacy)) assert.deepEqual(n.server[key], value);
});

test("quota preflight includes foreign keys, byte limits and item counts", () => {
  const values = { foreign: { payload: "keep" }, [syncKey("s", PREFERENCES[0])]: record(true) };
  assert.throws(() => assertQuota(values, { MAX_ITEMS: 1 }), /MAX_ITEMS/);
  assert.throws(() => assertQuota(values, { QUOTA_BYTES_PER_ITEM: 4 }), /per-item/);
  assert.throws(() => assertQuota(values, { QUOTA_BYTES: 4 }), /total/);
  assert.ok(assertQuota(values).bytes < 102400);
});

test("mixed preference and legacy change events update settings without touching local library", async () => {
  const n = network(), a = n.device("a");
  await a.repo.savePaper(paper); await a.repo.followAuthor(author); await n.settle();
  const before = await a.local.read(), key = syncKey("s", PREFERENCES[0]);
  const incoming = record(true, 20);
  const badLegacy = { v: 99, broken: true };
  const oldKey = Object.keys(legacy)[0];
  a.view[key] = incoming; a.view[oldKey] = badLegacy;
  assert.equal(a.storage.observe({ [key]: { newValue: incoming }, [oldKey]: { newValue: badLegacy } }), true);
  await n.settle();
  assert.equal((await a.repo.getPreferences()).openArxivLinksInNewTab, true);
  assert.deepEqual(library(await a.local.read()), library(before));
  assert.deepEqual(a.view[oldKey], badLegacy);
});

test("deleted remote preference key repairs from retained winner without replaying legacy data", async () => {
  const n = network(legacy), a = n.device("a"), b = n.device("b");
  await a.repo.setOpenArxivLinksInNewTab(true); await n.settle();
  const key = syncKey("s", PREFERENCES[0]), winner = clone(n.server[key]);
  delete n.server[key];
  for (const d of [a, b]) { delete d.view[key]; d.storage.observe({ [key]: { oldValue: winner } }); }
  await n.settle();
  assert.deepEqual(n.server[key], winner);
  assert.deepEqual(await b.repo.listFavorites(), []);
  for (const [key, value] of Object.entries(legacy)) assert.deepEqual(n.server[key], value);
});

test("legacy pending records never leak when unavailable Sync recovers after restart", async () => {
  const state = prepareState(undefined, date);
  state._chromeSync = { version: 1, id: "old", counter: 5, records: clone(legacy), bootstrapped: true, retryAt: 0, lastError: null };
  const n = network(), a = n.device("a", state); a.failRead = true;
  await a.repo.savePaper(paper); await a.repo.setOpenArxivLinksInNewTab(true);
  assert.equal(a.writes, 0);
  a.restart(); a.failRead = false; await n.settle();
  assert.ok(Object.keys(n.server).every(isPreferenceKey));
  assert.equal(n.server[syncKey("s", PREFERENCES[0])].value, true);
  for (const [key, value] of Object.entries(legacy)) assert.deepEqual((await a.local.read())._chromeSync.records[key], value);
  assert.equal((await a.repo.listFavorites()).length, 1);
});

test("repairing a malformed active remote record resumes Sync without resetting library", async () => {
  const key = syncKey("s", PREFERENCES[0]);
  const n = network({ [key]: record("bad") }), a = n.device("a");
  await a.repo.savePaper(paper); await a.repo.setOpenArxivLinksInNewTab(true);
  assert.match((await a.local.read())._chromeSyncError, /Malformed/);
  const repaired = record(false, 10);
  a.view[key] = repaired; a.storage.observe({ [key]: { newValue: repaired } });
  await n.settle();
  assert.equal((await a.repo.getPreferences()).openArxivLinksInNewTab, false);
  assert.equal((await a.local.read())._chromeSyncError, undefined);
  assert.equal((await a.repo.listFavorites()).length, 1);
});

test("preference bursts coalesce and durable desired state waits for the existing write interval", async () => {
  const n = network(), a = n.device("a"); await n.settle();
  await a.repo.setOpenArxivLinksInNewTab(true);
  const writes = a.writes;
  await a.repo.setOpenArxivLinksInNewTab(false);
  await a.repo.setOpenArxivLinksInNewTab(true);
  await a.repo.setOrganizeFollowedAuthorsIntoCollections(true);
  assert.equal(a.writes, writes);
  assert.equal((await a.local.read()).settings.organizeFollowedAuthorsIntoCollections, true);
  await n.settle();
  assert.equal(a.writes, writes + 1);
  assert.equal(n.server[syncKey("s", PREFERENCES[1])].value, true);
});

test("preference classification syncs only designated durable booleans", () => {
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
  assert.deepEqual((await b.local.read())._chromeSync.bootstrapSnapshot.settings, Object.fromEntries(PREFERENCES.map(name => [name, ["openAuthorResultsInNewTab", "openXivaryFromToolbarInNewTab"].includes(name)])));
});

test("pre-settings Sync v1 replicas seed missing preferences without revising library records", async () => {
  const oldNet = network(), old = oldNet.device("old");
  await old.repo.savePaper(paper); await old.repo.followAuthor(author); await oldNet.settle();
  const disk = await old.local.read(), remote = { ...clone(legacy), ...clone(oldNet.server) };
  Object.assign(disk._chromeSync.records, clone(legacy));
  disk._chromeSync.counter = 5;
  disk.settings.openArxivLinksInNewTab = true;
  disk.settings.organizeFollowedAuthorsIntoCollections = true;
  for (const name of PREFERENCES) {
    delete disk._chromeSync.records[syncKey("s", name)];
    delete remote[syncKey("s", name)];
  }
  const net = network(remote), a = net.device("old", disk); await net.settle();
  const b = net.device("new"); await net.settle();
  assert.deepEqual(await b.repo.getPreferences(), { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true, openAuthorResultsInNewTab: true, openXivaryFromToolbarInNewTab: true });
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
  for (const d of [a, b]) assert.deepEqual(await d.repo.getPreferences(), { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true, openAuthorResultsInNewTab: true, openXivaryFromToolbarInNewTab: true });
  await b.repo.setOpenArxivLinksInNewTab(false);
  await a.repo.setOrganizeFollowedAuthorsIntoCollections(false); await net.settle();
  for (const d of [a, b]) assert.deepEqual(await d.repo.getPreferences(), { openArxivLinksInNewTab: false, organizeFollowedAuthorsIntoCollections: false, openAuthorResultsInNewTab: true, openXivaryFromToolbarInNewTab: true });
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
  for (const d of [a, b]) assert.deepEqual(await d.repo.getPreferences(), { openArxivLinksInNewTab: false, organizeFollowedAuthorsIntoCollections: true, openAuthorResultsInNewTab: true, openXivaryFromToolbarInNewTab: true });
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
  assert.deepEqual(await b.repo.getPreferences(), { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true, openAuthorResultsInNewTab: true, openXivaryFromToolbarInNewTab: true });
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
    assert.deepEqual(await a.repo.getPreferences(), { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true, openAuthorResultsInNewTab: true, openXivaryFromToolbarInNewTab: true });
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
  assert.deepEqual(await b.repo.getPreferences(), { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true, openAuthorResultsInNewTab: true, openXivaryFromToolbarInNewTab: true });
  let disk;
  const local = new LocalRepository({ read: async () => clone(disk), write: async value => { disk = clone(value); } });
  await local.setOpenArxivLinksInNewTab(true);
  await local.setOrganizeFollowedAuthorsIntoCollections(true);
  assert.deepEqual(await local.getPreferences(), await b.repo.getPreferences());
  assert.equal(Object.hasOwn(disk, "_chromeSync"), false);
});

test("portable category imports remain local and leave preference values and revisions unchanged", async () => {
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
    assert.deepEqual(await b.repo.getPreferences(), { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true, openAuthorResultsInNewTab: true, openXivaryFromToolbarInNewTab: true });
  }
  for (const [key, value] of Object.entries(before)) assert.deepEqual(net.server[key], value);
  assert.equal((await b.repo.listFavorites()).length, 0);
  assert.equal((await b.repo.listFollowing()).length, 0);
});

test("new author-navigation preference upgrades old schema-5/v1 replicas and propagates without library data", async () => {
  const old = network(), previous = old.device("a"); await old.settle();
  const disk = await previous.local.read(), remote = clone(old.server), key = syncKey("s", "openAuthorResultsInNewTab");
  delete disk.settings.openAuthorResultsInNewTab; delete disk._chromeSync.records[key]; delete remote[key];
  const n = network(remote), a = n.device("a", disk); n.advance(); await n.settle();
  const b = n.device("b"); await n.settle();
  assert.equal((await a.repo.getPreferences()).openAuthorResultsInNewTab, true);
  assert.deepEqual(n.server[key].rev, [0, "a"]);
  await a.repo.setOpenAuthorResultsInNewTab(false); await n.settle();
  assert.equal((await b.repo.getPreferences()).openAuthorResultsInNewTab, false);
  await b.repo.setOpenAuthorResultsInNewTab(true); await n.settle();
  assert.equal((await a.repo.getPreferences()).openAuthorResultsInNewTab, true);
  assert.ok(Object.keys(n.server).every(isPreferenceKey));
  assert.deepEqual(await b.repo.listFollowing(), []);
  const file = await a.repo.exportCategory("bookmarks", { kind: "all" });
  assert.equal(JSON.stringify(file).includes("openAuthorResultsInNewTab"), false);
});

test("new toolbar preference upgrades old schema-5/v1 replicas and propagates without library data", async () => {
  const old = network(), previous = old.device("a"); await old.settle();
  const disk = await previous.local.read(), remote = clone(old.server), key = syncKey("s", "openXivaryFromToolbarInNewTab");
  delete disk.settings.openXivaryFromToolbarInNewTab; delete disk._chromeSync.records[key]; delete remote[key];
  const n = network(remote), a = n.device("a", disk); n.advance(); await n.settle();
  const b = n.device("b"); await n.settle();
  assert.equal((await a.repo.getPreferences()).openXivaryFromToolbarInNewTab, true);
  assert.deepEqual(n.server[key].rev, [0, "a"]);
  await a.repo.setOpenXivaryFromToolbarInNewTab(false); await n.settle();
  assert.equal((await b.repo.getPreferences()).openXivaryFromToolbarInNewTab, false);
  await b.repo.setOpenXivaryFromToolbarInNewTab(true); await n.settle();
  assert.equal((await a.repo.getPreferences()).openXivaryFromToolbarInNewTab, true);
  assert.ok(Object.keys(n.server).every(isPreferenceKey));
  assert.deepEqual(await b.repo.listFollowing(), []);
  const file = await a.repo.exportCategory("bookmarks", { kind: "all" });
  assert.equal(JSON.stringify(file).includes("openXivaryFromToolbarInNewTab"), false);
});

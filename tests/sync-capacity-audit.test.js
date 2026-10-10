import test from "node:test";
import assert from "node:assert/strict";
import { capacityFixture, compactSnapshot, legacyRecords, usage, itemBytes } from "../scripts/fixtures/sync-capacity.mjs";
import { assertQuota, validateRecord, syncKey } from "../extension/src/repository/sync-model.js";
import { LocalRepository, prepareState } from "../extension/src/repository/local-repository.js";
import { SyncStorage } from "../extension/src/repository/sync-storage.js";

test("realistic capacity audit retains full metadata, stable IDs and multiple collection memberships", () => {
  for (const papers of [300, 500, 1000]) {
    const state = capacityFixture(papers);
    assert.equal(state.favorites.length, papers);
    assert.equal(state.authors.length, 100);
    assert.equal(state.paperCollections.length + state.collections.length, 13);
    assert.equal(state.paperMemberships.length, papers + Math.ceil(papers / 3));
    assert.equal(state.memberships.length, 134);
    assert.ok(state.favorites.every(p => p.abstract.length > 1000 && p.authors.length >= 4));
    assert.deepEqual(prepareState(state, "2026-10-10T00:00:00Z"), state);
    const full = usage({ arxivResearchLibrary: state });
    assert.ok(full.bytes < 10 * 1024 * 1024 && full.overItem);
    const legacy = usage(legacyRecords(state));
    assert.ok(legacy.overTotal && legacy.overCount && !legacy.overItem);
    assert.throws(() => assertQuota(legacyRecords(state)), /MAX_ITEMS/);
    const compact = compactSnapshot(state);
    assert.ok(usage(compact).largestItem <= 6144);
    assertQuota(compact); // Capacity only, not evidence of safe merge semantics.
    assert.equal(JSON.stringify(compact).includes(state.favorites[0].abstract), false);
    assert.equal(JSON.stringify(compact).includes(state.favorites[0].title), false);
  }
});

test("quota audit accounts for serialized escaping, UTF-8, key lengths and all three ceilings", () => {
  const value = { text: '李明\n"\\😀' };
  assert.equal(itemBytes("clé", value), Buffer.byteLength("clé") + Buffer.byteLength(JSON.stringify(value)));
  assert.deepEqual(assertQuota({ "clé": value }), { items: 1, bytes: itemBytes("clé", value) });
  assert.equal(assertQuota({ k: "x".repeat(8189) }).bytes, 8192);
  assert.throws(() => assertQuota({ k: "x".repeat(8190) }), /per-item/);
  const keys = Object.fromEntries(Array.from({ length: 512 }, (_, i) => [`k${i}`, false]));
  assertQuota(keys);
  assert.throws(() => assertQuota({ ...keys, extra: false }), /MAX_ITEMS/);
  const near = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`k${i}`, "x".repeat(7000)]));
  assert.ok(assertQuota(near).bytes > 102400 * .9, "90% is not an automatic capacity stop");
  assert.throws(() => assertQuota({ ...near, foreign: "x".repeat(7000) }), /total/);
  const compact = compactSnapshot(capacityFixture());
  const occupied = Object.fromEntries(Array.from({ length: 512 - Object.keys(compact).length }, (_, i) => [`legacy-${i}`, true]));
  assertQuota({ ...occupied, ...compact });
  occupied.foreign = true;
  assert.throws(() => assertQuota({ ...occupied, ...compact }), /MAX_ITEMS/);
});

test("target-size local library and pending preferences survive rejected writes and restart", async () => {
  let disk = capacityFixture(), now = Date.parse("2026-10-10T00:00:00Z"), rejected = 0;
  const original = structuredClone(disk);
  const local = { read: async () => structuredClone(disk), write: async state => { disk = structuredClone(state); } };
  let failing = true, remote = {};
  const transport = { limits: {}, read: async () => structuredClone(remote), schedule: async () => {},
    write: async records => { if (failing) { rejected++; throw Error("QUOTA_BYTES rejected by provider"); } remote = { ...remote, ...structuredClone(records) }; } };
  const restart = () => new LocalRepository(new SyncStorage(local, transport, { now: () => now, makeId: () => "audit-device" }));
  let repo = restart();
  await repo.setOpenArxivLinksInNewTab(true);
  await repo.savePaper({ arxivId: "2601.99999", title: "Still saved locally", authors: ["Offline Researcher"] });
  await repo.followAuthor({ displayName: "Offline Researcher" });
  assert.ok(rejected > 0);
  assert.match(disk._chromeSync.lastError, /QUOTA/);
  const pending = structuredClone(disk._chromeSync.records);
  now += 600001; repo = restart();
  assert.equal((await repo.listFavorites()).length, 301);
  assert.equal((await repo.listFollowing()).length, 101);
  assert.deepEqual(disk.favorites.slice(0, 300), original.favorites);
  assert.deepEqual(disk.memberships.slice(0, 134), original.memberships);
  assert.deepEqual(disk._chromeSync.records, pending);
  failing = false; now += 600001;
  await repo.getPreferences();
  assert.equal(remote[syncKey("s", "openArxivLinksInNewTab")].value, true);
  assert.ok(Object.keys(remote).every(key => JSON.parse(key.slice("xivary.sync:".length))[0] === "s"));
});

test("known unknown-version records never become an empty successful remote state", () => {
  assert.throws(() => validateRecord(syncKey("s", "openArxivLinksInNewTab"), {
    v: 999, rev: [1, "device"], value: true, deleted: null,
  }), /Unsupported/);
  const state = capacityFixture();
  state.schemaVersion = 999;
  assert.throws(() => prepareState(state), /Unsupported/);
});

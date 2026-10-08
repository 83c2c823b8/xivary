import test from "node:test";
import assert from "node:assert/strict";
import { getBrowserApi, usesChromeSync } from "../extension/src/platform/browser-api.js";
import { BrowserLocalStorage, ChromeLocalStorage, BrowserSyncStorage, STORAGE_KEY, SYNC_ALARM } from "../extension/src/lib/storage.js";
import { RepositoryClient } from "../extension/src/repository/repository-client.js";
import { syncKey } from "../extension/src/repository/sync-model.js";

test("platform chooses browser Promise APIs ahead of the chrome compatibility namespace", () => {
  const native = { runtime: {} }, compatibility = { runtime: {} };
  assert.equal(getBrowserApi({ browser: native, chrome: compatibility }), native);
  assert.equal(getBrowserApi({ chrome: compatibility }), compatibility);
  assert.throws(() => getBrowserApi({}), /extension context/);
  assert.equal(ChromeLocalStorage, BrowserLocalStorage);
});

test("Chrome package enables sync; Firefox event-page package does not opt into Firefox Sync", () => {
  assert.equal(usesChromeSync({ runtime: { getManifest: () => ({ background: { service_worker: "entry.js" } }) } }), true);
  assert.equal(usesChromeSync({ runtime: { getManifest: () => ({ background: { scripts: ["entry.js"] }, browser_specific_settings: { gecko: { id: "xivary" } } }) } }), false);
});

test("sync transport preserves API receivers, filters local events and never postpones earlier alarms", async () => {
  let handler, alarm, created = 0;
  const area = {
    async get(keys) { assert.equal(this, area); assert.equal(keys, null); return { test: 1 }; },
    async set(values) { assert.equal(this, area); assert.deepEqual(values, { test: 2 }); },
  };
  const alarms = {
    async get(name) { assert.equal(this, alarms); assert.equal(name, SYNC_ALARM); return alarm; },
    create(name, options) { assert.equal(this, alarms); assert.equal(name, SYNC_ALARM); alarm = { scheduledTime: options.when }; created++; },
  };
  const transport = new BrowserSyncStorage({ storage: { sync: area, onChanged: { addListener: fn => { handler = fn; } } }, alarms });
  assert.deepEqual(await transport.read(), { test: 1 }); await transport.write({ test: 2 });
  let events = 0; transport.subscribe(() => events++);
  handler({}, "local"); handler({}, "sync"); assert.equal(events, 1);
  await transport.schedule(Date.now() + 120000); await transport.schedule(Date.now() + 240000);
  assert.equal(created, 1);
  await transport.schedule(Date.now() + 60000); assert.equal(created, 2);
  area.set = async () => { throw new Error("Sync quota"); };
  await assert.rejects(transport.write({}), /Sync quota/);
});

test("actual Chrome background wires sync events, alarms, startup and repository RPC", async t => {
  let local = {}, synced = {}, alarm, messageHandler, storageHandler, alarmHandler, startupHandler;
  const descriptors = ["chrome", "browser"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => { for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  const runtime = {
    id: "test-sync-extension", getManifest: () => ({ background: { service_worker: "entry.js" } }),
    onMessage: { addListener: fn => { messageHandler = fn; } },
    onStartup: { addListener: fn => { startupHandler = fn; } },
    sendMessage(message) { return new Promise(resolve => messageHandler(message, { id: this.id }, resolve)); },
  };
  const api = { runtime, storage: {
    local: {
      async get() { assert.equal(typeof storageHandler, "function"); return structuredClone(local); },
      async set(values) { local = structuredClone(values); },
    },
    sync: { async get() { return structuredClone(synced); }, async set(values) { Object.assign(synced, structuredClone(values)); } },
    onChanged: { addListener: fn => { storageHandler = fn; } },
  }, alarms: {
    async get() { return alarm; }, create(name, { when }) { alarm = { name, scheduledTime: when }; },
    onAlarm: { addListener: fn => { alarmHandler = fn; } },
  } };
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: api });
  Object.defineProperty(globalThis, "browser", { configurable: true, value: undefined });
  await import("../extension/src/background/service-worker.js?sync-integration");
  const client = new RepositoryClient(runtime);
  await client.savePaper({ arxivId: "2401.00001", title: "Synced title", authors: ["Alex Kim"] });
  assert.equal(local[STORAGE_KEY].favorites.length, 1);
  assert.ok(alarm);
  // Simulate a later alarm wake-up without sleeping or changing application code.
  local[STORAGE_KEY]._chromeSync.retryAt = 0;
  alarmHandler({ name: SYNC_ALARM }); await client.listFavorites();
  assert.equal(synced[syncKey("p", "2401.00001")], undefined);
  assert.ok(Object.keys(synced).every(key => key === syncKey("s", "openArxivLinksInNewTab") || key === syncKey("s", "organizeFollowedAuthorsIntoCollections") || key === syncKey("s", "openAuthorResultsInNewTab") || key === syncKey("s", "openXivaryFromToolbarInNewTab")));
  const key = syncKey("s", "openArxivLinksInNewTab");
  const oldValue = synced[key];
  synced[key] = { v: 1, rev: [100, "remote"], value: true, deleted: null };
  storageHandler({ [key]: { oldValue, newValue: synced[key] } }, "sync");
  assert.equal((await client.getPreferences()).openArxivLinksInNewTab, true);
  startupHandler(); await client.listFavorites();
  assert.equal(local[STORAGE_KEY].schemaVersion, 5);
  assert.equal(local[STORAGE_KEY]._chromeSync.counter, 100);
});

for (const namespace of ["chrome", "browser"]) {
  test(`${namespace} background starts with shared messaging, storage receivers, and rejected promises`, async t => {
    let values = {};
    const area = {
      async get(key) { assert.equal(this, area); assert.equal(key, STORAGE_KEY); return structuredClone(values); },
      async set(update) { assert.equal(this, area); values = structuredClone(update); },
    };
    let handler;
    const runtime = {
      id: "test-extension",
      onMessage: { addListener(listener) { assert.equal(handler, undefined); handler = listener; } },
      sendMessage(message) {
        assert.equal(this, runtime);
        return new Promise(resolve => {
          assert.equal(handler(message, { id: this.id }, resolve), true);
        });
      },
    };
    const descriptors = ["browser", "chrome"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
    t.after(() => {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    });
    for (const key of ["browser", "chrome"]) Object.defineProperty(globalThis, key, { configurable: true, value: undefined });
    Object.defineProperty(globalThis, namespace, { configurable: true, value: { runtime, storage: { local: area } } });
    await import(`../extension/src/background/service-worker.js?platform-test=${namespace}`);
    assert.equal(typeof handler, "function");
    const client = new RepositoryClient();
    await client.savePaper({ arxivId: "2401.00001", title: "Portable paper", authors: ["Alex Kim"] });
    await client.followAuthor({ displayName: "Alex Kim" });
    assert.equal(values[STORAGE_KEY].schemaVersion, 5);
    assert.equal((await client.listFavorites()).length, 1);
    assert.equal((await client.listFollowing()).length, 1);
    await assert.rejects(client.savePaper({}), /arXiv ID/);
    runtime.sendMessage = async () => { throw new Error("Message channel closed"); };
    await assert.rejects(client.listFavorites(), /Message channel closed/);
    area.set = async () => { throw new Error("Storage quota"); };
    await assert.rejects(new BrowserLocalStorage().write({}), /Storage quota/);
  });
}

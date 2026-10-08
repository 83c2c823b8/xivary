import { BrowserLocalStorage, BrowserSyncStorage, SYNC_ALARM } from "../lib/storage.js";
import { getBrowserApi, usesChromeSync } from "../platform/browser-api.js";
import { LocalRepository } from "../repository/local-repository.js";
import { SyncStorage } from "../repository/sync-storage.js";
import { createRepositoryHandler } from "./repository-handler.js";
import { createAuthorNavigationHandler } from "./author-navigation.js";

// Shared entry point: Chromium service worker or Firefox nonpersistent event page.
const api = getBrowserApi();
const transport = usesChromeSync(api) ? new BrowserSyncStorage(api) : null;
const storage = transport ? new SyncStorage(new BrowserLocalStorage(), transport) : new BrowserLocalStorage();
const repository = new LocalRepository(storage);
const { runtime } = api;
const repositoryHandler = createRepositoryHandler(repository, runtime.id);
const authorNavigationHandler = createAuthorNavigationHandler(api);
runtime.onMessage.addListener((...args) => repositoryHandler(...args) || authorNavigationHandler(...args));

if (transport) {
  const reconcile = () => repository.run(() => {}).catch(error => console.warn("Xivary library initialization:", error.message));
  // Register wake-up listeners synchronously before starting asynchronous work.
  transport.subscribe(changes => { if (storage.observe(changes)) void reconcile(); });
  api.alarms.onAlarm.addListener(alarm => { if (alarm.name === SYNC_ALARM) void reconcile(); });
  runtime.onStartup.addListener(() => void reconcile());
  void reconcile();
}

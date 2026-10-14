import { BrowserLocalStorage, BrowserSyncStorage, SYNC_ALARM } from "../lib/storage.js";
import { getBrowserApi, usesChromeSync } from "../platform/browser-api.js";
import { OfflineRepository } from "../repository/offline-repository.js";
import { LocalRepository } from "../repository/local-repository.js";
import { SyncStorage } from "../repository/sync-storage.js";
import { createRepositoryHandler } from "./repository-handler.js";
import { createAuthorNavigationHandler } from "./author-navigation.js";
import { createTabNavigationHandler } from "./tab-navigation.js";
import { PREFERENCES_CHANGED_CHANNEL } from "../repository/repository-client.js";
import { ArxivScheduler } from '../services/arxiv-scheduler.js';
import { bindArxivRequests } from './arxiv-requests.js';

// Shared entry point: Chromium service worker or Firefox nonpersistent event page.
const api = getBrowserApi();
const transport = usesChromeSync(api) ? new BrowserSyncStorage(api) : null;
const storage = transport ? new SyncStorage(new BrowserLocalStorage(), transport) : new BrowserLocalStorage();
const repository = new LocalRepository(storage);
const { runtime } = api;
repository.offline = new OfflineRepository({ changed: async () => {
  const message = { channel: "xivary:offline-changed:v1" };
  const pages = runtime.sendMessage(message).catch(() => {});
  // runtime.sendMessage reaches extension pages; content scripts require tabs.sendMessage.
  const tabs = await api.tabs.query({ url: "https://arxiv.org/abs/*" }).catch(() => []);
  await Promise.allSettled([pages, ...tabs.map(tab => api.tabs.sendMessage(tab.id, message))]);
} });
repository.openOfflineTab = id => api.tabs.create({ url: runtime.getURL(`src/offline/read.html?id=${encodeURIComponent(id)}`) }).then(() => null);
bindArxivRequests(runtime, new ArxivScheduler({
  readState: () => repository.getArxivRequestState(),
  writeState: state => repository.setArxivRequestState(state),
}));
const repositoryHandler = createRepositoryHandler(repository, runtime.id,
  () => runtime.sendMessage({ channel: PREFERENCES_CHANGED_CHANNEL }),
  () => runtime.sendMessage({ channel: 'xivary:feed-changed:v1' }));
const authorNavigationHandler = createAuthorNavigationHandler(api, repository);
const tabNavigationHandler = createTabNavigationHandler(api, repository);
runtime.onMessage.addListener((...args) => repositoryHandler(...args) || authorNavigationHandler(...args) || tabNavigationHandler(...args));

if (transport) {
  const reconcile = () => repository.run(() => {}).catch(error => console.warn("Xivary library initialization:", error.message));
  // Register wake-up listeners synchronously before starting asynchronous work.
  transport.subscribe(changes => { if (storage.observe(changes)) void reconcile(); });
  api.alarms.onAlarm.addListener(alarm => { if (alarm.name === SYNC_ALARM) void reconcile(); });
  runtime.onStartup.addListener(() => void reconcile());
  void reconcile();
}

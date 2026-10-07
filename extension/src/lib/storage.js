import { getBrowserApi } from "../platform/browser-api.js";

export const STORAGE_KEY = "arxivResearchLibrary";

/** The only adapter allowed to access the browser's local storage area. */
export class BrowserLocalStorage {
  constructor(area = getBrowserApi().storage.local) {
    this.area = area;
  }

  async read() {
    const values = await this.area.get(STORAGE_KEY);
    return values[STORAGE_KEY];
  }

  async write(state) {
    await this.area.set({ [STORAGE_KEY]: state });
  }
}

// Preserve the existing adapter export for consumers and regression tests.
export { BrowserLocalStorage as ChromeLocalStorage };

export const SYNC_ALARM = "xivary-sync-pending";

/** Sync transport only. Record ownership/merging belongs to the repository. */
export class BrowserSyncStorage {
  constructor(api = getBrowserApi()) {
    this.api = api;
    this.area = api.storage.sync;
    this.limits = this.area;
  }
  read() { return this.area.get(null); }
  write(records) { return this.area.set(records); }
  subscribe(listener) {
    this.api.storage.onChanged.addListener((changes, area) => {
      if (area === "sync") listener(changes);
    });
  }
  async schedule(when) {
    const existing = await this.api.alarms.get(SYNC_ALARM);
    // Never postpone an earlier retry because more local operations arrived.
    if (!existing || existing.scheduledTime > when) {
      await this.api.alarms.create(SYNC_ALARM, { when: Math.max(when, Date.now() + 60000) });
    }
  }
}

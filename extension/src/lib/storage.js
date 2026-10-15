import { MigrationRecovery } from '../repository/migration-recovery.js';
import { getBrowserApi } from "../platform/browser-api.js";

export const STORAGE_KEY = "arxivResearchLibrary";

/** The only adapter allowed to access the browser's local storage area. */
export class BrowserLocalStorage {
  constructor(area = getBrowserApi().storage.local, recovery = new MigrationRecovery()) {
    this.area = area;
    this.recovery = recovery;
  }

  async read() {
    const values = await this.area.get(STORAGE_KEY);
    return values[STORAGE_KEY];
  }

  async write(state) {
    await this.area.set({ [STORAGE_KEY]: state });
  }

  async readLibrarySelection() {
    return (await this.area.get("xivary:library-selection"))["xivary:library-selection"];
  }

  async writeLibrarySelection(value) {
    await this.area.set({ "xivary:library-selection": value });
  }

  async readFollowingSelection() {
    return (await this.area.get("xivary:following-selection"))["xivary:following-selection"];
  }

  async writeFollowingSelection(value) {
    await this.area.set({ "xivary:following-selection": value });
  }

  async readMigrationBackup(from, to) {
    const key = `xivary:local-migration:${from}:${to}`;
    return (await this.area.get(key))[key] ?? await this.recovery.get(key);
  }

  async backupMigration(journal) {
    const key = `xivary:local-migration:${journal.from}:${journal.to}`;
    const existing = await this.readMigrationBackup(journal.from, journal.to);
    if (existing) {
      if (existing.format !== journal.format || existing.version !== journal.version || JSON.stringify(existing.source) !== JSON.stringify(journal.source)) {
        throw new Error('Migration recovery snapshot conflicts with stored data. Both were retained; no migration was applied.');
      }
      return;
    }
    try { await this.area.set({ [key]: journal }); }
    catch (error) {
      if (error.name !== 'QuotaExceededError' && !/QUOTA_BYTES|quota.*exceeded/i.test(error.message)) throw error;
      // Avoid doubling a large Library in Chrome's small local-area quota.
      // The IDB transaction must complete before the active envelope can advance.
      try { await this.recovery.put(key, journal); }
      catch (recoveryError) { throw new Error(`${error.message}; recovery snapshot failed: ${recoveryError.message}`); }
    }
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

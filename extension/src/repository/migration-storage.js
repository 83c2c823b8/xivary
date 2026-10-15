import { prepareState, validateCurrentState, STORAGE_SCHEMA_VERSION } from './local-schema.js';

const queues = new WeakMap();
const LOCK = 'xivary:local-repository';
/** Cross-context lock in browsers; deterministic shared-adapter queue in fixtures.
 * Held for the entire repository read/modify/write, including Sync bookkeeping.
 */
export function withStorageLock(storage, operation) {
  if (globalThis.navigator?.locks?.request) return navigator.locks.request(LOCK, operation);
  const identity = storage.migrationLockIdentity;
  const previous = queues.get(identity) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  queues.set(identity, next.catch(() => {}));
  return next;
}
export function migratingStorage(storage, clock) {
  return storage.initializesLocalStorage ? storage : new MigrationStorage(storage, clock);
}
export class MigrationStorage {
  constructor(raw, clock = () => new Date().toISOString()) {
    this.raw = raw; this.clock = clock; this.initializesLocalStorage = true;
    this.migrationLockIdentity = raw.area || raw.migrationLockIdentity || raw;
  }
  async read() {
    const stored = await this.raw.read();
    if (stored?.schemaVersion === STORAGE_SCHEMA_VERSION) return validateCurrentState(structuredClone(stored));
    if(stored!==undefined && (!stored || !Number.isInteger(stored.schemaVersion) || stored.schemaVersion<1 || stored.schemaVersion>=STORAGE_SCHEMA_VERSION))throw new Error('Unsupported or damaged library data. Existing data was left unchanged.');
    let source = stored;
    const staged = stored?._storageMigrationJournal;
    if (staged) {
      if(staged.format!=='xivary-local-migration' || staged.version!==1 || staged.to!==STORAGE_SCHEMA_VERSION || staged.from!==stored.schemaVersion) throw new Error('Unsupported migration journal. Existing data was left unchanged.');
      const withoutJournal=structuredClone(stored);delete withoutJournal._storageMigrationJournal;
      if(JSON.stringify(withoutJournal)!==JSON.stringify(staged.source))throw new Error('Data changed during migration. Existing data and the recovery snapshot were retained.');
      source=staged.source;
    }
    const existing = source && this.raw.readMigrationBackup ? await this.raw.readMigrationBackup(source.schemaVersion, STORAGE_SCHEMA_VERSION) : null;
    if(existing && (existing.format!=='xivary-local-migration' || existing.version!==1 || existing.from!==source.schemaVersion || existing.to!==STORAGE_SCHEMA_VERSION || typeof existing.createdAt!=='string' || !Number.isFinite(Date.parse(existing.createdAt))))throw new Error('Unsupported migration recovery snapshot. Existing data was left unchanged.');
    const migrationTime = staged?.createdAt || existing?.createdAt || this.clock();
    const candidate = prepareState(source, migrationTime); // All validation precedes backup/active writes.
    if(existing && JSON.stringify(existing.source)!==JSON.stringify(source))throw new Error('Migration recovery snapshot conflicts with stored data. Both were retained.');
    if (source === undefined) { await this.raw.write(candidate); return candidate; }
    const journal = staged || existing || { format:'xivary-local-migration',version:1,from:source.schemaVersion,to:STORAGE_SCHEMA_VERSION,createdAt:migrationTime,source:structuredClone(source) };
    if (this.raw.backupMigration) {
      await this.raw.backupMigration(journal); // Durable sidecar first; active key remains unchanged.
    } else {
      // Single-key adapters retain the exact source in an in-band recovery journal.
      // A crash here leaves old records/version intact; the next read retries.
      if (!staged) await this.raw.write({...structuredClone(source),_storageMigrationJournal:journal});
      candidate._storageMigrationJournal=journal;
    }
    await this.raw.write(candidate); // One active envelope, including its completed schema version.
    return candidate;
  }
  async write(state) { await this.raw.write(validateCurrentState(structuredClone(state))); }
}

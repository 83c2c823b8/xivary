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
    let resume = false, interrupted = false;
    if (staged) {
      if(staged.format!=='xivary-local-migration' || staged.version!==1 || !Number.isInteger(staged.from) || !Number.isInteger(staged.to)
          || staged.from<1 || staged.to<=staged.from || staged.to>STORAGE_SCHEMA_VERSION || !staged.source
          || staged.source.schemaVersion!==staged.from || typeof staged.createdAt!=='string' || !Number.isFinite(Date.parse(staged.createdAt))) throw new Error('Unsupported migration journal. Existing data was left unchanged.');
      interrupted = staged.from===stored.schemaVersion;
      const completed = staged.to===stored.schemaVersion && staged.to<STORAGE_SCHEMA_VERSION;
      if (!interrupted && !completed) throw new Error('Unsupported migration journal. Existing data was left unchanged.');
      if (interrupted) {
        const body=value=>{const copy=structuredClone(value);delete copy._storageMigrationJournal;return copy;};
        if(JSON.stringify(body(stored))!==JSON.stringify(body(staged.source)))throw new Error('Data changed during migration. Existing data and the recovery snapshot were retained.');
        resume = staged.to===STORAGE_SCHEMA_VERSION;
        if (resume) source=staged.source;
      }
      // Older completed/pending journals remain in the exact source snapshot of
      // the next upgrade. Never reuse their old target as the new completion marker.
    }
    const existing = source && this.raw.readMigrationBackup ? await this.raw.readMigrationBackup(source.schemaVersion, STORAGE_SCHEMA_VERSION) : null;
    if(existing && (existing.format!=='xivary-local-migration' || existing.version!==1 || existing.from!==source.schemaVersion || existing.to!==STORAGE_SCHEMA_VERSION || typeof existing.createdAt!=='string' || !Number.isFinite(Date.parse(existing.createdAt))))throw new Error('Unsupported migration recovery snapshot. Existing data was left unchanged.');
    const migrationTime = (interrupted ? staged.createdAt : null) || existing?.createdAt || this.clock();
    const candidate = prepareState(source, migrationTime); // All validation precedes backup/active writes.
    if(existing && JSON.stringify(existing.source)!==JSON.stringify(source))throw new Error('Migration recovery snapshot conflicts with stored data. Both were retained.');
    if (source === undefined) { await this.raw.write(candidate); return candidate; }
    const journal = (resume ? staged : null) || existing || { format:'xivary-local-migration',version:1,from:source.schemaVersion,to:STORAGE_SCHEMA_VERSION,createdAt:migrationTime,source:structuredClone(source) };
    if (this.raw.backupMigration) {
      await this.raw.backupMigration(journal); // Durable sidecar first; active key remains unchanged.
      delete candidate._storageMigrationJournal; // Prior journals remain recoverable in the snapshot.
    } else {
      // Single-key adapters retain the exact source in an in-band recovery journal.
      // A crash here leaves old records/version intact; the next read retries.
      if (!resume) await this.raw.write({...structuredClone(source),_storageMigrationJournal:journal});
      candidate._storageMigrationJournal=journal;
    }
    await this.raw.write(candidate); // One active envelope, including its completed schema version.
    return candidate;
  }
  readFollowingSelection() { return this.raw.readFollowingSelection?.(); }
  writeFollowingSelection(value) { return this.raw.writeFollowingSelection(value); }
  readLibrarySelection() { return this.raw.readLibrarySelection?.(); }
  writeLibrarySelection(value) { return this.raw.writeLibrarySelection(value); }
  async write(state) { await this.raw.write(validateCurrentState(structuredClone(state))); }
}

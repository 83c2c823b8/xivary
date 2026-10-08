import { prepareState } from "./local-repository.js";
import { SYNC_VERSION, equal, projectState, recordChanges, validateRecord,
  mergeRecord, materialize, assertQuota, PREFERENCES, syncKey, isPreferenceKey } from "./sync-model.js";

const RETRY_MS = 5 * 60 * 1000;
const WRITE_INTERVAL_MS = 2100; // Below both documented write-rate ceilings.

/** Used only by the background LocalRepository, under its existing queue.
 * The replica and local library commit in ONE local envelope before publishing.
 * No domain operation, runtime RPC, or UI knows about sync storage.
 */
export class SyncStorage {
  constructor(local, transport, { now = () => Date.now(), makeId = () => crypto.randomUUID() } = {}) {
    this.local = local;
    this.transport = transport;
    this.now = now;
    this.makeId = makeId;
    this.observations = [];
    this.remote = null;
  }

  observe(changes) {
    let observed = false;
    for (const [key, change] of Object.entries(changes)) {
      if (!isPreferenceKey(key)) continue;
      observed = true;
      // oldValue matters when a delayed transport write replaces a newer value.
      for (const record of [change.oldValue, change.newValue]) {
        if (record !== undefined) this.observations.push([key, structuredClone(record)]);
      }
    }
    return observed;
  }

  async schedule(when) {
    try { await this.transport.schedule(when); }
    catch (error) { console.warn("Xivary sync retry could not be scheduled:", error.message); }
  }

  async read() {
    const stored = await this.local.read();
    let state = prepareState(stored, new Date(this.now()).toISOString());
    this.remote = null;
    const observations = this.observations.splice(0);
    try {
      if (state._chromeSync === undefined) {
        state._chromeSync = {
          version: SYNC_VERSION, id: this.makeId(), counter: 0, records: {}, bootstrapped: false,
          retryAt: 0, lastError: null, bootstrapSnapshot: { settings: Object.fromEntries(PREFERENCES.map(name => [name, state.settings[name]])) },
        };
        recordChanges(state._chromeSync, {}, projectState(state), true);
      }
      this.validateReplica(state._chromeSync);
      // Read before writing: failed/unknown remote state never becomes an empty
      // snapshot that could overwrite another installation's data.
      let remote;
      try { remote = await this.transport.read(); }
      catch (error) { await this.schedule(this.now() + RETRY_MS); throw error; }
      const incoming = [...Object.entries(remote).filter(([key]) => isPreferenceKey(key)), ...observations];
      for (const [key, record] of incoming) validateRecord(key, record);
      const replica = structuredClone(state._chromeSync);
      // Remote intent beats overlapping legacy/default seeds, including another
      // device's revision-zero bootstrap. Actual offline edits have revision >0.
      if (!replica.bootstrapped) {
        for (const [key] of incoming) if (replica.records[key]?.rev[0] === 0) delete replica.records[key];
      }
      for (const [key, record] of incoming) {
        replica.records[key] = mergeRecord(replica.records[key], record);
        replica.counter = Math.max(replica.counter, record.rev[0], record.deleted?.[0] ?? 0);
      }
      // An older v1 replica can already be bootstrapped without preference
      // registers. Seed only keys absent on BOTH sides, after validating/merging
      // remote intent. Existing records keep their revisions and always win.
      const missingPreferences = Object.fromEntries(PREFERENCES
        .filter(name => !Object.hasOwn(replica.records, syncKey("s", name)))
        .map(name => [syncKey("s", name), state.settings[name]]));
      recordChanges(replica, {}, missingPreferences, true);
      replica.bootstrapped = true;
      const merged = materialize(state, replica.records);
      merged._chromeSync = replica;
      state = prepareState(merged, new Date(this.now()).toISOString());
      this.remote = remote;
      delete state._chromeSyncError;
    } catch (error) {
      state._chromeSyncError = error.message;
      // Keep observations available on a later attempt if the transport read
      // failed. Invalid records also remain blocked until the source is repaired.
      if (!observations.some(([key, record]) => {
        try { validateRecord(key, record); return false; } catch { return true; }
      })) this.observations.unshift(...observations);
    }
    if (!equal(state, stored)) {
      await this.schedule(this.now() + 60000);
      await this.local.write(state);
    }
    await this.flush(state);
    this.before = structuredClone(state);
    return state;
  }

  validateReplica(replica) {
    if (replica?.version !== SYNC_VERSION || !/^[a-zA-Z0-9-]{1,64}$/.test(replica.id)
        || !Number.isSafeInteger(replica.counter) || replica.counter < 0 || replica.counter === Number.MAX_SAFE_INTEGER
        || !replica.records || typeof replica.records !== "object" || Array.isArray(replica.records)) throw new Error("Unsupported or damaged local sync replica.");
    for (const [key, record] of Object.entries(replica.records)) {
      // Old library records remain inert local bookkeeping, never validated,
      // merged, materialized or published by the settings-only policy.
      if (!isPreferenceKey(key)) continue;
      validateRecord(key, record);
      if (record.rev[0] > replica.counter) throw new Error("Damaged local sync clock.");
    }
  }

  async write(input) {
    const state = structuredClone(input);
    try {
      this.validateReplica(state._chromeSync);
      recordChanges(state._chromeSync, projectState(this.before), projectState(state));
    } catch (error) {
      // Unknown local representation is preserved verbatim; don't fabricate a
      // new replica or export an untracked operation over it.
      state._chromeSyncError = error.message;
      this.remote = null;
    }
    await this.schedule(this.now() + 60000);
    await this.local.write(state); // Only this failure rejects the domain write.
    await this.flush(state);
    this.before = structuredClone(state);
  }

  async flush(state) {
    const replica = state._chromeSync;
    if (!this.remote) return;
    const update = Object.fromEntries(Object.entries(replica.records).filter(([key, record]) => isPreferenceKey(key) && !equal(this.remote[key], record)));
    if (!Object.keys(update).length) {
      if (replica.lastError !== null) {
        replica.lastError = null;
        try { await this.local.write(state); }
        catch (error) { console.warn("Xivary sync bookkeeping remains pending:", error.message); }
      }
      return;
    }
    if (replica.retryAt > this.now()) {
      await this.schedule(replica.retryAt);
      return;
    }
    // Schedule before publishing, so worker suspension after a successful set
    // but before bookkeeping is harmless (desired-state replay is idempotent).
    await this.schedule(this.now() + RETRY_MS);
    try {
      assertQuota({ ...this.remote, ...update }, this.transport.limits);
      await this.transport.write(update);
      this.remote = { ...this.remote, ...structuredClone(update) };
      replica.retryAt = this.now() + WRITE_INTERVAL_MS;
      replica.lastError = null;
    } catch (error) {
      replica.retryAt = this.now() + RETRY_MS;
      replica.lastError = error.message;
    }
    // Library+pending intent are already durable. Failure of this bookkeeping
    // write must not report a successful local save as failed to the UI.
    try { await this.local.write(state); }
    catch (error) { console.warn("Xivary sync bookkeeping remains pending:", error.message); }
  }
}

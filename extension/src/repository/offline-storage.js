// Independent extension-origin database. PDF bytes never enter browser storage or Sync.
export const OFFLINE_DATABASE = "xivary-offline";
export const OFFLINE_DATABASE_VERSION = 2;

export function upgradeOfflineDatabase(db, transaction, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore("copies", { keyPath: "arxivId" });
    db.createObjectStore("pdfs");
  }
  if (oldVersion < 2) transaction.objectStore("copies").createIndex("savedAt", "savedAt");
}

export class OfflineStorage {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; }
  open() {
    if (!this.indexedDB) return Promise.reject(new Error("Offline storage is unavailable."));
    return new Promise((resolve, reject) => {
      let blocked = false;
      const request = this.indexedDB.open(OFFLINE_DATABASE, OFFLINE_DATABASE_VERSION);
      request.onupgradeneeded = event => upgradeOfflineDatabase(request.result, request.transaction, event.oldVersion);
      request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(new Error("Close other Xivary tabs and retry the storage upgrade.")); };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }
  async transaction(stores, mode, operation) {
    const db = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let result;
        tx.oncomplete = () => resolve(result?.result);
        // Wait for abort: transaction.error preserves QuotaExceededError here.
        tx.onabort = () => reject(tx.error || new Error("Offline storage operation failed."));
        try { result = operation(tx); } catch (error) { tx.abort(); reject(error); }
      });
    } finally { db.close(); }
  }
  list() { return this.transaction(["copies"], "readonly", tx => tx.objectStore("copies").getAll()); }
  get(id) { return this.transaction(["copies"], "readonly", tx => tx.objectStore("copies").get(id)); }
  getPdf(id) { return this.transaction(["pdfs"], "readonly", tx => tx.objectStore("pdfs").get(id)); }
  put(copy, blob) {
    return this.transaction(["copies", "pdfs"], "readwrite", tx => {
      tx.objectStore("copies").put(copy); tx.objectStore("pdfs").put(blob, copy.arxivId);
    });
  }
  remove(id) {
    return this.transaction(["copies", "pdfs"], "readwrite", tx => {
      tx.objectStore("copies").delete(id); tx.objectStore("pdfs").delete(id);
    });
  }
  // Metadata/version and bytes are read in the same snapshot, even during replacement.
  async read(id) {
    const db = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(["copies", "pdfs"], "readonly");
        const copy = tx.objectStore("copies").get(id), pdf = tx.objectStore("pdfs").get(id);
        tx.oncomplete = () => resolve({ copy: copy.result, blob: pdf.result });
        tx.onabort = () => reject(tx.error || new Error("Unable to read the offline PDF."));
      });
    } finally { db.close(); }
  }
}

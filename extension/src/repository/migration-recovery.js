// Separate recovery database; never opens or modifies xivary-offline/PDF stores.
export const RECOVERY_DATABASE = 'xivary-storage-recovery';
export const RECOVERY_DATABASE_VERSION = 1;
export class MigrationRecovery {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; }
  async open() {
    if (!this.indexedDB) throw new Error('Migration recovery storage is unavailable. Existing data was left unchanged.');
    return new Promise((resolve,reject)=>{
      const request=this.indexedDB.open(RECOVERY_DATABASE,RECOVERY_DATABASE_VERSION);let blocked=false;
      request.onupgradeneeded=event=>{if(event.oldVersion<1)request.result.createObjectStore('snapshots');};
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>{blocked=true;reject(new Error('Close other Xivary views and retry recovery storage initialization.'));};
      request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return;}db.onversionchange=()=>db.close();resolve(db);};
    });
  }
  async get(key) {
    if (!this.indexedDB) return undefined; // In-memory fixtures use the local sidecar.
    const db=await this.open();
    try {return await new Promise((resolve,reject)=>{
      const tx=db.transaction('snapshots','readonly'),request=tx.objectStore('snapshots').get(key);
      tx.oncomplete=()=>resolve(request.result);tx.onabort=()=>reject(tx.error || new Error('Recovery read interrupted.'));
    });}finally{db.close();}
  }
  async put(key,journal) {
    const db=await this.open();
    try {await new Promise((resolve,reject)=>{
      const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots'),request=store.get(key);
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error || new Error('Recovery snapshot conflict or interrupted write.'));
      request.onsuccess=()=>{
        if(request.result && JSON.stringify(request.result.source)!==JSON.stringify(journal.source)){tx.abort();return;}
        if(!request.result)store.put(journal,key);
      };
    });}finally{db.close();}
  }
}

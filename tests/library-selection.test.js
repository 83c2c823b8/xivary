import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserLocalStorage, STORAGE_KEY } from '../extension/src/lib/storage.js';
import { LocalRepository, prepareState } from '../extension/src/repository/local-repository.js';
import { RepositoryClient } from '../extension/src/repository/repository-client.js';
import { createRepositoryHandler } from '../extension/src/background/repository-handler.js';
import { explicitLibraryCollection } from '../extension/src/domain/library-selection.js';
const key='xivary:library-selection',now='2026-10-15T00:00:00Z';
let profileId=0;
function fixture(initial) {
  const prefix=++profileId;
  let values=structuredClone(initial||{}),writes=0,fail=false,serial=0;
  const area={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>Object.hasOwn(values,k)).map(k=>[k,structuredClone(values[k])])),set:async patch=>{if(fail)throw Error('quota');values={...values,...structuredClone(patch)};writes++;}};
  const storage=new BrowserLocalStorage(area),repo=new LocalRepository(storage,()=>now,()=>`selection-${prefix}-${++serial}`);
  const handler=createRepositoryHandler(repo,'test'),client=new RepositoryClient({sendMessage:message=>new Promise(resolve=>handler(message,{id:'test'},resolve))});
  return {client,repo,storage,values:()=>structuredClone(values),writes:()=>writes,seed:value=>{values[key]=value;},fail:value=>{fail=value;}};
}
test('selection is a stable-ID local preference: restore, rename, restart, All Saved and idempotent writes',async()=>{
  const f=fixture(),collection=await f.client.createPaperCollection('My collection');const owner=f.values()[STORAGE_KEY];
  assert.equal((await f.client.getPaperLibrary()).selectedCollectionId,'');
  await f.client.setLibrarySelection(collection.id);assert.deepEqual(f.values()[STORAGE_KEY],owner);
  assert.deepEqual(f.values()[key],{version:1,collectionId:collection.id});const writes=f.writes();
  await f.client.setLibrarySelection(collection.id);assert.equal(f.writes(),writes);
  assert.equal((await new LocalRepository(f.storage).getPaperLibrary()).selectedCollectionId,collection.id);
  await f.client.renamePaperCollection(collection.id,'Renamed — 猫');assert.equal((await f.client.getPaperLibrary()).selectedCollectionId,collection.id);
  await f.client.setLibrarySelection('');assert.equal((await new LocalRepository(f.storage).getPaperLibrary()).selectedCollectionId,'');
});
test('deleted, missing, malformed and future selections fall back without modifying research records',async()=>{
  const f=fixture(),collection=await f.client.createPaperCollection('Delete me');await f.client.setLibrarySelection(collection.id);
  await f.client.deletePaperCollection(collection.id);const owner=f.values()[STORAGE_KEY];
  assert.equal((await f.client.getPaperLibrary()).selectedCollectionId,'');
  for(const value of [null,{},'wrong',{version:1,collectionId:123},{version:1,collectionId:'paper-collection:missing'},{version:99,collectionId:'future'}]){
    f.seed(value);assert.equal((await f.client.getPaperLibrary()).selectedCollectionId,'');assert.deepEqual(f.values()[STORAGE_KEY],owner);
  }
  await assert.rejects(f.client.setLibrarySelection(''),/newer format/);assert.deepEqual(f.values()[key],{version:99,collectionId:'future'});
  f.seed(null);await f.client.setLibrarySelection('stale');assert.deepEqual(f.values()[key],{version:1,collectionId:''});
  await assert.rejects(f.client.setLibrarySelection(null),/Invalid/);
});
test('previous installed data needs no preference migration and failures preserve the previous selection',async()=>{
  const source=prepareState(undefined,now);source.schemaVersion=6;source.extraMetadata={keep:'unchanged'};
  const f=fixture({[STORAGE_KEY]:source});assert.equal((await f.client.getPaperLibrary()).selectedCollectionId,'');
  assert.equal(f.values()[STORAGE_KEY].schemaVersion,8);assert.deepEqual(f.values()['xivary:local-migration:6:8'].source,source);
  const collection=await f.client.createPaperCollection('Existing');await f.client.setLibrarySelection(collection.id);const before=f.values();
  f.fail(true);await assert.rejects(f.client.setLibrarySelection(''),/quota/);assert.deepEqual(f.values(),before);
  f.fail(false);await f.client.setLibrarySelection('');assert.equal((await f.client.getPaperLibrary()).selectedCollectionId,'');
});
test('backups exclude selection and imports preserve the destination UI preference',async()=>{
  const f=fixture(),c=await f.client.createPaperCollection('Source');await f.client.setLibrarySelection(c.id);
  const file=await f.client.exportBackup('all'),fresh=fixture();await fresh.client.importBackup([{kind:'zip',data:file.base64}]);
  assert.equal((await fresh.client.getPaperLibrary()).selectedCollectionId,'');assert.equal(fresh.values()[key],undefined);
  const own=await fresh.client.createPaperCollection('Destination');await fresh.client.setLibrarySelection(own.id);
  await fresh.client.importBackup([{kind:'zip',data:file.base64}]);assert.equal((await fresh.client.getPaperLibrary()).selectedCollectionId,own.id);
  assert.equal((await f.client.getPaperLibrary()).selectedCollectionId,c.id);
});
test('explicit collection URLs override the saved preference, including explicit All Saved',()=>{
  assert.equal(explicitLibraryCollection(''),null);assert.equal(explicitLibraryCollection('?q=not-persisted'),null);
  assert.equal(explicitLibraryCollection('?collectionId=paper-collection%3A123'),'paper-collection:123');
  assert.equal(explicitLibraryCollection('?collection=paper-collection%3A456'),'paper-collection:456');
  assert.equal(explicitLibraryCollection('?collectionId='),'');
});

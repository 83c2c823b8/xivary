import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepository,prepareState } from '../extension/src/repository/local-repository.js';
import { STORAGE_MIGRATIONS,STORAGE_SCHEMA_VERSION } from '../extension/src/repository/local-schema.js';
import { BrowserLocalStorage,STORAGE_KEY } from '../extension/src/lib/storage.js';
import { RepositoryClient } from '../extension/src/repository/repository-client.js';
import { createRepositoryHandler } from '../extension/src/background/repository-handler.js';
import { normalizeLibrarySnapshot } from '../extension/src/domain/library-snapshot.js';
import { createPaper } from '../extension/src/domain/paper.js';
import { createAuthor } from '../extension/src/domain/author.js';
import { emptyQueue } from '../extension/src/feed/queue.js';
const now='2026-10-15T00:00:00.000Z',paper=i=>createPaper({arxivId:`2610.${String(i).padStart(5,'0')}`,title:`Custom paper ${i} — 猫`,authors:['Alex Kim'],note:'User note',tags:['研究']},now);
function disk(initial) {
  let values=initial===undefined?{}:{[STORAGE_KEY]:structuredClone(initial)},activeWrites=0,backupWrites=0,failActive=false,failBackup=false;
  const area={get:async()=>structuredClone(values),set:async update=>{
    if(Object.hasOwn(update,STORAGE_KEY)){if(failActive)throw Error('active write interrupted');activeWrites++;}
    else {if(failBackup)throw Error('backup quota');backupWrites++;}
    Object.assign(values,structuredClone(update));
  }};
  const storage=new BrowserLocalStorage(area),repo=new LocalRepository(storage,()=>now);
  return {area,storage,repo,raw:()=>structuredClone(values),active:()=>structuredClone(values[STORAGE_KEY]),counts:()=>({activeWrites,backupWrites}),fail:(active,backup=false)=>{failActive=active;failBackup=backup;}};
}
function schema5() {
  const state=prepareState(undefined,now);state.schemaVersion=5;delete state.paperOrdering;
  state.favorites=[paper(3),paper(1),paper(2)];state.favorites[0].originalTitle='Original title';state.favorites[0].customTitle=state.favorites[0].title;
  const collection={id:'paper-collection:custom',name:'My Geometry',createdAt:now,updatedAt:now};state.paperCollections.push(collection);
  state.paperMemberships=state.favorites.flatMap(p=>state.paperCollections.map(c=>({arxivId:p.arxivId,collectionId:c.id,addedAt:now,updatedAt:now})));
  const author={...createAuthor({displayName:'Renée Smith'},now),alias:'My advisor / 先生',aliases:['R. Smith']};state.authors=[author];state.collections=[{id:'collection:custom',name:'Researchers',createdAt:now,updatedAt:now}];state.memberships=[{authorId:author.id,collectionId:'collection:custom',addedAt:now,updatedAt:now}];
  state.settings.lastUsedAuthorCollectionId='collection:custom';state.settings.vimMode=true;state.settings.customLatexMacros=String.raw`\Hom = \operatorname{Hom}`;
  const feed=emptyQueue();feed.followedIds=[author.id];feed.lastSuccessAt=now;feed.lastCycleAt=now;state.followingFeedCache=feed;
  state.userSortPreference='existing-local-extra';return state;
}
function owner(state) {const copy=structuredClone(state);delete copy.schemaVersion;delete copy.paperOrdering;delete copy._storageMigrationJournal;return copy;}
test('fresh initialization is durable once; completed schema checks do not rewrite state',async()=>{
  const f=disk();await f.repo.initialize();assert.equal(f.active().schemaVersion,STORAGE_SCHEMA_VERSION);assert.deepEqual(f.counts(),{activeWrites:1,backupWrites:0});
  await Promise.all([f.repo.getPaperLibrary(),f.repo.getPreferences(),new LocalRepository(f.storage).initialize()]);assert.equal(f.counts().activeWrites,1);
});
test('schema 5 upgrade preserves every owner field and derives deterministic existing visible order',async()=>{
  const before=schema5(),f=disk(before);const library=await f.repo.getPaperLibrary();
  assert.deepEqual(owner(f.active()),owner(before));assert.deepEqual(library.papers,before.favorites);
  assert.deepEqual(library.ordering.collectionIds,before.paperCollections.map(c=>c.id));assert.deepEqual(library.ordering.paperOrders,[]);
  const backup=f.raw()['xivary:local-migration:5:8'];assert.deepEqual(backup.source,before);
  await f.repo.getFollowingFeedCache();assert.deepEqual(f.active().followingFeedCache,before.followingFeedCache);
  const stable=f.active();await new LocalRepository(f.storage).initialize();assert.deepEqual(f.active(),stable);assert.deepEqual(f.counts(),{activeWrites:1,backupWrites:1});
});
test('explicit collection/manual paper order and aliases survive upgrades without renaming or moving records',async()=>{
  const before=schema5();before.paperOrdering={version:1,collectionIds:['paper-collection:custom','paper-collection:saved-papers'],paperOrders:[{collectionId:'paper-collection:custom',paperIds:before.favorites.map(p=>p.arxivId).reverse()}]};
  const f=disk(before);await f.repo.initialize();assert.deepEqual(f.active().paperOrdering,before.paperOrdering);assert.deepEqual(owner(f.active()),owner(before));
});
test('safe missing schema-5 ordering fields initialize; malformed/current incomplete records never become an empty library',async()=>{
  const partial=schema5();partial.paperOrdering={version:1,collectionIds:partial.paperCollections.map(c=>c.id).reverse()};
  const f=disk(partial);await f.repo.initialize();assert.deepEqual(f.active().paperOrdering.collectionIds,partial.paperOrdering.collectionIds);assert.deepEqual(f.active().paperOrdering.paperOrders,[]);
  for(const corrupt of [null,{...schema5(),schemaVersion:999},{...schema5(),paperOrdering:{version:1,collectionIds:null}},(()=>{const s=schema5();s.schemaVersion=6;return s;})(),(()=>{const s=schema5();s.paperMemberships[0].collectionId='missing';return s;})()]){
    const broken=disk(corrupt);await assert.rejects(broken.repo.getPaperLibrary());assert.deepEqual(broken.active(),corrupt);assert.deepEqual(broken.counts(),{activeWrites:0,backupWrites:0});
  }
});
test('backup or active write failures preserve source and recover after worker recreation, without rewriting the backup',async()=>{
  const source=schema5(),f=disk(source);f.fail(false,true);await assert.rejects(f.repo.initialize(),/backup quota/);assert.deepEqual(f.active(),source);
  f.fail(true);await assert.rejects(f.repo.initialize(),/interrupted/);assert.deepEqual(f.active(),source);assert.deepEqual(f.raw()['xivary:local-migration:5:8'].source,source);
  f.fail(false);await new LocalRepository(f.storage,()=>new Date(Date.parse(now)+3600000).toISOString()).initialize();assert.equal(f.active().schemaVersion,8);assert.equal(f.counts().backupWrites,1);
});
test('single-key adapters recover an interrupted in-band journal and use the original migration timestamp',async()=>{
  const original={schemaVersion:4,favorites:[paper(1)],authors:[],collections:[],memberships:[],authorPaperCaches:[],settings:{lastUsedAuthorCollectionId:null}};
  let state=structuredClone(original),writes=0,fail=true;
  const storage={read:async()=>structuredClone(state),write:async value=>{writes++;if(fail&&value.schemaVersion===8)throw Error('suspended');state=structuredClone(value);}};
  let ticks=0;
  await assert.rejects(new LocalRepository(storage,()=>new Date(Date.parse(now)+ticks++*1000).toISOString()).initialize(),/suspended/);assert.equal(state.schemaVersion,4);assert.deepEqual(state._storageMigrationJournal.source,original);const stamp=state._storageMigrationJournal.createdAt;assert.equal(ticks,1);
  fail=false;await new LocalRepository(storage,()=>new Date(Date.parse(now)+3600000).toISOString()).initialize();assert.equal(state.schemaVersion,8);assert.equal(state.paperCollections[0].createdAt,stamp);assert.equal(writes,3);
});
test('concurrent repository instances and clients share a migration/mutation lock and never lose or duplicate additions',async()=>{
  const f=disk(schema5()),second=new LocalRepository(new BrowserLocalStorage(f.area),()=>now);
  const clientFor=repo=>{const handler=createRepositoryHandler(repo,'test');return new RepositoryClient({sendMessage:message=>new Promise(resolve=>handler(message,{id:'test'},resolve))});};
  const a=clientFor(f.repo),b=clientFor(second);
  await Promise.all([a.initialize(),b.getPaperLibrary(),a.savePaper(paper(4)),b.savePaper(paper(5)),a.createPaperCollection('New A'),b.createPaperCollection('New B')]);
  assert.equal(f.active().favorites.length,5);assert.equal(f.active().paperCollections.length,4);assert.equal(f.counts().backupWrites,1);
});
test('exact collectionIds regression is a legacy DTO mismatch; explicit response migration preserves real records',async()=>{
  const state=schema5(),legacy={papers:state.favorites,collections:state.paperCollections,memberships:state.paperMemberships,settings:state.settings};
  assert.throws(()=>legacy.ordering.collectionIds,/Cannot read properties of undefined.*collectionIds/);
  const client=new RepositoryClient({sendMessage:async()=>({ok:true,result:legacy})});const fixed=await client.getPaperLibrary();
  assert.deepEqual(fixed.ordering.collectionIds,state.paperCollections.map(c=>c.id));assert.deepEqual(fixed.papers,legacy.papers);assert.deepEqual(legacy.ordering,undefined);
  assert.throws(()=>normalizeLibrarySnapshot({...legacy,snapshotVersion:2}),/Missing ordering/);
  assert.throws(()=>normalizeLibrarySnapshot({...legacy,memberships:[]}),/no collection membership/);
});
test('registered 1–5 upgrade chain is complete; ambiguous legacy metadata stops safely',async()=>{
  assert.deepEqual([...STORAGE_MIGRATIONS.keys()],[1,2,3,4,5,6,7]);
  const name='Alex Kim',at=now,id=index=>`arxiv-author:v1:2610.00001:${index}:alex%20kim`;
  const old={schemaVersion:1,favorites:[],following:[0,1].map(index=>({id:id(index),displayName:name,normalizedName:'alex kim',sourceArxivId:'2610.00001',sourceAuthorIndex:index,followedAt:at,updatedAt:at,alias:`Distinct alias ${index}`}))};
  const f=disk(old);await assert.rejects(f.repo.initialize(),/Conflicting legacy author metadata/);assert.deepEqual(f.active(),old);
});
test('Offline operations wait for local initialization without touching PDF stores during migration',async()=>{
  const before=schema5(),f=disk(before);let calls=0;const pdf=Object.freeze({bytes:'unchanged PDF',count:1});
  f.repo.offline={list:async()=>{calls++;assert.equal(f.active().schemaVersion,8);return pdf;}};
  f.fail(true);await assert.rejects(f.repo.getOfflineLibrary());assert.equal(calls,0);f.fail(false);
  assert.equal(await f.repo.getOfflineLibrary(),pdf);assert.equal(calls,1);assert.deepEqual(pdf,{bytes:'unchanged PDF',count:1});
});

test('local snapshot quota falls back to durable independent recovery storage before activation',async()=>{
  const source=schema5(),records=new Map();let values={[STORAGE_KEY]:structuredClone(source)},recoveries=0;
  const area={get:async()=>structuredClone(values),set:async update=>{
    if(!Object.hasOwn(update,STORAGE_KEY))throw Error('QUOTA_BYTES quota exceeded');
    assert.equal(records.size,1,'backup must be committed before schema activation');Object.assign(values,structuredClone(update));
  }};
  const recovery={get:async key=>structuredClone(records.get(key)),put:async(key,value)=>{recoveries++;records.set(key,structuredClone(value));}};
  const storage=new BrowserLocalStorage(area,recovery),repo=new LocalRepository(storage,()=>now);await repo.initialize();
  assert.equal(values[STORAGE_KEY].schemaVersion,8);assert.deepEqual(owner(values[STORAGE_KEY]),owner(source));assert.deepEqual(records.get('xivary:local-migration:5:8').source,source);
  await new LocalRepository(storage).initialize();assert.equal(recoveries,1);
});
test('failed recovery database writes leave active records and schema unchanged',async()=>{
  const source=schema5();let values={[STORAGE_KEY]:structuredClone(source)};
  const storage=new BrowserLocalStorage({get:async()=>structuredClone(values),set:async()=>{throw Error('QUOTA_BYTES quota exceeded');}}, {get:async()=>undefined,put:async()=>{throw Error('recovery disk full');}});
  await assert.rejects(new LocalRepository(storage).initialize(),/recovery disk full/);assert.deepEqual(values[STORAGE_KEY],source);
});

test('older completed and interrupted in-band journals upgrade and retry without losing either recovery source',async()=>{
  for(const completed of [false,true]) {
    const source=schema5(),old={format:'xivary-local-migration',version:1,from:5,to:6,createdAt:now,source:structuredClone(source)};
    const body=completed?prepareState(source,now):structuredClone(source);if(completed)body.schemaVersion=6;
    const initial={...body,_storageMigrationJournal:old};let active=structuredClone(initial),fail=true,writes=0;
    const storage={read:async()=>structuredClone(active),write:async state=>{writes++;if(fail&&state.schemaVersion===8)throw Error('worker stopped');active=structuredClone(state);}};
    await assert.rejects(new LocalRepository(storage,()=>now).initialize(),/worker stopped/);
    assert.deepEqual(active._storageMigrationJournal.source,initial);assert.equal(active._storageMigrationJournal.to,8);
    fail=false;await new LocalRepository(storage,()=>now).initialize();assert.equal(active.schemaVersion,8);
    assert.deepEqual(active._storageMigrationJournal.source,initial);assert.deepEqual(owner(active),owner(initial));
    const count=writes;await new LocalRepository(storage).initialize();assert.equal(writes,count);
  }
});

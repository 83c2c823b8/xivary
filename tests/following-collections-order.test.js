import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserLocalStorage, STORAGE_KEY } from '../extension/src/lib/storage.js';
import { LocalRepository, prepareState } from '../extension/src/repository/local-repository.js';
import { RepositoryClient } from '../extension/src/repository/repository-client.js';
import { createRepositoryHandler } from '../extension/src/background/repository-handler.js';
import { explicitFollowingCollection } from '../extension/src/domain/following-selection.js';
const now='2026-10-15T00:00:00Z',key='xivary:following-selection';let fixtureId=0;
function fixture(initial={}) {
  const prefix=++fixtureId;let values=structuredClone(initial),serial=0,writes=0,fail=false;
  const area={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>Object.hasOwn(values,k)).map(k=>[k,structuredClone(values[k])])),set:async patch=>{if(fail)throw Error('quota');values={...values,...structuredClone(patch)};writes++;}};
  const storage=new BrowserLocalStorage(area),repo=new LocalRepository(storage,()=>now,()=>`author-order-${prefix}-${++serial}`),handler=createRepositoryHandler(repo,'test');
  const client=new RepositoryClient({sendMessage:message=>new Promise(resolve=>handler(message,{id:'test'},resolve))});
  return {client,repo,storage,state:()=>structuredClone(values[STORAGE_KEY]),values:()=>structuredClone(values),writes:()=>writes,fail:value=>{fail=value;},seed:value=>{values[key]=value;}};
}
const ids=library=>library.collections.map(c=>c.id);
async function populated() {
  const f=fixture(),a=await f.client.createAuthorCollection('Algebra',{displayName:'Alex Kim',alias:'Advisor'}),b=await f.client.createAuthorCollection('Long collection — 猫'),c=await f.client.createAuthorCollection('Empty');
  await f.client.addAuthorToCollection({displayName:'Renée Smith',alias:'Collaborator'},a.id);
  await f.client.addAuthorToCollection({displayName:'Alex Kim'},b.id);
  return {...f,a,b,c};
}
test('collection moves change only collection-array order, preserve author order/memberships and survive worker recreation',async()=>{
  const f=await populated(),before=f.state();await f.client.moveAuthorCollection(f.c.id,f.a.id);
  assert.deepEqual(ids(await f.client.getAuthorLibrary()),[f.c.id,f.a.id,f.b.id]);
  const {collections:old,...rest}=before,{collections:next,...after}=f.state();assert.deepEqual(after,rest);
  assert.deepEqual([...next].sort((a,b)=>a.id.localeCompare(b.id)),[...old].sort((a,b)=>a.id.localeCompare(b.id)));
  await f.client.moveAuthorCollection(f.c.id,null);assert.deepEqual(ids(await new LocalRepository(f.storage).getAuthorLibrary()),[f.a.id,f.b.id,f.c.id]);
  await f.client.renameAuthorCollection(f.a.id,'Renamed');assert.deepEqual(ids(await f.client.getAuthorLibrary()),[f.a.id,f.b.id,f.c.id]);
  const d=await f.client.createAuthorCollection('New');assert.equal(ids(await f.client.getAuthorLibrary()).at(-1),d.id);
  await f.client.deleteAuthorCollection(f.c.id);assert.deepEqual(ids(await f.client.getAuthorLibrary()),[f.a.id,f.b.id,d.id]);
});
test('empty/single/no-op/invalid moves and failed writes preserve the complete collection order',async()=>{
  const empty=fixture();await empty.repo.initialize();const n=empty.writes();await assert.rejects(empty.client.moveAuthorCollection('missing',null));assert.equal(empty.writes(),n);
  const f=await populated(),count=f.writes();await f.client.moveAuthorCollection(f.a.id,f.b.id);await f.client.moveAuthorCollection(f.a.id,f.a.id);assert.equal(f.writes(),count);
  for(const [id,before]of [['',f.a.id],[f.a.id,''],['missing',null],[f.a.id,'missing'],[null,null]])await assert.rejects(f.client.moveAuthorCollection(id,before));
  const original=f.values();f.fail(true);await assert.rejects(f.client.moveAuthorCollection(f.c.id,f.a.id),/quota/);assert.deepEqual(f.values(),original);
  const single=fixture(),one=await single.client.createAuthorCollection('One'),writes=single.writes();await single.client.moveAuthorCollection(one.id,null);assert.equal(single.writes(),writes);
});
test('Following selection is independent from Library, survives rename, and handles stale/corrupt/future values safely',async()=>{
  const f=await populated(),paper=await f.client.createPaperCollection('Library');await f.client.setLibrarySelection(paper.id);
  const before=f.state();await f.client.setFollowingSelection(f.b.id);assert.deepEqual(f.state(),before);
  assert.equal((await new LocalRepository(f.storage).getAuthorLibrary()).selectedCollectionId,f.b.id);assert.equal((await f.client.getPaperLibrary()).selectedCollectionId,paper.id);
  const writes=f.writes();await f.client.setFollowingSelection(f.b.id);assert.equal(f.writes(),writes);
  await f.client.renameAuthorCollection(f.b.id,'Renamed');assert.equal((await f.client.getAuthorLibrary()).selectedCollectionId,f.b.id);
  await f.client.deleteAuthorCollection(f.b.id);assert.equal((await f.client.getAuthorLibrary()).selectedCollectionId,'');
  for(const value of [null,{},'invalid',{version:1,collectionId:123},{version:1,collectionId:'missing'},{version:99,collectionId:f.a.id}]){f.seed(value);assert.equal((await f.client.getAuthorLibrary()).selectedCollectionId,'');}
  await assert.rejects(f.client.setFollowingSelection(''),/newer format/);assert.equal(f.values()[key].version,99);
  f.seed(null);await f.client.setFollowingSelection('stale');assert.deepEqual(f.values()[key],{version:1,collectionId:''});
  await f.client.setFollowingSelection(f.a.id);const original=f.values();f.fail(true);await assert.rejects(f.client.setFollowingSelection(''),/quota/);assert.deepEqual(f.values(),original);
});
test('full/Following/collection backups preserve author-collection order and exclude UI selection',async()=>{
  const f=await populated();await f.client.moveAuthorCollection(f.c.id,f.a.id);await f.client.setFollowingSelection(f.b.id);
  const source=await f.client.getAuthorLibrary();
  for(const [category,selection]of [['all',{kind:'all'}],['following',{kind:'all'}],['following',{kind:'collection',collectionId:f.b.id}]]){
    const file=await f.client.exportBackup(category,selection),fresh=fixture();await fresh.client.importBackup([{kind:file.base64?'zip':'json',data:file.base64??file.text}]);
    const restored=await fresh.client.getAuthorLibrary();assert.deepEqual(ids(restored),selection.kind==='all'?ids(source):[f.b.id]);
    assert.equal(restored.selectedCollectionId,'');assert.equal(fresh.values()[key],undefined);
    assert.deepEqual(restored.authors,source.authors.filter(a=>restored.memberships.some(m=>m.authorId===a.id)));
  }
  const destination=await populated(),own=ids(await destination.client.getAuthorLibrary());await destination.client.setFollowingSelection(destination.a.id);
  const file=await f.client.exportBackup('following');await destination.client.importBackup([{kind:'zip',data:file.base64}]);
  assert.deepEqual(ids(await destination.client.getAuthorLibrary()),[...own,...ids(source)]);assert.equal((await destination.client.getAuthorLibrary()).selectedCollectionId,destination.a.id);
});
test('v0.5.0 schema-6 upgrade retains collection array order; selection absence needs no data transformation',async()=>{
  const f=await populated(),source=f.state();source.schemaVersion=6;source.collections.reverse();
  const upgraded=fixture({[STORAGE_KEY]:source});assert.deepEqual(ids(await upgraded.client.getAuthorLibrary()),source.collections.map(c=>c.id));
  assert.equal((await upgraded.client.getAuthorLibrary()).selectedCollectionId,'');assert.deepEqual(upgraded.values()['xivary:local-migration:6:8'].source,source);
  assert.deepEqual(upgraded.state().memberships,source.memberships);assert.deepEqual(upgraded.state().collections,source.collections);
  const count=upgraded.writes();await upgraded.client.getAuthorLibrary();assert.equal(upgraded.writes(),count);
});
test('explicit Following routes distinguish absent selection from All Following',()=>{
  assert.equal(explicitFollowingCollection(''),null);assert.equal(explicitFollowingCollection('?q=transient'),null);
  assert.equal(explicitFollowingCollection('?collectionId='),'');assert.equal(explicitFollowingCollection('?collection=collection%3Aresearch'),'collection:research');
});

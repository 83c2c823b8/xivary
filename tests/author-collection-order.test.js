import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepository, prepareState } from '../extension/src/repository/local-repository.js';
import { RepositoryClient } from '../extension/src/repository/repository-client.js';
import { createRepositoryHandler } from '../extension/src/background/repository-handler.js';
import { BrowserLocalStorage, STORAGE_KEY } from '../extension/src/lib/storage.js';
import { authorsInCollection } from '../extension/src/domain/author-ordering.js';
const now='2026-10-15T00:00:00.000Z';let serial=0;
function fixture(initial) {
  let values=initial===undefined?{}:{[STORAGE_KEY]:structuredClone(initial)},writes=0,fail=false;
  const area={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>Object.hasOwn(values,k)).map(k=>[k,structuredClone(values[k])])),set:async patch=>{if(fail)throw Error('quota');Object.assign(values,structuredClone(patch));writes++;}};
  const storage=new BrowserLocalStorage(area),repo=new LocalRepository(storage,()=>now,()=>`scope-${++serial}`),handler=createRepositoryHandler(repo,'test');
  const client=new RepositoryClient({sendMessage:message=>new Promise(resolve=>handler(message,{id:'test'},resolve))});
  return {repo,client,storage,state:()=>structuredClone(values[STORAGE_KEY]),values:()=>structuredClone(values),writes:()=>writes,fail:value=>{fail=value;}};
}
const ids=authors=>authors.map(author=>author.id);
const inCollection=(state,id)=>ids(authorsInCollection(state,id));
const input=file=>({kind:file.base64?'zip':'json',data:file.base64??file.text});
async function populated() {
  const f=fixture(),a=await f.client.createAuthorCollection('Geometry'),b=await f.client.createAuthorCollection('Mirror symmetry');
  for(const displayName of ['George Dimitrov','Tom Bridgeland','Hiroshige Kajiura']){
    const author=await f.client.addAuthorToCollection({displayName,alias:`My ${displayName}`,customName:`先生 ${displayName}`},a.id);
    await f.client.addAuthorToCollection(author,b.id);
  }
  const other=await f.client.createAuthorCollection('Other',{displayName:'Another Researcher'});
  const state=f.state();state.authors=state.authors.map(author=>({...author,alias:`My ${author.displayName}`,customName:`先生 ${author.displayName}`}));await f.storage.write(state);
  return {...f,a,b,other,authors:(await f.client.getAuthorLibrary()).authors.slice(0,3)};
}
test('scoped author moves cross RPC, preserve global/sidebar order and independently order overlapping collections',async()=>{
  const f=await populated(),before=f.state(),[a,b,c]=ids(f.authors);
  assert.equal(await f.client.moveAuthorInCollection(f.a.id,a,null),true);
  assert.deepEqual(inCollection(f.state(),f.a.id),[b,c,a]);assert.deepEqual(inCollection(f.state(),f.b.id),[a,b,c]);
  await f.client.moveAuthorInCollection(f.a.id,a,b);assert.deepEqual(inCollection(f.state(),f.a.id),[a,b,c]);
  await f.client.moveAuthorInCollection(f.b.id,c,a);assert.deepEqual(inCollection(f.state(),f.b.id),[c,a,b]);
  const {authorOrdering:old,...rest}=before,{authorOrdering:next,...after}=f.state();assert.deepEqual(after,rest);
  await f.client.moveFollowedAuthor(a,null);assert.deepEqual(inCollection(f.state(),f.a.id),[a,b,c]);assert.deepEqual(inCollection(f.state(),f.b.id),[c,a,b]);
  const restarted=await new LocalRepository(f.storage).getAuthorLibrary();assert.deepEqual(inCollection(restarted,f.b.id),[c,a,b]);
  assert.deepEqual(restarted.collections,before.collections);assert.deepEqual(restarted.memberships,before.memberships);
});
test('collection moves handle no-op, empty/single, changed membership and failed writes without mutation',async()=>{
  const f=await populated(),[a,b]=ids(f.authors),n=f.writes();
  assert.equal(await f.client.moveAuthorInCollection(f.a.id,a,b),false);assert.equal(f.writes(),n);
  for(const args of [['',a,null],['missing',a,null],[f.a.id,'missing',null],[f.a.id,a,'missing'],[f.other.id,a,null],[null,a,null]])await assert.rejects(f.client.moveAuthorInCollection(...args));
  const empty=await f.client.createAuthorCollection('Empty'),single=await f.client.createAuthorCollection('Single',f.authors[0]);
  await assert.rejects(f.client.moveAuthorInCollection(empty.id,a,null));const count=f.writes();assert.equal(await f.client.moveAuthorInCollection(single.id,a,null),false);assert.equal(f.writes(),count);
  const before=f.values();f.fail(true);await assert.rejects(f.client.moveAuthorInCollection(f.a.id,a,null),/quota/);assert.deepEqual(f.values(),before);
});
test('membership add/remove, rename/delete and Undo reconcile only affected collection orders',async()=>{
  const f=await populated(),[a,b,c]=ids(f.authors);await f.client.moveAuthorInCollection(f.a.id,c,a);
  const receipt=await f.client.removeAuthorFromCollection(a,f.a.id);assert.deepEqual(inCollection(f.state(),f.a.id),[c,b]);
  assert.deepEqual(inCollection(f.state(),f.b.id),[a,b,c]);await f.client.undoRemoval(receipt.undoToken);assert.deepEqual(inCollection(f.state(),f.a.id),[c,a,b]);
  const added=await f.client.addAuthorToCollection({displayName:'New Scholar'},f.a.id);assert.deepEqual(inCollection(f.state(),f.a.id),[c,a,b,added.id]);
  await f.client.renameAuthorCollection(f.a.id,'Renamed');assert.deepEqual(inCollection(f.state(),f.a.id),[c,a,b,added.id]);
  await f.client.deleteAuthorCollection(f.a.id);assert.equal(f.state().authorOrdering.collectionOrders.some(o=>o.collectionId===f.a.id),false);
  assert.deepEqual(inCollection(f.state(),f.b.id),[a,b,c]);
});
test('full, Following ZIP and collection JSON restore independent author order and names without affecting populated local order',async()=>{
  const f=await populated(),[a,b,c]=ids(f.authors);await f.client.moveAuthorInCollection(f.a.id,c,a);await f.client.moveAuthorInCollection(f.b.id,a,null);
  for(const [category,selection] of [['all',{kind:'all'}],['following',{kind:'all'}],['following',{kind:'collection',collectionId:f.a.id}]]){
    const file=await f.client.exportBackup(category,selection),fresh=fixture();await fresh.client.importBackup([input(file)]);
    assert.deepEqual(inCollection(fresh.state(),f.a.id),[c,a,b]);
    if(selection.kind==='all')assert.deepEqual(inCollection(fresh.state(),f.b.id),[b,c,a]);
    assert.deepEqual(fresh.state().authors,f.state().authors.filter(author=>fresh.state().memberships.some(m=>m.authorId===author.id)));
    const stable=fresh.state();await fresh.client.importBackup([input(file)]);assert.deepEqual(fresh.state(),stable);
  }
  const multi=fixture();await multi.client.importBackup(await Promise.all([f.a,f.b].map(async group=>input(await f.client.exportBackup('following',{kind:'collection',collectionId:group.id})))));
  assert.deepEqual(inCollection(multi.state(),f.a.id),[c,a,b]);assert.deepEqual(inCollection(multi.state(),f.b.id),[b,c,a]);
  const dest=fixture();await dest.client.importBackup([input(await f.client.exportBackup('all'))]);await dest.client.moveAuthorInCollection(f.a.id,b,c);
  const before=inCollection(dest.state(),f.a.id);await dest.client.importBackup([input(await f.client.exportBackup('following'))]);assert.deepEqual(inCollection(dest.state(),f.a.id),before);
  const state=dest.state();await dest.client.importBackup([input(await f.client.exportBackup('all'))],'bookmarks');assert.deepEqual(dest.state().authorOrdering,state.authorOrdering);
});
test('portable v3 without optional scoped orders stays importable; malformed author order rejects before any write',async()=>{
  const f=await populated(),file=await f.client.exportBackup('following',{kind:'collection',collectionId:f.a.id});
  const legacy=JSON.parse(file.text);delete legacy.ordering.authorsByCollection;const fresh=fixture();await fresh.client.importBackup([{kind:'json',data:JSON.stringify(legacy)}]);assert.deepEqual(inCollection(fresh.state(),f.a.id),ids(f.authors));
  for(const authorIds of [[f.authors[0].id],['missing'],[f.authors[0].id,f.authors[0].id],null]){
    const doc=JSON.parse(file.text);doc.ordering.authorsByCollection=[{collectionId:f.a.id,authorIds}];const before=fresh.values();
    await assert.rejects(fresh.client.importBackup([{kind:'json',data:JSON.stringify(doc)}]));assert.deepEqual(fresh.values(),before);
  }
});
test('schema 7 upgrades losslessly to independent orders once; concurrent clients, interrupted activation and restart retain exact recovery source',async()=>{
  const source=(await populated()).state();source.schemaVersion=7;delete source.authorOrdering;
  const f=fixture(source);f.fail(true);await assert.rejects(f.repo.initialize(),/quota/);assert.deepEqual(f.state(),source);
  f.fail(false);await Promise.all([f.repo.initialize(),new LocalRepository(f.storage).getAuthorLibrary()]);
  const {authorOrdering,schemaVersion,...rest}=f.state(),{schemaVersion:old,...prior}=source;
  assert.equal(schemaVersion,8);assert.deepEqual(authorOrdering,{version:1,collectionOrders:[]});assert.deepEqual(rest,prior);
  assert.deepEqual(f.values()['xivary:local-migration:7:8'].source,source);
  const count=f.writes();await new LocalRepository(f.storage).initialize();assert.equal(f.writes(),count);
  let active=structuredClone(source),fail=true;
  const storage={read:async()=>structuredClone(active),write:async state=>{if(fail&&state.schemaVersion===8)throw Error('worker stopped');active=structuredClone(state);}};
  await assert.rejects(new LocalRepository(storage).initialize(),/worker stopped/);assert.equal(active.schemaVersion,7);assert.deepEqual(active._storageMigrationJournal.source,source);
  fail=false;await new LocalRepository(storage).initialize();assert.equal(active.schemaVersion,8);assert.deepEqual(active._storageMigrationJournal.source,source);
  const malformed={...prepareState(undefined,now),authorOrdering:null},broken=fixture(malformed);await assert.rejects(broken.repo.getAuthorLibrary(),/author ordering/);assert.deepEqual(broken.state(),malformed);
});

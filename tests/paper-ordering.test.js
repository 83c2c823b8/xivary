import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepository } from '../extension/src/repository/local-repository.js';
import { RepositoryClient } from '../extension/src/repository/repository-client.js';
import { createRepositoryHandler } from '../extension/src/background/repository-handler.js';
import { moveBefore, reconcilePaperOrdering } from '../extension/src/domain/paper-ordering.js';
import { projectState } from '../extension/src/repository/sync-model.js';

const now = '2026-10-15T00:00:00Z';
const paper = index => ({ arxivId: `2610.${String(index).padStart(5,'0')}`, title: `Paper ${index}`, authors: ['Alex Kim'] });
async function fixture() {
  let state, serial=0, writes=0, fail=false;
  const storage={ read:async()=>structuredClone(state), write:async value=>{if(fail)throw Error('quota');state=structuredClone(value);writes++;} };
  const repo=new LocalRepository(storage,()=>now,()=>`order-${++serial}`);
  const handler=createRepositoryHandler(repo,'test');
  const client=new RepositoryClient({sendMessage:message=>new Promise(resolve=>handler(message,{id:'test'},resolve))});
  await client.savePaper(paper(1));await client.savePaper(paper(2));await client.savePaper(paper(3));
  const a=await client.createPaperCollection('Algebra',paper(1)),b=await client.createPaperCollection('Geometry',paper(1));
  for(const collection of [a,b])for(const index of [2,3])await client.addPaperToCollection(paper(index),collection.id);
  return {client,repo,storage,a,b,state:()=>structuredClone(state),writes:()=>writes,fail:value=>fail=value};
}
test('stable-ID moves preserve membership, metadata, Following, preferences and global order',async()=>{
  const f=await fixture();await f.client.followAuthor({displayName:'Alex Kim'});
  const before=f.state(),initial=await f.client.getPaperLibrary();
  await f.client.movePaperCollection(f.b.id,initial.collections[0].id);
  const next=await f.client.getPaperLibrary();assert.deepEqual(next.ordering.collectionIds,[f.b.id,...initial.collections.slice(0,2).map(item=>item.id)]);
  await f.client.movePaperInCollection(f.a.id,paper(3).arxivId,paper(1).arxivId);
  assert.deepEqual((await f.client.getPaperLibrary()).ordering.paperOrders,[{collectionId:f.a.id,paperIds:[3,1,2].map(i=>paper(i).arxivId)}]);
  for(const field of ['favorites','paperCollections','paperMemberships','authors','memberships','collections','settings'])assert.deepEqual(f.state()[field],before[field]);
  assert.deepEqual(projectState(f.state()),projectState(before));
  assert.deepEqual((await f.client.listFavorites()).map(item=>item.arxivId),before.favorites.map(item=>item.arxivId));
});
test('per-collection ordering is independent; the real Saved Papers seed can move without special casing its name',async()=>{
  const f=await fixture();const initial=await f.client.getPaperLibrary(),seed=initial.collections[0];
  assert.equal(seed.name,'Saved Papers');await f.client.movePaperCollection(seed.id,null);
  assert.equal((await f.client.getPaperLibrary()).ordering.collectionIds.at(-1),seed.id);
  await f.client.movePaperInCollection(f.a.id,paper(3).arxivId,paper(1).arxivId);
  await f.client.movePaperInCollection(f.b.id,paper(1).arxivId,null);
  const orders=(await f.client.getPaperLibrary()).ordering.paperOrders;
  assert.deepEqual(orders.find(order=>order.collectionId===f.a.id).paperIds,[3,1,2].map(i=>paper(i).arxivId));
  assert.deepEqual(orders.find(order=>order.collectionId===f.b.id).paperIds,[2,3,1].map(i=>paper(i).arxivId));
});
test('rename, add, membership removal/deletion and Undo reconcile IDs without dangling references',async()=>{
  const f=await fixture();await f.client.movePaperCollection(f.a.id,null);await f.client.movePaperInCollection(f.a.id,paper(2).arxivId,paper(1).arxivId);
  const ordering=(await f.client.getPaperLibrary()).ordering;
  await f.client.renamePaperCollection(f.a.id,'Renamed');assert.deepEqual((await f.client.getPaperLibrary()).ordering,ordering);
  const c=await f.client.createPaperCollection('New');assert.equal((await f.client.getPaperLibrary()).ordering.collectionIds.at(-1),c.id);
  await f.client.addPaperToCollection(paper(4),f.a.id);assert.equal(f.state().paperOrdering.paperOrders[0].paperIds.at(-1),paper(4).arxivId);
  const receipt=await f.client.removePaperFromCollection(paper(1).arxivId,f.a.id);
  assert.ok(!f.state().paperOrdering.paperOrders[0].paperIds.includes(paper(1).arxivId));
  await f.client.undoRemoval(receipt.undoToken);
  assert.deepEqual(f.state().paperOrdering.paperOrders[0].paperIds,[2,1,3,4].map(i=>paper(i).arxivId));
  await f.client.deletePaperCollection(f.a.id);
  assert.ok(!f.state().paperOrdering.collectionIds.includes(f.a.id));assert.ok(!f.state().paperOrdering.paperOrders.some(order=>order.collectionId===f.a.id));
});
test('ordering survives repository/service-worker recreation; invalid/no-op moves and failed persistence are safe',async()=>{
  const f=await fixture();await f.client.movePaperCollection(f.b.id,f.a.id);await f.client.movePaperInCollection(f.b.id,paper(3).arxivId,paper(2).arxivId);
  assert.deepEqual((await new LocalRepository(f.storage,()=>now).getPaperLibrary()).ordering,f.state().paperOrdering);
  const before=f.state(),writes=f.writes();
  await assert.rejects(f.client.movePaperCollection('',null));await assert.rejects(f.client.movePaperCollection(f.a.id,'New collection'));
  await assert.rejects(f.client.movePaperInCollection(f.a.id,paper(9).arxivId,null));await assert.rejects(f.client.movePaperInCollection('',paper(1).arxivId,null));
  await f.client.movePaperCollection(f.b.id,f.a.id);assert.equal(f.writes(),writes);assert.deepEqual(f.state(),before);
  f.fail(true);await assert.rejects(f.client.movePaperInCollection(f.a.id,paper(1).arxivId,null),/quota/);assert.deepEqual(f.state(),before);
});
test('move and reconciliation are deterministic, append new IDs and prune stale/duplicate references',()=>{
  assert.deepEqual(moveBefore(['a','b','c'],'a',null),['b','c','a']);assert.deepEqual(moveBefore(['a','b','c'],'c','a'),['c','a','b']);
  const state={paperCollections:[{id:'a'},{id:'b'}],favorites:[{arxivId:'1'},{arxivId:'2'},{arxivId:'3'}],paperMemberships:[{collectionId:'a',arxivId:'1'},{collectionId:'a',arxivId:'2'}],paperOrdering:{version:1,collectionIds:['b','deleted','b'],paperOrders:[{collectionId:'a',paperIds:['2','deleted','2']},{collectionId:'deleted',paperIds:[]}]}};
  const order=reconcilePaperOrdering(state);assert.deepEqual(order,{version:1,collectionIds:['b','a'],paperOrders:[{collectionId:'a',paperIds:['2','1']}]});
  assert.deepEqual(reconcilePaperOrdering({...state,paperOrdering:order}),order);
  assert.throws(()=>reconcilePaperOrdering({...state,paperOrdering:{version:9}}),/Invalid Library ordering/);
});

test('current JSON imports retain destination ordering; exports explicitly omit the new local ordering',async()=>{
  const source=await fixture(),destination=await fixture();
  await destination.client.movePaperCollection(destination.b.id,destination.a.id);
  await destination.client.movePaperInCollection(destination.a.id,paper(3).arxivId,paper(1).arxivId);
  const before=destination.state().paperOrdering;
  await source.client.addPaperToCollection(paper(4),source.a.id);
  const exported=await source.client.exportCategory('bookmarks',{kind:'all'});
  assert.equal(exported.paperOrdering,undefined);
  await destination.client.importCategory(JSON.stringify(exported),'bookmarks');
  assert.deepEqual(destination.state().paperOrdering.collectionIds,before.collectionIds);
  assert.deepEqual(destination.state().paperOrdering.paperOrders[0].paperIds,[...before.paperOrders[0].paperIds,paper(4).arxivId]);
  const ordering=destination.state().paperOrdering;
  await source.client.followAuthor({displayName:'Jordan Scholar'});
  await destination.client.importCategory(JSON.stringify(await source.client.exportCategory('following',{kind:'all'})),'following');
  assert.deepEqual(destination.state().paperOrdering,ordering);
});

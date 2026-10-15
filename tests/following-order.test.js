import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepository, prepareState } from '../extension/src/repository/local-repository.js';
import { RepositoryClient } from '../extension/src/repository/repository-client.js';
import { createRepositoryHandler } from '../extension/src/background/repository-handler.js';
import { createAuthor } from '../extension/src/domain/author.js';
const now='2026-10-15T00:00:00.000Z';
function fixture(initial) {
  let state=structuredClone(initial),writes=0,fail=false;
  const storage={read:async()=>structuredClone(state),write:async value=>{if(fail)throw Error('quota');state=structuredClone(value);writes++;}};
  const repo=new LocalRepository(storage,()=>now),handler=createRepositoryHandler(repo,'test');
  const client=new RepositoryClient({sendMessage:message=>new Promise(resolve=>handler(message,{id:'test'},resolve))});
  return {storage,repo,client,state:()=>structuredClone(state),writes:()=>writes,fail:value=>{fail=value;}};
}
function previous() {
  const state=prepareState(undefined,now);state.schemaVersion=6;
  state.authors=['Alex Kim','Retained Researcher','Renée Smith','Beta Scholar'].map((displayName,index)=>({...createAuthor({displayName},new Date(Date.parse(now)+index*60000).toISOString()),alias:`My alias ${index}`,identity:{query:displayName},originalName:displayName}));
  state.collections=[{id:'collection:following',name:'People',createdAt:now,updatedAt:now}];
  state.memberships=state.authors.filter((_,index)=>index!==1).map(author=>({authorId:author.id,collectionId:'collection:following',addedAt:now,updatedAt:now}));
  state.followingFeedEvidence={retained:'fixture'};state.customSortPreference='keep';return state;
}
const backupInput=file=>({kind:file.base64?'zip':'json',data:file.base64??file.text});
const ids=authors=>authors.map(author=>author.id);
const records=authors=>[...authors].sort((a,b)=>a.id.localeCompare(b.id));
test('schema 6 upgrade preserves the previous visible order, records, retained slots and original recovery snapshot',async()=>{
  const source=previous(),f=fixture(source),live=source.authors.filter((_,i)=>i!==1).reverse();
  assert.deepEqual(ids(await f.client.listFollowing()),ids(live));assert.equal(f.state().schemaVersion,8);
  assert.deepEqual(records(f.state().authors),records(source.authors));assert.deepEqual(f.state().authors[1],source.authors[1]);
  assert.deepEqual(f.state().memberships,source.memberships);assert.deepEqual(f.state()._storageMigrationJournal.source,source);
  const count=f.writes();await new LocalRepository(f.storage).initialize();assert.equal(f.writes(),count);
});
test('manual moves cross RPC, change only array order, preserve retired metadata and survive worker recreation',async()=>{
  const f=fixture(previous());await f.client.initialize();const before=f.state(),[a,b,c]=await f.client.listFollowing();
  await f.client.moveFollowedAuthor(c.id,a.id);assert.deepEqual(ids(await f.client.listFollowing()),[c.id,a.id,b.id]);
  await f.client.moveFollowedAuthor(c.id,null);assert.deepEqual(ids(await f.client.listFollowing()),[a.id,b.id,c.id]);
  assert.deepEqual(records(f.state().authors),records(before.authors));assert.deepEqual(f.state().authors[1],before.authors[1]);
  const {authors:oldAuthors,...oldState}=before,{authors:newAuthors,...newState}=f.state();assert.deepEqual(newState,oldState);
  assert.deepEqual(ids(await new LocalRepository(f.storage).listFollowing()),[a.id,b.id,c.id]);
  const receipt=await f.client.unfollowAuthor(b.id);await f.client.undoRemoval(receipt.undoToken);
  assert.deepEqual(ids(await f.client.listFollowing()),[a.id,b.id,c.id]);
});
test('empty/single/no-op and invalid moves never write; failed persistence leaves the complete order intact',async()=>{
  const empty=fixture();await empty.client.initialize();const n=empty.writes();await assert.rejects(empty.client.moveFollowedAuthor('missing',null));assert.equal(empty.writes(),n);
  const f=fixture(previous());await f.client.initialize();const [a,b]=await f.client.listFollowing();
  const before=f.state(),writes=f.writes();await f.client.moveFollowedAuthor(a.id,b.id);assert.equal(f.writes(),writes);
  for(const id of ['missing',f.state().authors[1].id])await assert.rejects(f.client.moveFollowedAuthor(id,null));
  f.fail(true);await assert.rejects(f.client.moveFollowedAuthor(a.id,null),/quota/);assert.deepEqual(f.state(),before);
  const single=fixture();await single.client.followAuthor({displayName:'Only Scholar'});const one=(await single.client.listFollowing())[0],count=single.writes();
  await single.client.moveFollowedAuthor(one.id,null);await single.client.moveFollowedAuthor(one.id,one.id);assert.equal(single.writes(),count);
});
test('all, Following and collection backup orders restore into fresh profiles; existing profiles retain their own order',async()=>{
  const f=fixture(previous());const [a,b,c]=await f.client.listFollowing();await f.client.moveFollowedAuthor(c.id,a.id);
  const ordered=await f.client.listFollowing();
  for(const [category,selection] of [['all',{kind:'all'}],['following',{kind:'all'}],['following',{kind:'collection',collectionId:'collection:following'}]]) {
    const fresh=fixture();await fresh.client.importBackup([backupInput(await f.client.exportBackup(category,selection))]);
    assert.deepEqual(await fresh.client.listFollowing(),ordered);assert.deepEqual(fresh.state().memberships,f.state().memberships);
  }
  const existing=fixture(previous());await existing.client.moveFollowedAuthor(a.id,null);const before=await existing.client.listFollowing();
  await existing.client.importBackup([backupInput(await f.client.exportBackup('following'))]);assert.deepEqual(await existing.client.listFollowing(),before);
  await f.client.followAuthor({displayName:'New Scholar'});assert.equal((await f.client.listFollowing()).at(-1).displayName,'New Scholar');
});
test('schema 6 migration failure/retry never reverts customized records or order',async()=>{
  const source=previous(),f=fixture(source);f.fail(true);await assert.rejects(f.client.initialize(),/quota/);assert.deepEqual(f.state(),source);
  f.fail(false);await f.client.initialize();const current=f.state();await new LocalRepository(f.storage).initialize();assert.deepEqual(f.state(),current);
});

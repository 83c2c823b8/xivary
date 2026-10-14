import test from 'node:test';
import assert from 'node:assert/strict';
import { OfflineRepository, validatePdf, versionedArxivId } from '../extension/src/repository/offline-repository.js';
import { upgradeOfflineDatabase } from '../extension/src/repository/offline-storage.js';
import { LocalRepository } from '../extension/src/repository/local-repository.js';
import { RepositoryClient } from '../extension/src/repository/repository-client.js';

const paper = { arxivId: '2401.00001v1', title: 'Offline paper', authors: ['Alex Kim'], tags: ['keep'], note: 'keep' };
const pdf = '%PDF-1.4\nvalidated fixture\n%%EOF';
const response = text => new Response(text, { headers: { 'content-type': 'application/pdf' } });
class MemoryOffline {
  copies = new Map(); blobs = new Map(); writes = 0;
  async list() { return [...this.copies.values()]; }
  async get(id) { return this.copies.get(id); }
  async read(id) { return { copy: this.copies.get(id), blob: this.blobs.get(id) }; }
  async put(copy, blob) { this.writes++; this.copies.set(copy.arxivId, copy); this.blobs.set(copy.arxivId, blob); }
  async remove(id) { this.copies.delete(id); this.blobs.delete(id); }
}
const fixture = fetch => { const storage = new MemoryOffline(); return { storage, offline: new OfflineRepository({ storage, fetch, clock: (() => { let n = 0; return () => new Date(1700000000000 + n++).toISOString(); })() }) }; };

test('modern, versioned URL, PDF URL and legacy arXiv identifiers retain exact version', () => {
  for (const [value, id, version] of [['2401.00001v12','2401.00001',12], ['https://arxiv.org/pdf/hep-th/9901001v3.pdf','hep-th/9901001',3], ['arxiv:math.GT/0301001v2','math.GT/0301001',2], ['2401.00001','2401.00001',null]]) assert.deepEqual(versionedArxivId(value), { arxivId:id, version, versionedId:version ? `${id}v${version}` : null });
  assert.throws(() => versionedArxivId('https://evil.test/pdf/2401.00001v1'));
  assert.throws(() => versionedArxivId('2401.00001v999999999999999999999'), /version/);
});
test('a mismatched version identifier cannot store another paper under its metadata', async () => {
  const {offline,storage}=fixture(async()=>assert.fail('No fetch for a mismatched identifier'));
  await assert.rejects(offline.save({...paper,versionedId:'2401.00002v1'}),/another paper/);
  assert.equal(storage.writes,0);
});
test('fresh database and additive v1 migration retain existing stores', () => {
  const calls=[];
  const db={ createObjectStore:(...args)=>calls.push(args) };
  const tx={objectStore:name=>({createIndex:(...args)=>calls.push([name,...args])})};
  upgradeOfflineDatabase(db,tx,0);
  assert.deepEqual(calls,[['copies',{keyPath:'arxivId'}],['pdfs'],['copies','savedAt','savedAt']]);
  calls.length=0;upgradeOfflineDatabase(db,tx,1);assert.deepEqual(calls,[['copies','savedAt','savedAt']]);
});
test('concurrent duplicate saves, reading chunks, explicit update and removal', async () => {
  let requests=0;
  const {offline,storage}=fixture(async url=>{requests++;return url.includes('/abs/') ? new Response('arXiv:2401.00001v2') : response(pdf);});
  const [one,two]=await Promise.all([offline.save(paper),offline.save(paper)]);
  assert.deepEqual(one,two);assert.equal(requests,1);assert.equal(storage.writes,1);
  assert.equal(atob(await offline.chunk(one.arxivId,one.revision,0)),pdf);
  const updated=await offline.save(paper,true);assert.equal(updated.version,2);assert.equal(storage.writes,2);
  await assert.rejects(offline.chunk(one.arxivId,one.revision,0),/changed/);
  await offline.save(paper);assert.equal(storage.writes,2);
  await offline.remove(one.arxivId);assert.equal((await offline.list()).count,0);
});
test('invalid HTTP, MIME, incomplete PDF and interrupted length cannot commit', async () => {
  for (const bad of [new Response('error',{status:503}),new Response('<html>'),response('hello'),response('%PDF-1.4\npartial'),new Response(pdf,{headers:{'content-type':'application/pdf','content-length':'9999'}})]) await assert.rejects(validatePdf(bad));
  const {offline,storage}=fixture(async()=>{throw new TypeError('Network interrupted');});
  await assert.rejects(offline.save(paper),/Network interrupted/);assert.equal(storage.writes,0);assert.equal((await offline.list()).operations[paper.arxivId.replace('v1','')].status,'error');
});
test('failed update and quota exhaustion preserve the previous copy', async () => {
  const {offline,storage}=fixture(async()=>response(pdf));const saved=await offline.save(paper);
  offline.fetch=async()=>new Response('arXiv:2401.00001v2');
  await assert.rejects(offline.save(paper,true),/PDF/);assert.deepEqual(await offline.get(saved.arxivId),saved);
  offline.fetch=async url=>url.includes('/abs/') ? new Response('arXiv:2401.00001v2') : response(pdf);
  storage.put=async()=>{throw new DOMException('Quota','QuotaExceededError');};
  await assert.rejects(offline.save(paper,true),/storage is full/);assert.deepEqual(await offline.get(saved.arxivId),saved);
});
test('cancellation and queued removal never leave a saved state', async () => {
  const {offline}=fixture((url,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError'))); }));
  const save=offline.save(paper);await new Promise(resolve=>setTimeout(resolve,0));
  const remove=offline.remove(paper.arxivId);await assert.rejects(save,/cancelled/);await remove;assert.equal((await offline.list()).count,0);
});
test('bookmark removals, offline removals and portable category imports remain independent', async () => {
  let envelope;
  const repository=new LocalRepository({read:async()=>envelope,write:async value=>{envelope=structuredClone(value);}});
  const {offline}=fixture(async()=>response(pdf));repository.offline=offline;
  await repository.saveOfflinePaper(paper,false);assert.equal((await repository.listFavorites()).length,0);
  await repository.savePaper(paper);await repository.removeFavorite(paper.arxivId);assert.ok(await offline.get(paper.arxivId));
  await repository.savePaper(paper);const before=await repository.getPaperLibrary();
  await repository.removeOfflineCopy(paper.arxivId);assert.deepEqual(await repository.getPaperLibrary(),before);
  await repository.saveOfflinePaper(paper,false);const backup=await repository.exportCategory('bookmarks',{kind:'all'});
  assert.ok(!JSON.stringify(backup).includes('versionedId'));await repository.importCategory(JSON.stringify(backup),'bookmarks');assert.ok(await offline.get(paper.arxivId));
});
test('JSON-safe client chunk transport reconstructs binary bytes without a single large message', async () => {
  const bytes=new Uint8Array(1100000);for(let i=0;i<bytes.length;i++)bytes[i]=i%256;
  const storage=new MemoryOffline();await storage.put({arxivId:'2401.00001',savedAt:'timestamp',size:bytes.length},new Blob([bytes]));
  const offline=new OfflineRepository({storage});let chunks=0;
  const client=new RepositoryClient({sendMessage:async message=>({ok:true,result:message.method==='getOfflineCopy'?await offline.get(message.args[0]):(chunks++,await offline.chunk(...message.args))})});
  const {blob}=await client.readOfflinePdf('2401.00001');assert.equal(chunks,3);assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),bytes);
});

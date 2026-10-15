import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChromiumTestSession } from './chromium-test-session.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=await mkdtemp(join(tmpdir(),'xivary-reorder-')),profile=join(temporary,'profile');
const screenshots='/tmp/xivary-reorder-screenshots';await mkdir(screenshots,{recursive:true});
let chrome=new ChromiumTestSession(profile),extensionId;
const paper=i=>({arxivId:`2610.${String(i).padStart(5,'0')}`,title:`Reordering paper ${i}`,authors:['Alex Kim'],publishedAt:'2020-01-01T00:00:00Z',categories:['math.SG']});
const client=expression=>`(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();return ${expression};})()`;
async function key(page,key,code=key) {for(const type of ['keyDown','keyUp'])await chrome.send('Input.dispatchKeyEvent',{type,key,code},page.sessionId);}
async function shot(page,name) {await chrome.evaluate(page.sessionId,'document.fonts.ready');const {data}=await chrome.send('Page.captureScreenshot',{},page.sessionId);await writeFile(join(screenshots,name),Buffer.from(data,'base64'));}
async function drag(page,selector,destination,{cancel=false,valid=true}={}) {
  await chrome.evaluate(page.sessionId,`document.querySelector(${JSON.stringify(selector)}).focus();document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);
  const point=await chrome.evaluate(page.sessionId,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point},page.sessionId);
  await chrome.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1},page.sessionId);
  for(let step=1;step<=4;step++)await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y+(destination-point.y)*step/4,buttons:1},page.sessionId);
  const marked=await chrome.evaluate(page.sessionId,"!!document.querySelector('.drop-before,.drop-after')");
  if(valid&&!marked)console.log(JSON.stringify({selector,point,destination,debug:await chrome.evaluate(page.sessionId,"({active:document.activeElement.outerHTML,items:[...document.querySelectorAll('[data-reorder-id]')].map(node=>({id:node.dataset.reorderId,class:node.className})),status:document.querySelector('#status').textContent})")},null,2));
  assert.equal(marked,valid);
  if(cancel)await key(page,'Escape');
  await chrome.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:destination,button:'left',buttons:0,clickCount:1},page.sessionId);
}
const collectionIds=page=>chrome.evaluate(page.sessionId,"[...document.querySelectorAll('.collection-link')].map(node=>node.dataset.collectionId)");
const paperIds=page=>chrome.evaluate(page.sessionId,"[...document.querySelectorAll('#papers .paper-row h2 a')].map(node=>node.href.split('/abs/')[1])");
const ready=page=>chrome.until(page.sessionId,"!!document.querySelector('#count')?.textContent && document.querySelector('#filter')?.disabled===false");
async function select(page,id){await chrome.click(page.sessionId,`.collection-link[data-collection-id="${id}"]`);}
async function geometry(page,id) {
  return chrome.evaluate(page.sessionId,`(()=>{const row=document.querySelector('.collection-link[data-collection-id="${id}"]').closest('.collection-row');
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,width:r.width};};
    return {row:rect(row),grip:rect(row.querySelector('.reorder-handle')),name:rect(row.querySelector('.collection-label')),count:rect(row.querySelector('.collection-count')),menu:rect(row.querySelector('.collection-more')),
      gripVisible:getComputedStyle(row.querySelector('.reorder-handle')).opacity,menuVisible:getComputedStyle(row.querySelector('.collection-more')).opacity,
      truncated:row.querySelector('.collection-label').scrollWidth>row.querySelector('.collection-label').clientWidth};})()`);
}
function aligned(g){assert.ok(g.grip.left>=g.row.left&&g.grip.right<=g.name.left);assert.ok(g.name.right<=g.count.left);assert.ok(g.count.right+4<=g.menu.left);assert.ok(g.menu.right<=g.row.right);}
const owned=library=>({papers:library.papers,collections:[...library.collections].sort((a,b)=>a.id.localeCompare(b.id)),memberships:[...library.memberships].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),ordering:library.ordering});
try {
  extensionId=(await chrome.send('Extensions.loadUnpacked',{path:join(root,'dist/chromium')})).id;
  console.log((await chrome.send('Browser.getVersion')).product);
  let page=await chrome.page(`chrome-extension://${extensionId}/src/library/library.html`);
  await chrome.send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false},page.sessionId);await ready(page);
  const created=await chrome.evaluate(page.sessionId,client(`(async()=>{
    const seed=(await repository.getPaperLibrary()).collections[0];await repository.renamePaperCollection(seed.id,'Empty collection');
    const a=await repository.createPaperCollection('Algebra',${JSON.stringify(paper(1))});
    const b=await repository.createPaperCollection('A very long collection name with geometry, representations and Unicode — 猫'.slice(0,80),${JSON.stringify(paper(1))});
    const saved=await repository.createPaperCollection('Saved Papers',${JSON.stringify(paper(1))});
    for(const collection of [a,b])for(const p of ${JSON.stringify([paper(2),paper(3)])})await repository.addPaperToCollection(p,collection.id);
    return {seed:seed.id,a:a.id,b:b.id,saved:saved.id};})()`));
  await chrome.send('Page.reload',{},page.sessionId);await ready(page);
  const initial=['',created.seed,created.a,created.b,created.saved];assert.deepEqual(await collectionIds(page),initial);
  assert.equal(await chrome.evaluate(page.sessionId,"document.querySelectorAll('#collection-list .reorder-handle').length"),4);
  assert.equal(await chrome.evaluate(page.sessionId,"!document.querySelector('#reorder-done') && document.querySelectorAll('#papers .reorder-handle').length===0"),true);
  await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1200,y:20},page.sessionId);
  const cold=await geometry(page,created.b);aligned(cold);assert.equal(cold.gripVisible,'0');assert.equal(cold.menuVisible,'0');assert.equal(cold.truncated,true);
  await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:cold.name.left+10,y:cold.name.top+5},page.sessionId);
  const hover=await geometry(page,created.b);aligned(hover);assert.equal(hover.gripVisible,'1');assert.equal(hover.menuVisible,'1');
  for(const field of ['row','grip','name','count','menu'])assert.deepEqual(hover[field],cold[field]);
  await shot(page,'direct-hover.png');
  await chrome.click(page.sessionId,`.collection-link[data-collection-id="${created.b}"] + .collection-more`);
  assert.deepEqual(await chrome.evaluate(page.sessionId,"[...document.querySelectorAll('.collection-menu [data-action]')].map(n=>n.dataset.action)"),['rename','delete']);
  assert.equal(await chrome.evaluate(page.sessionId,"document.querySelector('.collection-link[aria-current]').dataset.collectionId"),'');await key(page,'Escape');
  await select(page,created.b);
  const labelCounts=await chrome.evaluate(page.sessionId,"[...document.querySelectorAll('.collection-link')].map(n=>[n.dataset.collectionId,n.querySelector('.collection-count').textContent])");
  const firstTop=await chrome.evaluate(page.sessionId,"document.querySelectorAll('.collection-item')[1].getBoundingClientRect().top+1");
  await drag(page,`[data-reorder-handle="${created.saved}"]`,firstTop);
  await chrome.until(page.sessionId,`document.querySelectorAll('.collection-link')[1].dataset.collectionId===${JSON.stringify(created.saved)}&&!document.querySelector('#filter').disabled`);
  assert.deepEqual(await collectionIds(page),['',created.saved,created.seed,created.a,created.b]);
  const afterCounts=await chrome.evaluate(page.sessionId,"[...document.querySelectorAll('.collection-link')].map(n=>[n.dataset.collectionId,n.querySelector('.collection-count').textContent])");assert.deepEqual(afterCounts.sort(),labelCounts.sort());
  assert.equal(await chrome.evaluate(page.sessionId,"document.querySelector('.collection-link[aria-current]').dataset.collectionId"),created.b);
  await chrome.evaluate(page.sessionId,`document.querySelector('[data-reorder-handle="${created.saved}"]').focus()`);
  await key(page,'ArrowDown');await chrome.until(page.sessionId,"document.querySelector('#status').textContent.includes('position 2')&&!document.querySelector('#filter').disabled");
  const ordered=['',created.seed,created.saved,created.a,created.b];assert.deepEqual(await collectionIds(page),ordered);
  await drag(page,`[data-reorder-handle="${created.b}"]`,firstTop,{cancel:true});assert.deepEqual(await collectionIds(page),ordered);
  const aggregateY=await chrome.evaluate(page.sessionId,"document.querySelector('.collection-item').getBoundingClientRect().top+10");
  await drag(page,`[data-reorder-handle="${created.b}"]`,aggregateY,{valid:false});assert.deepEqual(await collectionIds(page),ordered);
  const newY=await chrome.evaluate(page.sessionId,"document.querySelector('#show-create').getBoundingClientRect().top+10");
  await drag(page,`[data-reorder-handle="${created.b}"]`,newY,{valid:false});assert.deepEqual(await collectionIds(page),ordered);
  await select(page,created.seed);assert.equal((await paperIds(page)).length,0);assert.equal(await chrome.evaluate(page.sessionId,"document.querySelectorAll('#papers .reorder-handle').length"),0);
  await select(page,created.saved);assert.equal((await paperIds(page)).length,1);
  const singleOrder=await chrome.evaluate(page.sessionId,client('repository.getPaperLibrary().then(v=>v.ordering)'));
  await chrome.evaluate(page.sessionId,"document.querySelector('#papers .reorder-handle').focus()");await key(page,'End');
  assert.deepEqual(await chrome.evaluate(page.sessionId,client('repository.getPaperLibrary().then(v=>v.ordering)')),singleOrder);
  await select(page,created.a);assert.deepEqual(await paperIds(page),[1,2,3].map(i=>paper(i).arxivId));
  // A filtered subset must never silently reorder unseen collection members.
  await chrome.evaluate(page.sessionId,"document.querySelector('#filter').value='paper 1';document.querySelector('#filter').dispatchEvent(new Event('input',{bubbles:true}))");
  assert.equal((await paperIds(page)).length,1);assert.equal(await chrome.evaluate(page.sessionId,"document.querySelector('#papers .reorder-handle').disabled && document.querySelector('#papers .reorder-handle').title.includes('Clear filters')"),true);
  await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1200,y:20},page.sessionId);
  assert.equal(await chrome.evaluate(page.sessionId,"getComputedStyle(document.querySelector('#papers .reorder-handle')).opacity"),'0');
  await chrome.evaluate(page.sessionId,"document.querySelector('#filter').value='';document.querySelector('#filter').dispatchEvent(new Event('input',{bubbles:true}))");
  await chrome.click(page.sessionId,'#date-range');await chrome.click(page.sessionId,'.time-menu [data-range=year]');assert.equal((await paperIds(page)).length,0);
  await chrome.click(page.sessionId,'#date-range');await chrome.click(page.sessionId,'.time-menu [data-range=any]');
  assert.equal(await chrome.evaluate(page.sessionId,"document.querySelectorAll('.paper-row[draggable=true]').length"),0);
  const beforeTargets=(await chrome.send('Target.getTargets')).targetInfos.map(t=>t.url).filter(url=>url.includes('arxiv.org'));
  const lastBottom=await chrome.evaluate(page.sessionId,"document.querySelector('#papers').getBoundingClientRect().bottom-2");
  await drag(page,`#papers [data-reorder-handle="${paper(1).arxivId}"]`,lastBottom);
  await chrome.until(page.sessionId,"document.querySelector('#status').textContent.includes('position 3')&&!document.querySelector('#filter').disabled");
  assert.deepEqual(await paperIds(page),[2,3,1].map(i=>paper(i).arxivId));
  assert.deepEqual((await chrome.send('Target.getTargets')).targetInfos.map(t=>t.url).filter(url=>url.includes('arxiv.org')),beforeTargets);
  await chrome.evaluate(page.sessionId,`document.querySelector('#papers [data-reorder-handle="${paper(1).arxivId}"]').focus()`);
  await key(page,'ArrowUp');await chrome.until(page.sessionId,"document.querySelector('#status').textContent.includes('position 2')&&!document.querySelector('#filter').disabled");
  assert.deepEqual(await paperIds(page),[2,1,3].map(i=>paper(i).arxivId));
  const paperTop=await chrome.evaluate(page.sessionId,"document.querySelector('#papers').getBoundingClientRect().top+1");
  await drag(page,`#papers [data-reorder-handle="${paper(3).arxivId}"]`,paperTop,{cancel:true});assert.deepEqual(await paperIds(page),[2,1,3].map(i=>paper(i).arxivId));
  await shot(page,'direct-papers.png');
  const ax=await chrome.send('Accessibility.getFullAXTree',{},page.sessionId);assert.ok(ax.nodes.some(n=>n.role?.value==='button'&&n.name?.value==='Move Reordering paper 1'));
  for(const width of [1280,360]) {
    await chrome.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false},page.sessionId);
    const g=await geometry(page,created.b);aligned(g);
    assert.equal(await chrome.evaluate(page.sessionId,'document.documentElement.scrollWidth<=innerWidth'),true);
    assert.equal(await chrome.evaluate(page.sessionId,"(()=>{const row=document.querySelector('.paper-row'),r=row.querySelector('.reorder-handle').getBoundingClientRect();return r.left>=row.getBoundingClientRect().left&&r.right<=row.querySelector('h2').getBoundingClientRect().left})()"),true);
    await chrome.evaluate(page.sessionId,`document.querySelector('.collection-link[data-collection-id="${created.b}"] .collection-count').textContent='123456'`);aligned(await geometry(page,created.b));
    await chrome.evaluate(page.sessionId,`document.querySelector('.collection-link[data-collection-id="${created.b}"] .collection-count').textContent='3'`);
    await shot(page,`direct-${width}.png`);
  }
  await chrome.send('Emulation.clearDeviceMetricsOverride',{},page.sessionId);
  await select(page,created.b);assert.deepEqual(await paperIds(page),[1,2,3].map(i=>paper(i).arxivId));
  await select(page,created.a);assert.deepEqual(await paperIds(page),[2,1,3].map(i=>paper(i).arxivId));
  assert.equal(await chrome.evaluate(page.sessionId,"document.querySelectorAll('.bookmark,.offline-action').length"),6);
  await chrome.click(page.sessionId,'.paper-row .bookmark');await chrome.until(page.sessionId,"!!document.querySelector('.arxiv-collection-picker')");await key(page,'Escape');
  const source=await chrome.evaluate(page.sessionId,client('repository.getPaperLibrary()')),persisted=source.ordering;
  await select(page,'');assert.equal(await chrome.evaluate(page.sessionId,"document.querySelectorAll('#papers .reorder-handle').length"),0);
  await chrome.send('Page.reload',{},page.sessionId);await ready(page);assert.deepEqual(await collectionIds(page),ordered);
  await chrome.send('ServiceWorker.enable',{},page.sessionId);await chrome.send('ServiceWorker.stopAllWorkers',{},page.sessionId);
  assert.deepEqual((await chrome.evaluate(page.sessionId,client('repository.getPaperLibrary()'))).ordering,persisted);
  const backup=await chrome.evaluate(page.sessionId,client("repository.exportBackup('all')"));
  await chrome.close();chrome=new ChromiumTestSession(profile);assert.equal((await chrome.send('Extensions.loadUnpacked',{path:join(root,'dist/chromium')})).id,extensionId);
  page=await chrome.page(`chrome-extension://${extensionId}/src/library/library.html`);await ready(page);assert.deepEqual(await collectionIds(page),ordered);
  assert.deepEqual((await chrome.evaluate(page.sessionId,client('repository.getPaperLibrary()'))).ordering,persisted);
  await select(page,created.a);assert.deepEqual(await paperIds(page),[2,1,3].map(i=>paper(i).arxivId));
  await chrome.close();chrome=new ChromiumTestSession(join(temporary,'restore'));
  extensionId=(await chrome.send('Extensions.loadUnpacked',{path:join(root,'dist/chromium')})).id;
  page=await chrome.page(`chrome-extension://${extensionId}/src/library/library.html`);await ready(page);
  await chrome.evaluate(page.sessionId,client(`repository.importBackup([{kind:'zip',data:${JSON.stringify(backup.base64)}}],'all')`));
  assert.deepEqual(owned(await chrome.evaluate(page.sessionId,client('repository.getPaperLibrary()'))),owned(source));
  console.log(`DIRECT REORDER PASS: hover/focus handles and stable menu/count/name tracks, long names and six-digit counts, fixed aggregate/New boundaries, handle-only drag/keyboard/cancellation, complete-filter guard, empty/single collections, independent orders/actions/AX/360px, reload/worker/profile restart and full ZIP restore; screenshots ${screenshots}`);
} finally {await chrome.close();await rm(temporary,{recursive:true,force:true});}

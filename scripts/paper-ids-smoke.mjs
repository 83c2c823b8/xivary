import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChromiumTestSession, waitFor } from './chromium-test-session.mjs';

// Production extension, disposable profile, generated Atom/PDF fixtures only.
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'xivary-paper-ids-'));
const screenshots = '/tmp/xivary-paper-id-screenshots';
await mkdir(screenshots, { recursive: true });
const chrome = new ChromiumTestSession(join(temporary, 'profile'));
const client = expression => `(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();return ${expression};})()`;
const modern = { arxivId: '2610.12279v2', title: 'A compact paper identifier fixture', authors: ['Alex Kim'], abstract: 'Fixture abstract.', categories: ['math.SG'], publishedAt: new Date(Date.now() - 86400000).toISOString() };
const legacy = { ...modern, arxivId: 'math/0601001v3', title: 'A legacy paper identifier fixture', publishedAt: '2006-01-01T00:00:00Z' };
const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/${modern.arxivId}</id><title>${modern.title}</title><summary>Fixture abstract.</summary><published>${modern.publishedAt}</published><author><name>Alex Kim</name></author><category term="math.SG"/></entry><entry><id>https://arxiv.org/abs/${legacy.arxivId}</id><title>${legacy.title}</title><summary>Fixture abstract.</summary><published>${legacy.publishedAt}</published><author><name>Alex Kim</name></author><category term="math.SG"/></entry></feed>`;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\ntrailer <</Root 1 0 R>>\n%%EOF\n');
async function verify(page, ids) {
  await chrome.until(page.sessionId, `document.querySelectorAll('.arxiv-id').length===${ids.length}`);
  const rows = await chrome.evaluate(page.sessionId, `Array.from(document.querySelectorAll('.paper-row'),row=>{
    const id=row.querySelector('.arxiv-id'),metadata=id.parentElement,selection=getSelection(),range=document.createRange();
    range.selectNodeContents(id);selection.removeAllRanges();selection.addRange(range);const selected=selection.toString();selection.removeAllRanges();
    return {id:id.textContent,selected,tag:id.tagName,tab:id.tabIndex,role:id.getAttribute('role'),interactive:!!id.closest('a,button,[tabindex],[contenteditable="true"]'),count:row.querySelectorAll('.arxiv-id').length,metadata:metadata.className,paragraphs:row.querySelectorAll('p.metadata').length,font:getComputedStyle(id).fontSize,color:getComputedStyle(id).color,metadataColor:getComputedStyle(metadata).color,cursor:getComputedStyle(id).cursor,title:row.querySelector('h2 a').getAttribute('href'),pdf:row.querySelector('.actions a').textContent,bookmark:!!row.querySelector('.bookmark'),offline:!!row.querySelector('.offline-action')};})`);
  assert.deepEqual(rows.map(row => row.id), ids);
  for (const row of rows) {
    assert.equal(row.selected,row.id); assert.equal(row.tag,'SPAN'); assert.equal(row.tab,-1); assert.equal(row.role,null);
    assert.equal(row.interactive,false); assert.equal(row.count,1); assert.equal(row.metadata,'metadata');
    assert.equal(row.font,'13px'); assert.equal(row.color,row.metadataColor); assert.notEqual(row.cursor,'pointer');
    assert.equal(row.pdf,'PDF'); assert.equal(row.bookmark,true); assert.equal(row.offline,true);
    assert.ok(row.title); assert.equal(row.paragraphs, ids.length === 1 && new URL(page.url).pathname.includes('/feed/') ? 3 : 2);
  }
  const ax = await chrome.send('Accessibility.getFullAXTree',{},page.sessionId);
  for (const id of ids) assert.ok(ax.nodes.some(node => node.role?.value==='StaticText' && node.name?.value===id));
  for (const width of [1280,360]) {
    await chrome.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},page.sessionId);
    assert.equal(await chrome.evaluate(page.sessionId,'document.documentElement.scrollWidth<=innerWidth'),true);
    assert.equal(await chrome.evaluate(page.sessionId,"[...document.querySelectorAll('.arxiv-id')].every(node=>node.getBoundingClientRect().right<=innerWidth)"),true);
    await chrome.evaluate(page.sessionId,'document.fonts.ready');
    const {data}=await chrome.send('Page.captureScreenshot',{},page.sessionId);
    await writeFile(join(screenshots,`${page.label}-${width}.png`),Buffer.from(data,'base64'));
  }
  await chrome.send('Emulation.clearDeviceMetricsOverride',{},page.sessionId);
}
try {
  const {id}=await chrome.send('Extensions.loadUnpacked',{path:join(root,'dist/chromium')});
  console.log((await chrome.send('Browser.getVersion')).product);
  const page = async (path,label) => ({...await chrome.page(`chrome-extension://${id}/src/${path}`),url:`chrome-extension://${id}/src/${path}`,label});
  const library=await page('library/library.html','library');
  await chrome.until(library.sessionId,"document.querySelector('#count')?.textContent==='0 papers'");
  const target=await waitFor(async()=> (await chrome.send('Target.getTargets')).targetInfos.find(item=>item.type==='service_worker'&&item.url.includes(id)),'worker');
  const worker=(await chrome.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  await chrome.send('Fetch.enable',{patterns:[{urlPattern:'https://arxiv.org/*'},{urlPattern:'https://export.arxiv.org/*'}]},worker);
  chrome.listeners.push(message=>{
    if(message.method!=='Fetch.requestPaused'||message.sessionId!==worker)return;
    const url=new URL(message.params.request.url),isApi=url.hostname==='export.arxiv.org',isPdf=url.pathname.startsWith('/pdf/');
    const canonical=url.pathname.replace(/^\/(?:pdf|abs)\//,'').replace(/v\d+$/,'');
    const body=isApi?atom:isPdf?pdf:`<html><body>arXiv:${canonical}v1<a href="https://arxiv.org/pdf/${canonical}v1">PDF</a></body></html>`;
    void chrome.send('Fetch.fulfillRequest',{requestId:message.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:isApi?'application/atom+xml':isPdf?'application/pdf':'text/html'}],body:Buffer.from(body).toString('base64')},worker);
  });
  const setup=await chrome.evaluate(library.sessionId,client(`(async()=>{
    const modern=${JSON.stringify(modern)},legacy=${JSON.stringify(legacy)};
    await repository.savePaper(modern);await repository.savePaper(legacy);
    const collection=await repository.createPaperCollection('ID fixtures',modern);await repository.addPaperToCollection(legacy,collection.id);
    const followed=await repository.followAuthor({displayName:'Alex Kim'});
    const {normalizeApiEntry}=await import('../services/arxiv-paper-service.js');
    const papers=[modern,legacy].map(normalizeApiEntry);
    await repository.putAuthorPaperCache({authorId:followed.id,papers,fetchedAt:new Date().toISOString(),queryUsed:'au:"Alex Kim"'});
    const {emptyQueue,mergeQueue}=await import('../feed/queue.js');const {recommendation}=await import('../feed/discovery.js');
    await repository.putFollowingFeedCache(mergeQueue(emptyQueue(),[{...papers[0],reason:recommendation(papers[0],[followed])}],[followed],[],{now:Date.now()}).queue);
    await repository.saveOfflinePaper(modern,false);await repository.saveOfflinePaper(legacy,false);
    return {collectionId:collection.id,authorId:followed.id};})()`));
  await chrome.send('Page.reload',{},library.sessionId); await verify(library,['arXiv:2610.12279','arXiv:math/0601001']);
  await chrome.click(library.sessionId,`[data-collection-id="${setup.collectionId}"]`);
  library.label='collection';await verify(library,['arXiv:2610.12279','arXiv:math/0601001']);
  const feed=await page('feed/feed.html','feed');await verify(feed,['arXiv:2610.12279']);
  assert.match(await chrome.evaluate(feed.sessionId,"document.querySelector('.arxiv-id').parentElement.textContent"),/^Submitted .* · arXiv:2610\.12279 · math\.SG$/);
  await verify(await page('offline/offline.html','offline'),['arXiv:2610.12279','arXiv:math/0601001']);
  await verify(await page(`author/author.html?authorId=${encodeURIComponent(setup.authorId)}`,'author'),['arXiv:2610.12279','arXiv:math/0601001']);
  const search=await page('search/search.html','search');
  await chrome.until(search.sessionId,"document.querySelector('#field')?.options.length>0");
  await chrome.evaluate(search.sessionId,"document.querySelector('#query').value='identifier fixture';document.querySelector('#query').dispatchEvent(new Event('input',{bubbles:true}))");
  await chrome.click(search.sessionId,'#search-form button[type=submit]');await verify(search,['arXiv:2610.12279','arXiv:math/0601001']);
  // Exercise malformed/missing IDs through the actual shared DOM renderer too.
  await chrome.evaluate(search.sessionId,`(async()=>{const {paperRow}=await import('../ui/paper-row.js');const paper=${JSON.stringify(modern)};
    for(const arxivId of [undefined,'arXiv:arXiv:2610.12279','broken']){const row=paperRow({...paper,arxivId},{showAbstract:false});if(row.querySelector('.arxiv-id'))throw Error('Unreliable ID rendered');}})()`);
  const before=await chrome.evaluate(search.sessionId,'location.href');
  await chrome.click(search.sessionId,'.arxiv-id');assert.equal(await chrome.evaluate(search.sessionId,'location.href'),before);
  console.log(`PAPER IDS PASS: canonical modern/legacy IDs once across Library/collections/Feed/Offline/Author/Search; plain selectable StaticText, unchanged title/PDF/bookmark/Offline controls; 1280px/360px without overflow; screenshots ${screenshots}`);
} finally { await chrome.close();await rm(temporary,{recursive:true,force:true}); }

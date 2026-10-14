import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChromiumTestSession, waitFor } from './chromium-test-session.mjs';

// Installed production build, real repository/IndexedDB, native input. Generated
// Atom/PDF fixtures intercept every request; no credentials or production traffic.
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'xivary-discovery-'));
const screenshots = process.env.ARXIV_SCREENSHOT_DIR || '/tmp/xivary-discovery-screenshots';
await mkdir(screenshots, { recursive: true });
let chrome = new ChromiumTestSession(join(temporary, 'profile'));
const stamp = Date.now(), iso = minutes => new Date(stamp - minutes * 60000).toISOString();
let mode = 'papers', newest = false, requests = [], pdfRequests = 0, extensionId, worker, held;
const client = expression => `(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();return ${expression};})()`;
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const id = index => `2610.${String(index + 1).padStart(5, '0')}`;
function entry(index, { authors = ['Alex Kim'], published = iso(60 + index), version = 1, topic = false, title } = {}) {
  return `<entry><id>https://arxiv.org/abs/${id(index)}v${version}</id><title>${escape(title || (topic ? 'Homological mirror symmetry and symplectic invariants' : `Feed fixture paper ${index}`))}</title><summary>${escape(topic ? 'Fukaya categories and symplectic invariants for homological mirror symmetry.\n\nFixture mathematics $E=mc^2$.' : 'Fixture abstract with $E=mc^2$.\n\nExpanded only on request.')}</summary><published>${published}</published><updated>${iso(0)}</updated>${authors.map(name => `<author><name>${name}</name></author>`).join('')}<category term="math.SG"/></entry>`;
}
function sourceFor(query) {
  const start = query.match(/submittedDate:\[(\d{12})/u)?.[1];
  if (start && Number(start.slice(0, 4)) < new Date(stamp).getUTCFullYear()) return 'evidence';
  return query.includes('cat:') ? 'related' : query.includes('Morgan Scholar') ? 'coauthor' : 'following';
}
function entriesFor(source) {
  if (source === 'evidence') return [entry(9000, { authors: ['Alex Kim', 'Morgan Scholar'], published: iso(100 * 1440), topic: true }), entry(9001, { authors: ['Alex Kim', 'Sam Lee', 'Morgan Scholar'], published: iso(120 * 1440), topic: true }), entry(9002, { authors: ['Morgan Scholar', 'Recursive Stranger'], published: iso(90 * 1440), topic: true })];
  if (mode === 'empty') return [];
  if (source === 'following') {
    const result = Array.from({ length: 67 }, (_, index) => index === 2 ? entry(1, { version: 2, authors: ['Alex Kim', 'Sam Lee'] }) : entry(index, { authors: index === 3 ? ['Alex Sato', 'Ken Kim'] : index === 4 ? ['A. Kim'] : index % 2 ? ['Alex Kim', 'Sam Lee'] : ['Alex Kim'], topic: index === 0 }));
    result.push(entry(8000, { published: '2020-01-01T00:00:00Z' })); // A new revision never makes this recent.
    if (newest) result.unshift(entry(9998, { published: iso(0), title: 'Newest fixture paper' }));
    return result;
  }
  if (source === 'coauthor') return [...Array.from({ length: 6 }, (_, index) => entry(200 + index, { authors: ['Morgan Scholar'], published: iso(20 + index), topic: true })), entry(7000, { authors: ['Recursive Stranger'], title: 'Unrelated clinical result' })];
  return [...Array.from({ length: 10 }, (_, index) => entry(1000 + index, { authors: ['Other Scholar'], published: iso(5 + index), topic: true })), ...Array.from({ length: 20 }, (_, index) => entry(3000 + index, { authors: ['Other Scholar'], title: 'Unrelated category-only construction' })), entry(8000, { authors: ['Other Scholar'], published: '2020-01-01T00:00:00Z', topic: true })];
}
function atom(source, start) {
  const entries = entriesFor(source);
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>${entries.length}</opensearch:totalResults><opensearch:startIndex>${start}</opensearch:startIndex>${entries.slice(start, start + 50).join('')}</feed>`;
}
const pdf = Buffer.from('%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\ntrailer <</Root 1 0 R>>\n%%EOF\n');
async function key(sessionId, key, code, text) {
  for (const type of ['keyDown', 'keyUp']) await chrome.send('Input.dispatchKeyEvent', { type, key, code, ...(type === 'keyDown' && text ? { text } : {}) }, sessionId);
}
async function screenshot(page, name) {
  await chrome.evaluate(page.sessionId, 'document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  const { data } = await chrome.send('Page.captureScreenshot', {}, page.sessionId);
  await writeFile(join(screenshots, name), Buffer.from(data, 'base64'));
}
try {
  extensionId = (await chrome.send('Extensions.loadUnpacked', { path: join(root, 'dist/chromium') })).id;
  console.log((await chrome.send('Browser.getVersion')).product);
  const feed = await chrome.page(`chrome-extension://${extensionId}/src/feed/feed.html`);
  const untilFeed = async expression => {
    try { return await chrome.until(feed.sessionId, `document.querySelector('#refresh') && (${expression})`, 30000); }
    catch(error) { console.log(JSON.stringify({condition:expression,ui:await chrome.evaluate(feed.sessionId,"({status:document.querySelector('#status').textContent,busy:document.querySelector('#refresh').disabled,count:document.querySelector('#count').textContent})"),requests:requests.slice(-8)},null,2));throw error; }
  };
  const ready = () => untilFeed("document.querySelector('#count').textContent==='25 papers' && !document.querySelector('#refresh').disabled");
  const readyIdle = () => untilFeed("!document.querySelector('#refresh').disabled");
  const refreshFeed = async () => {
    // Advance only the disposable worker's clock past the one-minute manual
    // cooldown; production policy and repository mutations remain intact.
    await chrome.evaluate(worker, 'globalThis.feedTestOffset=(globalThis.feedTestOffset||0)+61000;void 0');
    await readyIdle();
    await chrome.click(feed.sessionId, '#refresh');
    await untilFeed("document.querySelector('#refresh').disabled");
  };
  const applyPending = async () => { if (!await chrome.evaluate(feed.sessionId, "document.querySelector('#new-papers').hidden")) await chrome.click(feed.sessionId, '#new-papers'); };
  await untilFeed("!document.querySelector('#empty').hidden");
  assert.match(await chrome.evaluate(feed.sessionId, "document.querySelector('#empty').textContent"), /Follow authors/);
  const target = await waitFor(async () => (await chrome.send('Target.getTargets')).targetInfos.find(item => item.type === 'service_worker' && item.url.includes(extensionId)), 'worker');
  worker = (await chrome.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
  await chrome.send('Runtime.enable', {}, worker);
  // Pause at the existing repository entry point to inject a fixture clock,
  // without replacing Date or altering scheduler time/production build files.
  await chrome.send('Debugger.enable', {}, worker);
  const {breakpointId}=await chrome.send('Debugger.setBreakpointByUrl', {url:`chrome-extension://${extensionId}/src/repository/local-repository.js`,lineNumber:(await readFile(join(root,'dist/chromium/src/repository/local-repository.js'),'utf8')).split('\n').findIndex(line=>line.includes('const result = this.pending.then'))},worker);
  let clockInstalled=false;
  chrome.listeners.push(message=>{
    if(message.method==='Debugger.paused' && message.sessionId===worker) void (async()=>{
      await chrome.send('Debugger.evaluateOnCallFrame',{callFrameId:message.params.callFrames[0].callFrameId,expression:'globalThis.feedTestOffset=0;this.clock=()=>new Date(Date.now()+feedTestOffset).toISOString();void 0'},worker);
      await chrome.send('Debugger.removeBreakpoint',{breakpointId},worker);
      clockInstalled=true; await chrome.send('Debugger.resume',{},worker);
    })();
  });
  await chrome.evaluate(feed.sessionId, client('repository.getFollowingFeedCache()'));
  assert.equal(clockInstalled,true);
  await chrome.send('Fetch.enable', { patterns: [{ urlPattern: 'https://export.arxiv.org/*' }, { urlPattern: 'https://arxiv.org/*' }] }, worker);
  const errors = [];
  chrome.listeners.push(message => {
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method !== 'Fetch.requestPaused' || message.sessionId !== worker) return;
    const url = new URL(message.params.request.url);
    let body, type, responseCode = 200, extraHeaders = [];
    if (url.hostname === 'export.arxiv.org') {
      const query = url.searchParams.get('search_query'), start = Number(url.searchParams.get('start')), source = sourceFor(query);
      requests.push({ source, start, at: Date.now(), query });
      if (mode === 'held') { held = message.params.requestId; return; }
      if (mode === 'offline') { void chrome.send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'InternetDisconnected' }, worker); return; }
      if (mode === 'partial' && source === 'coauthor') responseCode = 503;
      if (mode === 'rate') { responseCode = 429; extraHeaders = [{ name: 'Retry-After', value: '130' }]; }
      body = mode === 'invalid' ? '<html>Not Atom</html>' : atom(source, start); type = 'application/atom+xml';
    } else if (url.pathname.startsWith('/pdf/')) { pdfRequests++; body = pdf; type = 'application/pdf'; }
    else { const paperId = url.pathname.slice('/abs/'.length); body = `<html><body>arXiv:${paperId}v1<a href="https://arxiv.org/pdf/${paperId}v1">PDF</a></body></html>`; type = 'text/html'; }
    void chrome.send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode, responseHeaders: [{ name: 'Content-Type', value: type }, ...extraHeaders], body: Buffer.from(body).toString('base64') }, worker);
  });
  await chrome.evaluate(feed.sessionId, client("Promise.all([repository.followAuthor({displayName:'Alex Kim'}),repository.followAuthor({displayName:'Sam Lee'})])"));
  await chrome.send('Page.reload', {}, feed.sessionId); await ready();
  assert.deepEqual(requests.map(item => item.source), ['following', 'evidence', 'following', 'coauthor', 'related']);
  for (let index = 1; index < requests.length; index++) assert.ok(requests[index].at - requests[index - 1].at >= 2900);
  assert.equal((await chrome.evaluate(feed.sessionId, client('repository.listFavorites()'))).length, 0);
  assert.equal((await chrome.evaluate(feed.sessionId, client('repository.getOfflineLibrary()'))).copies.length, 0); assert.equal(pdfRequests, 0);
  const rows = await chrome.evaluate(feed.sessionId, "[...document.querySelectorAll('.paper-row')].map(row=>({id:row.dataset.arxivId,reason:row.querySelector('.feed-match').textContent,authors:row.querySelector('.metadata').textContent,date:row.querySelectorAll('.metadata')[1].textContent}))");
  assert.equal(new Set(rows.map(row => row.id)).size, 25);
  assert.equal(rows.filter(row => row.reason.startsWith('Related:')).length, 5);
  const coauthorRow = rows.find(row => row.reason==='Coauthor of Alex Kim'); assert.ok(coauthorRow); assert.equal(coauthorRow.authors, 'Morgan Scholar');
  assert.ok(!rows.some(row => [id(3), id(4), id(7000), id(8000)].includes(row.id)));
  const follows = await chrome.evaluate(feed.sessionId, client('repository.listFollowing()')); assert.equal(follows.length, 2); assert.ok(!follows.some(item => item.displayName==='Morgan Scholar'));
  assert.equal(await chrome.evaluate(feed.sessionId, "document.querySelectorAll('details[open],.abstract').length"), 0);
  await chrome.send('Page.bringToFront', {}, feed.sessionId);
  await chrome.evaluate(feed.sessionId, "document.querySelector('summary').focus()"); await key(feed.sessionId, 'Enter', 'Enter', '\r');
  await untilFeed("document.querySelector('details').open && !!document.querySelector('.abstract')");
  const ax = await chrome.send('Accessibility.getFullAXTree', {}, feed.sessionId);
  assert.ok(ax.nodes.some(node => node.role?.value === 'DisclosureTriangle' && /Abstract:/.test(node.name?.value)));
  await screenshot(feed, 'discovery-expanded.png'); await key(feed.sessionId, 'Enter', 'Enter', '\r');
  const savedId = rows[0].id, offlineOnlyId = rows[1].id;
  await chrome.evaluate(feed.sessionId, "globalThis.firstRow=document.querySelector('.paper-row')");
  await chrome.click(feed.sessionId, '.paper-row .bookmark');
  await untilFeed("document.querySelector('.bookmark').getAttribute('aria-pressed')==='true'");
  assert.equal(await chrome.evaluate(feed.sessionId, 'firstRow===document.querySelector(".paper-row")'), true);
  assert.equal(await chrome.evaluate(feed.sessionId, "document.querySelectorAll('.paper-row').length"), 25, 'Bookmarking must not remove a visible row');
  await chrome.click(feed.sessionId, '.paper-row .bookmark'); await untilFeed("!!document.querySelector('.arxiv-collection-picker')"); await key(feed.sessionId, 'Escape', 'Escape');
  await untilFeed("!document.querySelector('.arxiv-collection-picker')");
  await chrome.click(feed.sessionId, '.paper-row .offline-action'); await untilFeed("document.querySelector('.offline-action').dataset.state==='saved'");
  await chrome.click(feed.sessionId, '.paper-row:nth-child(2) .offline-action'); await untilFeed("document.querySelector('.paper-row:nth-child(2) .offline-action').dataset.state==='saved'");
  assert.equal(pdfRequests, 2); assert.equal((await chrome.evaluate(feed.sessionId, client('repository.listFavorites()'))).length, 1);
  await chrome.click(feed.sessionId, '#more'); await untilFeed("document.querySelector('#count').textContent==='50 papers' && !document.querySelector('#refresh').disabled");
  assert.equal(await chrome.evaluate(feed.sessionId, "document.activeElement===document.querySelectorAll('.paper-row h2 a')[25]"), true);
  assert.deepEqual(requests.filter(item => item.source==='following').map(item => item.start), [0, 50], 'Buffered candidates fill the second page without a new request');
  await chrome.click(feed.sessionId, '#more'); await untilFeed("!document.querySelector('#end').hidden && document.querySelector('#more').hidden");
  assert.equal(await chrome.evaluate(feed.sessionId, "document.querySelectorAll('.paper-row').length"), 75);
  assert.deepEqual(requests.filter(item => item.source==='following').map(item => item.start), [0, 50]);
  assert.match(await chrome.evaluate(feed.sessionId, "document.querySelector('#end').textContent"), /coverage is incomplete/);
  const beforeRefresh = requests.length;
  await refreshFeed(); await readyIdle();
  assert.equal(requests.slice(beforeRefresh).filter(item => item.source==='evidence').length, 0, 'Fresh coauthor evidence avoids history requests');
  assert.equal(await chrome.evaluate(feed.sessionId, `!!document.querySelector('[data-arxiv-id="${savedId}"]')`), true, 'Refresh stages changes while reading');
  const queueAfterBookmark = await chrome.evaluate(feed.sessionId, client('repository.getFollowingFeedCache()'));
  assert.ok(!queueAfterBookmark.entries.some(paper=>paper.arxivId===savedId));
  await applyPending();
  assert.equal(await chrome.evaluate(feed.sessionId, `!!document.querySelector('[data-arxiv-id="${savedId}"]')`), false);
  assert.equal(await chrome.evaluate(feed.sessionId, `!!document.querySelector('[data-arxiv-id="${offlineOnlyId}"]')`), true);
  newest = true;
  const retainedIds = queueAfterBookmark.entries.map(paper=>paper.arxivId);
  await chrome.evaluate(feed.sessionId, "document.querySelector('details').open=true;globalThis.readingRow=document.querySelector('.paper-row');readingRow.scrollIntoView();globalThis.readingOffset=readingRow.getBoundingClientRect().top");
  await refreshFeed(); await readyIdle();
  assert.equal(await chrome.evaluate(feed.sessionId, 'readingRow===document.querySelector(".paper-row")'), true);
  assert.equal(await chrome.evaluate(feed.sessionId, "document.querySelector('details').open"), true);
  const incremented = await chrome.evaluate(feed.sessionId, client('repository.getFollowingFeedCache()'));
  assert.equal(incremented.entries[0].arxivId, id(9998));
  assert.ok(retainedIds.every(value=>incremented.entries.some(paper=>paper.arxivId===value)));
  await applyPending();
  assert.equal(await chrome.evaluate(feed.sessionId, "document.querySelector('.paper-row').dataset.arxivId"), id(9998));
  await screenshot(feed, 'discovery.png');
  mode = 'offline'; const beforeOffline = requests.length;
  await chrome.send('Page.reload', {}, feed.sessionId); await ready(); assert.equal(requests.length, beforeOffline, 'Fresh Feed opening makes zero arXiv requests');
  await refreshFeed(); await untilFeed("document.querySelector('#status').classList.contains('error') && !document.querySelector('#refresh').disabled");
  assert.equal(await chrome.evaluate(feed.sessionId, "document.querySelector('.paper-row').dataset.arxivId"), id(9998));
  await screenshot(feed, 'discovery-offline.png');
  const blockedRequests = requests.length;
  await chrome.click(feed.sessionId, '#refresh'); await readyIdle(); assert.equal(requests.length, blockedRequests, 'Failure backoff blocks repeated clicks');
  mode = 'papers';
  await chrome.evaluate(worker, 'feedTestOffset+=11*60000;void 0');
  await refreshFeed(); await readyIdle();
  // Empty new-paper responses retain the queue rather than regenerate it.
  mode = 'empty'; const beforeEmpty = await chrome.evaluate(feed.sessionId, client('repository.getFollowingFeedCache()'));
  await refreshFeed(); await readyIdle();
  assert.deepEqual((await chrome.evaluate(feed.sessionId, client('repository.getFollowingFeedCache()'))).entries, beforeEmpty.entries);
  mode = 'papers';
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 1, mobile: false }, feed.sessionId);
  assert.equal(await chrome.evaluate(feed.sessionId, 'document.documentElement.scrollWidth<=innerWidth'), true); await screenshot(feed, 'discovery-narrow.png');
  await chrome.send('Emulation.clearDeviceMetricsOverride', {}, feed.sessionId);
  const lib = await chrome.page(`chrome-extension://${extensionId}/src/library/library.html`); await chrome.until(lib.sessionId, "document.querySelectorAll('.paper-row').length===1");
  const following = await chrome.page(`chrome-extension://${extensionId}/src/authors/authors.html`); await chrome.until(following.sessionId, "document.querySelectorAll('.author-row').length===2");
  const offline = await chrome.page(`chrome-extension://${extensionId}/src/offline/offline.html`); await chrome.until(offline.sessionId, "document.querySelectorAll('.paper-row').length===2");
  await chrome.send('Page.bringToFront', {}, feed.sessionId);
  console.log('Queue/bookmark/offline/local pagination/failure backoff verified');
  mode = 'partial'; const beforePartial = await chrome.evaluate(feed.sessionId, client('repository.getFollowingFeedCache()'));
  await refreshFeed(); await untilFeed("document.querySelector('#status').classList.contains('error') && !document.querySelector('#refresh').disabled");
  const partial = await chrome.evaluate(feed.sessionId, client('repository.getFollowingFeedCache()'));
  assert.equal(partial.partial,true); assert.equal(partial.lastSuccessAt,beforePartial.lastSuccessAt);
  assert.deepEqual(partial.entries,beforePartial.entries);
  await chrome.evaluate(worker,'feedTestOffset+=6*60000;void 0');
  mode = 'held'; const previous = await chrome.evaluate(feed.sessionId, client('repository.getFollowingFeedCache()'));
  await refreshFeed(); await waitFor(() => held, 'held query');
  const second = await chrome.page(`chrome-extension://${extensionId}/src/feed/feed.html`);
  await chrome.until(second.sessionId, "document.querySelectorAll('.paper-row').length===25 && !document.querySelector('#refresh').disabled");
  const concurrentRequests = requests.length;
  await chrome.click(second.sessionId, '#refresh'); await chrome.until(second.sessionId, "document.querySelector('#refresh').disabled");
  assert.equal(requests.length, concurrentRequests, 'Second view waits on the shared lock');
  await chrome.send('Fetch.fulfillRequest', { requestId: held, responseCode: 200, responseHeaders: [{name:'Content-Type',value:'application/atom+xml'}],body:Buffer.from(atom('following',0)).toString('base64') }, worker); held = null; mode = 'papers';
  await readyIdle(); await chrome.until(second.sessionId, "!document.querySelector('#refresh').disabled");
  assert.equal(requests.length, concurrentRequests+3, 'Concurrent view does not start a second discovery cycle');
  await chrome.send('Target.closeTarget', {targetId:second.targetId});
  mode='rate'; const beforeRate=await chrome.evaluate(feed.sessionId,client('repository.getFollowingFeedCache()'));
  await refreshFeed(); await untilFeed("document.querySelector('#status').classList.contains('error') && !document.querySelector('#refresh').disabled");
  assert.deepEqual(await chrome.evaluate(feed.sessionId,client('repository.getFollowingFeedCache()')),beforeRate);
  mode='papers';
  // Expiration is based on original timestamps, including after restart.
  await chrome.evaluate(feed.sessionId, client("(async()=>{const q=await repository.getFollowingFeedCache();const old={...q.entries.at(-1),publishedAt:new Date(Date.now()-31*86400000).toISOString()};q.entries[q.entries.length-1]=old;await repository.putFollowingFeedCache(q);return old.arxivId;})()"));
  const pruned = await chrome.evaluate(feed.sessionId, client('repository.getFollowingFeedCache()'));
  assert.equal(pruned.entries.length, previous.entries.length-1);
  const retained = pruned.entries.map(paper=>paper.arxivId);
  await chrome.send('ServiceWorker.enable', {}, feed.sessionId);
  await chrome.send('ServiceWorker.stopAllWorkers', {}, feed.sessionId);
  assert.deepEqual((await chrome.evaluate(feed.sessionId, client('repository.getFollowingFeedCache()'))).entries.map(paper=>paper.arxivId), retained);
  await chrome.close();
  chrome = new ChromiumTestSession(join(temporary, 'profile'));
  const restartedId = (await chrome.send('Extensions.loadUnpacked', {path:join(root,'dist/chromium')})).id;
  assert.equal(restartedId, extensionId);
  const restarted = await chrome.page(`chrome-extension://${extensionId}/src/feed/feed.html`);
  await chrome.until(restarted.sessionId, "document.querySelectorAll('.paper-row').length===25 && !document.querySelector('#refresh').disabled");
  assert.deepEqual((await chrome.evaluate(restarted.sessionId, client('repository.getFollowingFeedCache()'))).entries.map(paper=>paper.arxivId), retained);
  const settings = await chrome.page(`chrome-extension://${extensionId}/src/settings/settings.html`);
  await chrome.until(settings.sessionId, "document.querySelector('#latex-macros') && !document.querySelector('#latex-macros').disabled");
  assert.equal(await chrome.evaluate(settings.sessionId, "document.querySelector('#latex-macros').getAttribute('placeholder')"), String.raw`\Hom = \operatorname{Hom}`);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('INCREMENTAL FEED PASS: demand/cooldown, persistent queue, staging, concurrent views, worker suspension/browser restart, TeX example; UTC/revisions, followed/direct coauthor/category contributions and noise limits, one-hop identity, native abstract/AX/picker/actions, bookmark refresh stability, offline independence, filtered pagination/end/budgets/pacing, cache expiration/disconnection, partial/rate retention, narrow UI and Library/Following/Offline regressions');
  console.log(`Screenshots: ${screenshots}`);
} finally { await chrome.close(); await rm(temporary, { recursive: true, force: true }); }

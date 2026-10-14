import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect } from 'node:net';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChromiumTestSession, waitFor } from './chromium-test-session.mjs';

// Local TLS fixtures only. No request reaches production arXiv and no credentials.
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'xivary-arxiv-loading-'));
const sockets = new Set(), calls = [], timers = new Set(), errors = [];
const later = (fn, ms) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); };
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const key = join(temporary, 'key.pem'), cert = join(temporary, 'cert.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=export.arxiv.org'], { stdio: 'ignore' });
const open = '<feed xmlns="http://www.w3.org/2005/Atom">', close = '</feed>';
const entry = (index, author = 'Stream Author') => `<entry><id>https://arxiv.org/abs/2401.${String(index).padStart(5, '0')}</id><title>Paper ${index}</title><summary>Fixture abstract $x^2$.</summary><published>2026-10-${String(30 - Math.min(index, 29)).padStart(2, '0')}T00:00:00Z</published><author><name>${author}</name></author><category term="math.AG"/></entry>`;
const first = open + Array.from({ length: 30 }, (_, i) => entry(i)).join('');
const tail = entry(0) + Array.from({ length: 19 }, (_, i) => entry(i + 30)).join('') + close;
let secondAttempts = 0, interruptedAttempts = 0, failRefresh = false;
const secure = httpsServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
  const url = new URL(request.url, 'https://export.arxiv.org');
  const query = url.searchParams.get('search_query'); calls.push({ query, at: Date.now() });
  if (query?.includes('Second Author') && ++secondAttempts === 1) {
    response.writeHead(429, { 'Retry-After': '2' }); response.end('Rate exceeded.'); return;
  }
  response.writeHead(200, { 'Content-Type': 'application/atom+xml' });
  if (query?.includes('Stream Author') || query === 'baseline') {
    later(() => {
      if (response.destroyed) return;
      response.write(first);
      later(() => failRefresh ? response.destroy() : response.end(tail), 1600);
    }, 100);
  } else if (query?.includes('Interrupted Author')) {
    interruptedAttempts++;
    response.write(open + entry(1, 'Interrupted Author') + (interruptedAttempts === 1 ? entry(2, 'Interrupted Author') : '')); later(() => response.destroy(), 400);
  } else response.end(open + entry(1, 'Second Author') + close);
});
const securePort = await listen(secure);
const proxy = httpServer((request, response) => { response.writeHead(502); response.end(); });
proxy.on('connect', (request, socket, head) => {
  if (request.url !== 'export.arxiv.org:443') { socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return; }
  const upstream = connect(securePort, '127.0.0.1', () => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    socket.pipe(upstream); upstream.pipe(socket);
  });
  sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
});
proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
const proxyPort = await listen(proxy);
const chrome = new ChromiumTestSession(join(temporary, 'profile'), [`--proxy-server=http://127.0.0.1:${proxyPort}`, '--ignore-certificate-errors']);
const rpc = operation => `(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();return ${operation};})()`;
try {
  chrome.listeners.push(message => {
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params);
  });
  const { id } = await chrome.send('Extensions.loadUnpacked', { path: join(root, 'extension') });
  const authorPage = async name => {
    const page = await chrome.page(`chrome-extension://${id}/src/author/author.html?name=${encodeURIComponent(name)}`);
    await chrome.until(page.sessionId, `document.querySelector('#name')?.textContent===${JSON.stringify(name)}`);
    return page;
  };
  const baseline = await chrome.page(`chrome-extension://${id}/src/settings/settings.html`);
  const baselineMs = await chrome.evaluate(baseline.sessionId, `(async()=>{const start=performance.now();await fetch('https://export.arxiv.org/api/query?search_query=baseline').then(response=>response.text());return Math.round(performance.now()-start);})()`);
  const started = Date.now();
  const author = await authorPage('Stream Author');
  const session = author.sessionId;
  await chrome.until(session, "document.querySelectorAll('.paper-row').length===30 && document.querySelector('#status').textContent.includes('incomplete')");
  const firstVisibleMs = Date.now() - started;
  assert.ok(firstVisibleMs < baselineMs, { firstVisibleMs, baselineMs });
  assert.equal(await chrome.evaluate(session, rpc("repository.getAuthorPaperCache('arxiv-author:name:v1:stream%20author')")), null);
  await chrome.click(session, '#show-filters');
  await chrome.send('Input.insertText', { text: 'Paper 1' }, session);
  await chrome.until(session, "document.querySelectorAll('.paper-row').length===12 && document.querySelector('#status').textContent.includes('incomplete')");
  await chrome.evaluate(session, "document.querySelector('#paper-query').value='';document.querySelector('#paper-query').dispatchEvent(new Event('input',{bubbles:true}))");
  await chrome.click(session, '.paper-row .bookmark');
  await chrome.until(session, "document.querySelector('.paper-row .bookmark').getAttribute('aria-pressed')==='true' && document.querySelector('#status').textContent.includes('incomplete')");
  await chrome.evaluate(session, 'document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  await chrome.evaluate(session, "window.firstPaper=document.querySelector('.paper-row');window.firstSection=document.querySelector('.year-group');scrollTo(0,300);window.firstScroll=scrollY");
  const second = await authorPage('Second Author');
  const cancelled = await authorPage('Cancelled Author');
  await chrome.send('Target.closeTarget', { targetId: cancelled.targetId });
  await chrome.until(session, "document.querySelectorAll('.paper-row').length===49 && !document.querySelector('#refresh').disabled && document.querySelector('#updated').textContent");
  const completeMs = Date.now() - started;
  const stability = await chrome.evaluate(session, "({row:document.querySelector('.paper-row')===window.firstPaper,section:document.querySelector('.year-group')===window.firstSection,scroll:scrollY,before:window.firstScroll})");
  assert.ok(stability.row && stability.section && stability.scroll===stability.before, JSON.stringify(stability));
  assert.deepEqual(await chrome.evaluate(session, "[...document.querySelectorAll('.paper-row h2 a')].map(node=>node.textContent)"), Array.from({ length: 49 }, (_, i) => `Paper ${i}`));
  const versions = new Map();
  chrome.listeners.push(message => {
    if (message.method === 'ServiceWorker.workerVersionUpdated') for (const version of message.params.versions) versions.set(version.versionId, version);
  });
  await chrome.send('ServiceWorker.enable', {}, session);
  await chrome.until(second.sessionId, "document.querySelector('#status').textContent.includes('rate limit')");
  const cooldown = await chrome.evaluate(second.sessionId, "chrome.storage.local.get('arxivResearchLibrary').then(values=>values.arxivResearchLibrary._arxivApi.until)");
  const version = await waitFor(() => [...versions.values()].find(item => item.scriptURL.includes(id) && item.runningStatus === 'running'), 'scheduler worker version');
  await chrome.send('ServiceWorker.stopWorker', { versionId: version.versionId }, session);
  await chrome.until(second.sessionId, "document.querySelector('#status').classList.contains('error') && !document.querySelector('#refresh').disabled");
  await chrome.send('Page.reload', {}, second.sessionId);
  await chrome.until(second.sessionId, "document.querySelector('.paper-row') && !document.querySelector('#refresh').disabled");
  assert.ok(calls.filter(call => call.query?.includes('Second Author'))[1].at >= cooldown - 50, 'replacement worker retains server cooldown; stale queue is not replayed');
  assert.equal(calls.some(call => call.query?.includes('Cancelled Author')), false);
  const scheduled = calls.filter(call => call.query !== 'baseline');
  const gaps = scheduled.slice(1).map((call, index) => call.at - scheduled[index].at);
  assert.ok(gaps.every(gap => gap >= 2950), JSON.stringify(gaps)); // native transport timing tolerance, deterministic tests require exact 3000
  const cache = await chrome.evaluate(session, rpc("repository.getAuthorPaperCache('arxiv-author:name:v1:stream%20author')"));
  assert.equal(cache.papers.length, 49);
  await chrome.send('Page.bringToFront', {}, session);
  assert.equal(await chrome.evaluate(session, rpc('repository.listFavorites().then(papers=>papers.length)')), 1);
  await chrome.click(session, '#show-filters');
  await chrome.send('Input.insertText', { text: 'Paper 48' }, session);
  await chrome.until(session, "document.querySelectorAll('.paper-row').length===1");
  await chrome.evaluate(session, "document.querySelector('#paper-query').value='';document.querySelector('#paper-query').dispatchEvent(new Event('input',{bubbles:true}))");
  const partial = await authorPage('Interrupted Author');
  await chrome.until(partial.sessionId, "document.querySelector('.paper-row') && document.querySelector('#status').classList.contains('error')");
  assert.equal(await chrome.evaluate(partial.sessionId, "document.querySelector('#empty').hidden && !document.querySelector('#updated').textContent"), true);
  assert.equal(await chrome.evaluate(partial.sessionId, rpc("repository.getAuthorPaperCache('arxiv-author:name:v1:interrupted%20author')")), null);
  assert.equal(await chrome.evaluate(partial.sessionId, "document.querySelectorAll('.paper-row').length"), 2);
  await chrome.click(partial.sessionId, '#refresh');
  await chrome.until(partial.sessionId, "document.querySelector('#status').classList.contains('error') && !document.querySelector('#refresh').disabled");
  assert.equal(await chrome.evaluate(partial.sessionId, "document.querySelectorAll('.paper-row').length"), 2, 'failed retry with a smaller prefix retains previously usable partial results');
  failRefresh = true;
  await chrome.send('Page.bringToFront', {}, session); await chrome.click(session, '#refresh');
  await chrome.until(session, "document.querySelector('#status').classList.contains('error') && !document.querySelector('#refresh').disabled");
  assert.deepEqual(await chrome.evaluate(session, rpc("repository.getAuthorPaperCache('arxiv-author:name:v1:stream%20author')")), cache);
  assert.equal(await chrome.evaluate(session, "document.querySelectorAll('.paper-row').length"), 49);
  const search = await chrome.page(`chrome-extension://${id}/src/search/search.html`);
  await chrome.until(search.sessionId, "document.readyState==='complete' && document.querySelector('#field').options.length>0");
  await chrome.click(search.sessionId, '#query');
  await chrome.send('Input.insertText', { text: 'obsolete request' }, search.sessionId);
  await chrome.click(search.sessionId, 'button[type=submit]');
  await chrome.until(search.sessionId, "document.querySelector('#status').textContent.includes('Waiting')");
  await chrome.evaluate(search.sessionId, "document.querySelector('#query').value='';document.querySelector('#query').dispatchEvent(new Event('input',{bubbles:true}))");
  await chrome.click(search.sessionId, '#query');
  await chrome.send('Input.insertText', { text: 'current request' }, search.sessionId);
  await chrome.click(search.sessionId, 'button[type=submit]');
  await chrome.until(search.sessionId, "document.querySelector('.paper-row') && !document.querySelector('#status').textContent");
  assert.equal(calls.some(call => call.query?.includes('obsolete request')), false, 'query change removes obsolete queued Search work');
  assert.equal(await chrome.evaluate(search.sessionId, "document.querySelectorAll('.paper-row .actions a').length===1 && document.querySelector('.paper-row .actions a').textContent==='PDF'"), true);
  const screenshotDirectory = process.env.ARXIV_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    await mkdir(screenshotDirectory, { recursive: true });
    for (const [page, name] of [[author, 'arxiv-stream-cached-failure.png'], [partial, 'arxiv-stream-partial.png']]) {
      await chrome.send('Page.bringToFront', {}, page.sessionId);
      const { data } = await chrome.send('Page.captureScreenshot', { format: 'png' }, page.sessionId);
      await writeFile(join(screenshotDirectory, name), Buffer.from(data, 'base64'));
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ fixtureOnly: true, baselineVisibleMs: baselineMs, progressiveFirstVisibleMs: firstVisibleMs, completeMs, requestsPerSuccessfulAuthor: 1, secondAuthorAttempts: secondAttempts, minimumIntervalMs: Math.min(...gaps) }));
  console.log('ARXIV LOADING PASS: installed Chrome, streamed rows/order/scroll, shared second-author 429 retry/worker restart, queued-close and Search-query cancellation, partial/no cache, cached refresh preservation, filtering and bookmarks; no production traffic');
} finally {
  await chrome.close(); for (const timer of timers) clearTimeout(timer);
  for (const socket of sockets) socket.destroy();
  await Promise.all([new Promise(resolve => secure.close(resolve)), new Promise(resolve => proxy.close(resolve))]);
  await rm(temporary, { recursive: true, force: true });
}

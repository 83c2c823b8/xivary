import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChromiumTestSession, waitFor } from './chromium-test-session.mjs';

// Explicit live-network check: no fixtures, credentials, ordinary profiles or PDF
// downloads. A disposable bookmark verifies UI stability. API calls use the
// production paced transport.
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'xivary-discovery-live-'));
const screenshots = process.env.ARXIV_SCREENSHOT_DIR || '/tmp/xivary-discovery-live';
const authors = process.env.XIVARY_FEED_AUTHORS ? JSON.parse(process.env.XIVARY_FEED_AUTHORS) : ['Michael Brandenbursky', 'Sebastian Opper', 'Atsushi Takahashi'];
assert.ok(Array.isArray(authors) && authors.length && authors.length <= 40 && authors.every(name => typeof name === 'string'));
let chrome = new ChromiumTestSession(join(temporary, 'profile'));
const errors = [], requests = [];
const client = expression => `(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();return ${expression};})()`;
try {
  const { id } = await chrome.send('Extensions.loadUnpacked', { path: join(root, 'dist/chromium') });
  console.log((await chrome.send('Browser.getVersion')).product);
  const setup = await chrome.page(`chrome-extension://${id}/src/authors/authors.html`);
  await chrome.until(setup.sessionId, "document.querySelector('#authors') && document.readyState==='complete'");
  await chrome.evaluate(setup.sessionId, client(`Promise.all(${JSON.stringify(authors)}.map(displayName=>repository.followAuthor({displayName})))`));
  const target = await waitFor(async () => (await chrome.send('Target.getTargets')).targetInfos.find(item => item.type === 'service_worker' && item.url.includes(id)), 'worker');
  const { sessionId } = await chrome.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await chrome.send('Network.enable', {}, sessionId); await chrome.send('Runtime.enable', {}, sessionId);
  chrome.listeners.push(message => {
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Network.requestWillBeSent' && message.sessionId === sessionId && /arxiv\.org/u.test(message.params.request.url)) requests.push(message.params.request.url);
  });
  const feed = await chrome.page(`chrome-extension://${id}/src/feed/feed.html`);
  await chrome.until(feed.sessionId, "document.querySelector('#updated')?.textContent || document.querySelector('#status')?.classList.contains('error')", 190000);
  await chrome.until(feed.sessionId, "!document.querySelector('#refresh').disabled", 190000);
  const state = await chrome.evaluate(feed.sessionId, client(`(async()=>{const queue=await repository.getFollowingFeedCache();const evidence=await repository.getFollowingFeedEvidence();const followed=await repository.listFollowing();const {recentWindow,discoverCoauthors}=await import('./discovery.js');return {status:document.querySelector('#status').textContent,window:recentWindow(queue.lastCycleAt),truncated:queue.truncated,contributions:Object.fromEntries(['following','coauthor','related'].map(source=>[source,queue.entries.filter(paper=>paper.reason.source===source).length])),relationships:discoverCoauthors(evidence.papers,followed,queue.lastCycleAt).relationships.map(item=>({name:item.displayName,count:item.totalEvidence,evidence:item.evidence.map(value=>({arxivId:value.arxivId,publishedAt:value.publishedAt}))})),papers:queue.entries.map(paper=>({arxivId:paper.arxivId,versionedId:paper.versionedId,title:paper.title,authors:paper.authors,publishedAt:paper.publishedAt,reason:paper.reason.label,detail:paper.reason.detail})),bookmarks:(await repository.listFavorites()).length,offline:(await repository.getOfflineLibrary()).copies.length};})()`));
  console.log(JSON.stringify({ followedAuthors: authors, ...state, networkRequests: requests.length }, null, 2));
  await mkdir(screenshots, { recursive: true });
  await chrome.evaluate(feed.sessionId, 'document.fonts.ready');
  const { data } = await chrome.send('Page.captureScreenshot', {}, feed.sessionId);
  await writeFile(join(screenshots, 'discovery-live.png'), Buffer.from(data, 'base64'));
  assert.equal(state.bookmarks, 0); assert.equal(state.offline, 0);
  assert.ok(!requests.some(url => url.includes('/pdf/')));
  assert.equal(errors.length, 0, JSON.stringify(errors));
  if (/failed|Could not|Partial|unavailable/i.test(state.status)) throw new Error(`Live API unavailable: ${state.status}`);
  for (const paper of state.papers) assert.ok(Date.parse(paper.publishedAt) >= Date.parse(state.window.start) && Date.parse(paper.publishedAt) <= Date.parse(state.window.end));
  const independent = state.papers.find(paper => paper.reason.startsWith('Coauthor of ') && !paper.authors.some(name => authors.includes(name)));
  assert.ok(independent, 'Live verification needs a recent coauthor paper without a followed author; inspect actual results, never invent a match.');
  const beforeFresh = requests.length;
  await chrome.send('Page.reload', {}, feed.sessionId);
  await chrome.until(feed.sessionId, "document.querySelectorAll('.paper-row').length>0 && !document.querySelector('#refresh').disabled");
  assert.equal(requests.length, beforeFresh, 'Fresh opening must not contact arXiv');
  await chrome.click(feed.sessionId, '.paper-row .bookmark');
  await chrome.until(feed.sessionId, "document.querySelector('.bookmark').getAttribute('aria-pressed')==='true'");
  assert.equal(await chrome.evaluate(feed.sessionId, "document.querySelectorAll('.paper-row').length"), state.papers.length);
  // Controlled prior-state aging exercises a due cycle against LIVE metadata.
  // No future submission or paper/relationship/date is fabricated.
  await chrome.evaluate(feed.sessionId, client("(async()=>{const q=await repository.getFollowingFeedCache();const newest=q.entries.at(-1);q.entries=q.entries.filter(item=>item.arxivId!==newest.arxivId);q.seen=q.seen.filter(item=>item.arxivId!==newest.arxivId);q.lastSuccessAt=new Date(Date.now()-29*86400000).toISOString();await repository.putFollowingFeedCache(q);return null;})()"));
  const queueBeforeDue = await chrome.evaluate(feed.sessionId, client('repository.getFollowingFeedCache()'));
  // Respect the real manual cooldown without bypassing server Retry-After.
  await new Promise(resolve=>setTimeout(resolve, 60000));
  await chrome.send('Page.reload', {}, feed.sessionId);
  await chrome.until(feed.sessionId, "document.querySelector('#updated')?.textContent && !document.querySelector('#refresh').disabled", 190000);
  const queueAfterDue = await chrome.evaluate(feed.sessionId, client('repository.getFollowingFeedCache()'));
  assert.ok(Date.parse(queueAfterDue.lastSuccessAt)>Date.parse(queueBeforeDue.lastSuccessAt));
  assert.ok(queueBeforeDue.entries.filter(paper=>paper.arxivId!==state.papers[0].arxivId).every(paper=>queueAfterDue.entries.some(item=>item.arxivId===paper.arxivId)), 'Live refresh retains existing entries');
  assert.equal((await chrome.evaluate(feed.sessionId, client('repository.listFavorites()'))).length, 1);
  assert.ok(queueAfterDue.entries.some(paper=>paper.arxivId===state.papers.at(-1).arxivId), 'Due cycle adds the withheld real candidate');
  // Saved paper is removed at this cycle; permanent Library state remains independent.
  const bookmarked = state.papers[0].arxivId;
  assert.ok(!queueAfterDue.entries.some(paper=>paper.arxivId===bookmarked));
  const ids = queueAfterDue.entries.map(paper=>paper.arxivId);
  await chrome.close(); chrome=new ChromiumTestSession(join(temporary,'profile'));
  const restartedId=(await chrome.send('Extensions.loadUnpacked',{path:join(root,'dist/chromium')})).id; assert.equal(restartedId,id);
  const restarted=await chrome.page(`chrome-extension://${id}/src/feed/feed.html`);
  await chrome.until(restarted.sessionId, "document.querySelector('#updated')?.textContent && !document.querySelector('#refresh').disabled");
  assert.deepEqual((await chrome.evaluate(restarted.sessionId, client('repository.getFollowingFeedCache()'))).entries.map(paper=>paper.arxivId),ids);
  console.log(`LIVE INCREMENTAL PASS: ${independent.arxivId}: ${independent.title}; ${independent.reason}; ${requests.length} HTTP requests; fresh opening/retention/bookmark stability/browser restart; screenshot ${screenshots}/discovery-live.png`);
} finally { await chrome.close(); await rm(temporary, { recursive: true, force: true }); }

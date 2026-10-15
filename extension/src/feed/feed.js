import { RepositoryClient } from '../repository/repository-client.js';
import { FEED_PAGE_SIZE } from '../services/following-feed.js';
import { refreshFollowingFeed } from '../services/feed-refresh.js';
import { emptyQueue, pruneQueue, updatedLabel, discoveryDue } from './queue.js';
import { DAY, RECENT_DAYS } from './discovery.js';
import { createAbstractRenderer } from '../ui/abstract.js';
import { paperRow, setBookmarkState } from '../ui/paper-row.js';
import { openPaperCollectionPicker } from '../ui/paper-collection-picker.js';
import { bindVimMode } from '../ui/vim-mode.js';

const repository = new RepositoryClient();
bindVimMode(repository);
const element = id => document.getElementById(id);
let authors = [], preferences = {}, savedIds = new Set(), queue = emptyQueue(), latestQueue = queue, pendingQueue = null;
let count = FEED_PAGE_SIZE, busy = false, localRevision = 0, controller, initialized = false, ageTimer;
const rows = new Map();
element('refresh').addEventListener('click', () => void retrieve(true));
element('new-papers').addEventListener('click', () => {
  const anchor = [...element('papers').children].find(node => node.getBoundingClientRect().bottom > 0);
  const offset = anchor?.getBoundingClientRect().top, atTop = window.scrollY < 20;
  queue = pendingQueue || queue; pendingQueue = null; render();
  if (!atTop && anchor?.isConnected) window.scrollBy(0, anchor.getBoundingClientRect().top - offset);
  (atTop ? element('papers').querySelector('h2 a') : anchor?.querySelector('h2 a'))?.focus({ preventScroll: true });
});
element('more').addEventListener('click', () => {
  const previous = element('papers').children.length; count += FEED_PAGE_SIZE; render();
  element('papers').children[previous]?.querySelector('h2 a')?.focus();
});
window.addEventListener('focus', () => { if (initialized) void readLocal().then(ok => { if (ok) void retrieve(false); }); });
window.addEventListener('pageshow', event => { if (event.persisted) void readLocal().then(ok => { if (ok) void retrieve(false); }); });
window.addEventListener('pagehide', () => { clearTimeout(ageTimer); controller?.abort(); });
repository.subscribeFollowingFeed(() => {
  if (initialized) void repository.getFollowingFeedCache().then(stageQueue).catch(error => status(error.message, true));
});
void init();

async function init() {
  if (!await readLocal()) return;
  try {
    queue = latestQueue = await repository.getFollowingFeedCache();
    initialized = true; render();
    if (authors.length || queue.entries.length) await retrieve(false);
  } catch (error) { initialized = true; status(error.message, true); render(); }
}

async function readLocal() {
  const revision = ++localRevision;
  try {
    const [following, library] = await Promise.all([repository.listFollowing(), repository.getPaperLibrary()]);
    if (revision !== localRevision) return false;
    authors = following; preferences = library.settings; savedIds = new Set(library.papers.map(paper => paper.arxivId));
    render(); return true;
  } catch (error) { status(error.message, true); return false; }
}

function stageQueue(value) {
  latestQueue = value;
  if (!queue.lastCycleAt || !queue.entries.length) { queue = value; pendingQueue = null; }
  else if (JSON.stringify(queue.entries) !== JSON.stringify(value.entries)) pendingQueue = value;
  else { queue = value; pendingQueue = null; }
  render();
}

async function retrieve(manual) {
  if (busy || !initialized) return;
  // Fresh focus checks keep controls available and never start a request path.
  if (!manual && !discoveryDue(latestQueue, authors)) return;
  busy = true;
  if (!await readLocal()) { busy = false; render(); return; }
  controller = new AbortController();
  const request = controller, focused = document.activeElement === element('refresh');
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; request.abort(); }, 180000);
  if (manual) status('Checking arXiv for new papers…');
  render();
  try {
    const result = await refreshFollowingFeed(repository, { manual, signal: request.signal, onStatus: event => {
      if (event.type === 'source') status('Checking arXiv for new papers…');
      if (event.type === 'waiting') status(`Waiting for arXiv${event.retry ? ' rate limit; retrying' : ''}…`);
    } });
    if (request.signal.aborted) return;
    stageQueue(result.queue);
    if (result.status === 'updated') status(result.added ? `${result.added} new ${result.added === 1 ? 'paper' : 'papers'} available.` : 'Up to date.');
    else if (result.status === 'partial') status('Some arXiv requests failed. New results added; cached papers retained.', true);
    else if (result.status === 'failed') status('Could not refresh Feed. Cached results retained; retry later.', true);
    else if (manual && result.status === 'cooldown') status(`Refresh available after ${new Date(result.nextAttemptAt).toLocaleTimeString()}.`);
    else if (result.status === 'busy') status('Discovery is running in another view.');
    else if (result.status === 'fresh') status('');
  } catch (error) {
    status(`Could not refresh Feed: ${timedOut ? 'The request timed out.' : error.message} Cached results retained.`, true);
  } finally {
    clearTimeout(timer); busy = false; controller = null; render();
    if (focused && document.activeElement === document.body) element('refresh').focus();
  }
}

function render() {
  queue = pruneQueue(queue);
  const view = { papers: queue.entries.slice(0, count), hasMore: queue.entries.length > count, capped: queue.truncated }, container = element('papers');
  const renderAbstract = createAbstractRenderer(preferences);
  const nodes = view.papers.map(paper => {
    const signature = JSON.stringify([paper, preferences.openArxivLinksInNewTab, preferences.renderLatexInAbstracts, preferences.customLatexMacros]);
    let row = rows.get(paper.arxivId);
    if (row?.signature !== signature) {
      const node = paperRow(paper, { repository, saved: savedIds.has(paper.arxivId), showAbstract: false,
        datePrefix: 'Submitted ', dateTimeZone: 'UTC',
        openArxivLinksInNewTab: preferences.openArxivLinksInNewTab, onToggle: button => bookmark(paper, button) });
      node.dataset.arxivId = paper.arxivId;
      const date = node.querySelectorAll('.metadata')[1];
      date.title = 'Initial arXiv submission date (UTC)';
      const match = document.createElement('p'); match.className = 'metadata feed-match';
      match.textContent = paper.reason.label; match.title = paper.reason.detail;
      node.insertBefore(match, node.querySelector('.actions'));
      if (paper.abstract) {
        const details = document.createElement('details'); details.className = 'feed-abstract';
        const summary = document.createElement('summary'); summary.textContent = 'Abstract';
        summary.setAttribute('aria-label', `Abstract: ${paper.title}`);
        details.append(summary);
        // Render on demand, preserving native keyboard disclosure and reading text.
        details.addEventListener('toggle', () => { if (details.open && details.children.length === 1) details.append(renderAbstract(paper.abstract)); });
        node.append(details);
      }
      row = { node, signature }; rows.set(paper.arxivId, row);
    }
    setBookmarkState(row.node.querySelector('.bookmark'), savedIds.has(paper.arxivId), paper.title);
    return row.node;
  });
  for (const node of [...container.children]) if (!nodes.includes(node)) node.remove();
  nodes.forEach((node, index) => { if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null); });
  const live = new Set(nodes.map(node => node.dataset.arxivId));
  for (const id of rows.keys()) if (!live.has(id)) rows.delete(id);
  container.setAttribute('aria-busy', String(busy));
  element('refresh').disabled = busy || !initialized || !authors.length;
  element('more').hidden = !view.hasMore;
  element('more').disabled = busy;
  element('count').textContent = queue.lastCycleAt ? `${view.papers.length} ${view.papers.length === 1 ? 'paper' : 'papers'}` : '';
  element('updated').textContent = updatedLabel(latestQueue);
  element('updated').title = latestQueue.lastCycleAt ? `Discovery cycle: ${latestQueue.lastCycleAt}${latestQueue.partial ? '; cached entries retained after partial failure' : ''}` : '';
  element('new-papers').hidden = !pendingQueue;
  const added = pendingQueue?.entries.filter(paper => !queue.entries.some(item => item.arxivId === paper.arxivId)).length || 0;
  element('new-papers').textContent = added ? `${added} new ${added === 1 ? 'paper' : 'papers'}` : 'Update feed';
  element('end').hidden = !queue.lastCycleAt || view.hasMore || busy || !authors.length;
  element('end').textContent = view.capped ? 'End of available results · Discovery and API limits apply; coverage is incomplete.' : 'End of recent results.';
  element('empty').hidden = !initialized || busy || view.papers.length > 0 || (authors.length > 0 && !queue.lastCycleAt);
  element('empty').textContent = authors.length ? 'No recent papers.' : 'Follow authors in Following or on arXiv to discover recent papers here.';
  element('history').hidden = element('empty').hidden || !authors.length;
  // Expiration and relative age update locally; no timer contacts arXiv.
  clearTimeout(ageTimer);
  const nextExpiry = Math.min(...queue.entries.map(paper => Date.parse(paper.publishedAt) + RECENT_DAYS * DAY + 1));
  ageTimer = setTimeout(render, Math.max(1, Math.min(60000, nextExpiry - Date.now())));
}

async function bookmark(paper, button) {
  button.disabled = true; localRevision++;
  try {
    if (savedIds.has(paper.arxivId)) await openPaperCollectionPicker({ repository, paper, anchor: button, onChange: readLocal });
    else { await repository.savePaper(paper); await readLocal(); }
  } catch (error) { status(error.message, true); }
  finally { button.disabled = false; }
}

function status(message, error = false) {
  element('status').textContent = message; element('status').classList.toggle('error', error);
}

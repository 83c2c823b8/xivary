import { normalizeArxivId } from '../domain/identifiers.js';
import { normalizeAuthorName } from '../domain/author.js';
import { normalizeApiEntry } from '../services/arxiv-paper-service.js';
import { normalizeFeedCache, feedView } from '../services/following-feed.js';
import { DAY, eligiblePaper, followedIds, recentWindow, recommendation } from './discovery.js';

export const FEED_CAPACITY = 100;
export const FEED_INTERVAL = 12 * 60 * 60 * 1000;
export const FEED_LEASE_MS = 180000;
export const FEED_MANUAL_INTERVAL = 60000;
export const FEED_RETRY_MIN = 5 * 60000;
export const FEED_SEEN_CAPACITY = 5000;
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const queueOrder = (a, b) => compare(b.publishedAt, a.publishedAt) || compare(a.arxivId, b.arxivId);

export function emptyQueue() {
  return { version: 3, entries: [], seen: [], followedIds: [], lastSuccessAt: null, lastCycleAt: null, partial: false, truncated: false, areaCache: null };
}

export function normalizeQueueEntry(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid Feed entry.');
  const paper = normalizeApiEntry(input), reason = input.reason, provenance = reason?.provenance;
  if (!paper.title || !reason || !['following', 'coauthor', 'related'].includes(reason.source)
      || typeof reason.label !== 'string' || !reason.label.trim() || reason.label.length > 500
      || typeof reason.detail !== 'string' || reason.detail.length > 8000 || !provenance
      || !Array.isArray(provenance.followedIds) || !provenance.followedIds.length || provenance.followedIds.some(id => typeof id !== 'string' || !id.startsWith('arxiv-author:name:v1:'))
      || !Array.isArray(provenance.evidence) || provenance.evidence.length > 200) throw new Error('Invalid Feed entry.');
  const evidence = provenance.evidence.map(item => {
    if (!item || (item.publishedAt !== undefined && !validDate(item.publishedAt))) throw new Error('Invalid Feed provenance.');
    return { arxivId: normalizeArxivId(item.arxivId), ...(item.publishedAt ? { publishedAt: new Date(item.publishedAt).toISOString() } : {}) };
  });
  if (reason.source !== 'following' && !evidence.length) throw new Error('Missing Feed provenance.');
  if (reason.source === 'coauthor' && (typeof provenance.actorId !== 'string' || !provenance.actorId.startsWith('arxiv-author:name:v1:'))) throw new Error('Invalid coauthor provenance.');
  if (reason.source === 'related' && (typeof provenance.category !== 'string' || !/^[a-z]+(?:-[a-z]+)?(?:\.[A-Z]{2})?$/u.test(provenance.category))) throw new Error('Invalid category provenance.');
  return { ...paper, reason: { source: reason.source, label: reason.label, detail: reason.detail, provenance: {
    followedIds: [...new Set(provenance.followedIds)].sort(), evidence,
    ...(reason.source === 'coauthor' ? { actorId: provenance.actorId } : {}),
    ...(reason.source === 'related' ? { category: String(provenance.category) } : {}),
  } } };
}

export function normalizeQueue(input) {
  if (!input || input.version !== 3 || !Array.isArray(input.entries) || input.entries.length > FEED_CAPACITY
      || !Array.isArray(input.seen) || input.seen.length > FEED_SEEN_CAPACITY || !Array.isArray(input.followedIds)
      || input.followedIds.some(id => typeof id !== 'string' || !id.startsWith('arxiv-author:name:v1:'))
      || (input.lastSuccessAt !== null && !validDate(input.lastSuccessAt)) || (input.lastCycleAt !== null && !validDate(input.lastCycleAt))
      || typeof input.partial !== 'boolean' || typeof input.truncated !== 'boolean') throw new Error('Invalid Feed queue.');
  const entries = input.entries.map(normalizeQueueEntry);
  if (new Set(entries.map(paper => paper.arxivId)).size !== entries.length) throw new Error('Duplicate Feed entries.');
  const seen = input.seen.map(item => {
    if (!validDate(item.publishedAt)) throw new Error('Invalid Feed seen record.');
    return { arxivId: normalizeArxivId(item.arxivId), publishedAt: new Date(item.publishedAt).toISOString() };
  });
  if (new Set(seen.map(item => item.arxivId)).size !== seen.length) throw new Error('Duplicate Feed seen records.');
  let areaCache = null;
  if (input.areaCache) {
    const cache = input.areaCache;
    if (!validDate(cache.fetchedAt) || !Array.isArray(cache.seeds) || cache.seeds.length > 200 || !Array.isArray(cache.areas) || cache.areas.length > 2) throw new Error('Invalid Feed area cache.');
    // Only actual seed metadata is retained. Profiles are recomputed from these
    // bounded papers when reused; unknown payload fields never enter persistence.
    areaCache = { fetchedAt: new Date(cache.fetchedAt).toISOString(), seeds: cache.seeds.map(normalizeApiEntry), areas: cache.areas.map(area => ({
      category: String(area.category), evidenceIds: (area.evidenceIds || []).map(normalizeArxivId),
    })) };
  }
  return { version: 3, entries: entries.sort(queueOrder), seen: seen.sort(queueOrder), followedIds: [...new Set(input.followedIds)].sort(),
    lastSuccessAt: input.lastSuccessAt ? new Date(input.lastSuccessAt).toISOString() : null,
    lastCycleAt: input.lastCycleAt ? new Date(input.lastCycleAt).toISOString() : null, partial: input.partial, truncated: input.truncated, areaCache };
}

export function pruneQueue(queue, now = Date.now()) {
  const window = recentWindow(now);
  return { ...queue, entries: queue.entries.filter(paper => eligiblePaper(paper, window)).sort(queueOrder).slice(0, FEED_CAPACITY),
    seen: queue.seen.filter(paper => eligiblePaper(paper, window)).sort(queueOrder) };
}

export function queueMatchesFollowing(queue, authors) { return JSON.stringify(queue.followedIds) === JSON.stringify(followedIds(authors)); }
export function discoveryDue(queue, authors, now = Date.now()) {
  return !queue.lastSuccessAt || !queueMatchesFollowing(queue, authors) || new Date(now).getTime() - Date.parse(queue.lastSuccessAt) >= FEED_INTERVAL;
}
export function incrementalWindow(queue, authors, now = Date.now()) {
  const window = recentWindow(now);
  if (queue.lastSuccessAt && queueMatchesFollowing(queue, authors)) window.start = new Date(Math.max(Date.parse(window.start), Date.parse(queue.lastSuccessAt) - DAY)).toISOString();
  return window;
}

/** Reasons and metadata freeze at admission, not at every scoring pass. */
export function mergeQueue(existing, candidates, authors, bookmarkedIds, { now = Date.now(), complete = true, truncated = false, areaCache = existing.areaCache } = {}) {
  const queue = pruneQueue(existing, now), window = recentWindow(now), bookmarks = new Set(bookmarkedIds.map(normalizeArxivId));
  const scope = new Set(followedIds(authors)), changedScope = !queueMatchesFollowing(queue, authors);
  const retained = queue.entries.filter(paper => !complete || (!bookmarks.has(paper.arxivId) && paper.reason.provenance.followedIds.some(id => scope.has(id))));
  const seen = new Map(queue.seen.map(item => [item.arxivId, item]));
  for (const paper of queue.entries) if (!seen.has(paper.arxivId)) seen.set(paper.arxivId, { arxivId: paper.arxivId, publishedAt: paper.publishedAt });
  const entries = new Map(retained.map(paper => [paper.arxivId, paper]));
  let limited = truncated;
  for (const input of candidates.map(normalizeQueueEntry).sort(queueOrder)) {
    if (!eligiblePaper(input, window) || bookmarks.has(input.arxivId) || entries.has(input.arxivId) || seen.has(input.arxivId)
        || !input.reason.provenance.followedIds.some(id => scope.has(id))) continue;
    if (seen.size >= FEED_SEEN_CAPACITY) { limited = true; continue; }
    entries.set(input.arxivId, input);
    seen.set(input.arxivId, { arxivId: input.arxivId, publishedAt: input.publishedAt });
  }
  let related = 0;
  const sorted = [...entries.values()].sort(queueOrder).filter(paper => paper.reason.source !== 'related' || ++related <= 5);
  limited ||= related > 5;
  const output = normalizeQueue({ version: 3, entries: sorted.slice(0, FEED_CAPACITY), seen: [...seen.values()], followedIds: followedIds(authors),
    lastSuccessAt: complete ? new Date(now).toISOString() : changedScope ? null : queue.lastSuccessAt, lastCycleAt: new Date(now).toISOString(), partial: !complete,
    truncated: limited || sorted.length > FEED_CAPACITY, areaCache });
  return { queue: output, added: output.entries.filter(paper => !queue.entries.some(item => item.arxivId === paper.arxivId)).length };
}

/** Cache migrations only touch disposable Feed metadata; old Library/Following
 * envelopes, memberships and preferences are never inputs to a replacement write. */
export function migrateQueue(input, authors, now = Date.now()) {
  if (!input) return emptyQueue();
  if (input.version === 3) return pruneQueue(normalizeQueue(input), now);
  let entries = [], stamp = input.fetchedAt, areaCache = null;
  if (input.version === 2) {
    const cache = normalizeFeedCache(input);
    entries = feedView(cache, authors, 100, now).papers;
    const seeds = cache.streams.filter(stream => stream.source === 'following').flatMap(stream => stream.papers);
    entries = entries.map(paper => {
      if (paper.reason.provenance?.followedIds.length) return paper;
      const area = cache.areas.find(area => area.category === paper.reason.provenance?.category);
      const evidenceNames = new Set(seeds.filter(seed => area?.evidenceIds.includes(seed.arxivId)).flatMap(seed => seed.authors).map(normalizeAuthorName));
      return { ...paper, reason: { ...paper.reason, provenance: { ...paper.reason.provenance, followedIds: authors.filter(author => evidenceNames.has(normalizeAuthorName(author.displayName))).map(author => author.id) } } };
    });
    areaCache = { fetchedAt: stamp, seeds: seeds.slice(0, 200), areas: cache.areas };
  } else if (input.version === 1 && Array.isArray(input.streams) && input.streams.length <= 32
      && input.streams.every(stream => Array.isArray(stream.papers) && stream.papers.length <= 200) && validDate(stamp)) {
    for (const source of input.streams.flatMap(stream => stream.papers || [])) {
      const paper = normalizeApiEntry(source), reason = recommendation(paper, authors);
      if (reason && eligiblePaper(paper, recentWindow(now))) entries.push({ ...paper, reason });
    }
  } else throw new Error('Unsupported Feed cache.');
  if (!validDate(stamp)) throw new Error('Invalid Feed cache date.');
  const unique = [...new Map(entries.map(paper => [paper.arxivId, paper])).values()].sort(queueOrder).slice(0, FEED_CAPACITY);
  return normalizeQueue({ version: 3, entries: unique, seen: unique.map(paper => ({ arxivId: paper.arxivId, publishedAt: paper.publishedAt })), followedIds: followedIds(authors),
    lastSuccessAt: new Date(stamp).toISOString(), lastCycleAt: new Date(stamp).toISOString(), partial: false, truncated: Boolean(input.truncated), areaCache });
}

export function retryDelay(failures) { return Math.min(FEED_INTERVAL, FEED_RETRY_MIN * 2 ** Math.min(12, Math.max(0, failures - 1))); }
export function updatedLabel(queue, now = Date.now()) {
  const stamp = queue.lastCycleAt || queue.lastSuccessAt;
  if (!stamp) return '';
  const minutes = Math.max(0, Math.floor((new Date(now).getTime() - Date.parse(stamp)) / 60000));
  const age = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
  return `Updated ${age}${queue.partial ? ' · Partial' : ''}`;
}

import { normalizeArxivId } from '../domain/identifiers.js';
import { normalizeAuthorName } from '../domain/author.js';
import { buildAuthorQuery, normalizeApiEntry, paperMatchesAuthor, parseArxivPage } from './arxiv-paper-service.js';
import { requestArxiv } from './arxiv-client.js';
import { DAY, EVIDENCE_DAYS, MAX_EVIDENCE_PAPERS, MAX_RELATED_PAPERS, currentCacheWindow, dateQuery, discoverCoauthors, discoveryPapers, eligiblePaper, evidenceIsFresh, followedIds, normalizeEvidenceCache, recentWindow, recommendation, researchAreas } from '../feed/discovery.js';

export const FEED_PAGE_SIZE = 25;
export const FEED_QUERY_LIMIT = 200;
export const FEED_CACHE_TTL = DAY;
export const FEED_REQUEST_LIMIT = 12;
export const FEED_FOLLOWED_GROUP_LIMIT = 4;

// Stable grouping preserves the existing name queries; global budgets below
// prevent a large Following list from creating an unbounded request fan-out.
export function feedGroups(authors) {
  const unique = [...new Map(authors.map(author => [author.id, author])).values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const groups = [];
  for (const author of unique) {
    const term = buildAuthorQuery(author);
    if (term.length > 3500) throw new Error('A followed author name is too long to query arXiv.');
    let group = groups.at(-1);
    if (!group || group.authors.length === 40 || group.query.length + term.length + 4 > 3500) {
      group = { authors: [], query: '' }; groups.push(group);
    }
    group.authors.push(author); group.query += `${group.query ? ' OR ' : ''}${term}`;
  }
  return groups;
}

export function matchedFeedPapers(papers, authors) {
  const unique = new Map();
  for (const source of papers) {
    const paper = normalizeApiEntry(source);
    const matchedAuthors = authors.filter(author => paperMatchesAuthor(paper, author)).sort((a, b) => a.id.localeCompare(b.id));
    if (matchedAuthors.length && !unique.has(paper.arxivId)) unique.set(paper.arxivId, { ...paper, matchedAuthors });
  }
  return [...unique.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.arxivId.localeCompare(b.arxivId));
}

export function cacheMatchesFollowing(cache, authors) {
  return JSON.stringify(cache.followedIds) === JSON.stringify(followedIds(authors));
}

export function normalizeFeedCache(input) {
  if (!input || input.version !== 2 || !Array.isArray(input.streams) || input.streams.length > 8
      || !Array.isArray(input.excludedIds) || typeof input.truncated !== 'boolean'
      || !Number.isSafeInteger(input.requestsUsed) || input.requestsUsed < 0 || input.requestsUsed > FEED_REQUEST_LIMIT
      || !Number.isFinite(Date.parse(input.fetchedAt)) || !input.window
      || Date.parse(input.window.end) - Date.parse(input.window.start) !== 30 * DAY) throw new Error('Invalid Feed cache.');
  const evidence = normalizeEvidenceCache(input.evidence);
  if (JSON.stringify(input.followedIds) !== JSON.stringify(evidence.followedIds)) throw new Error('Invalid Feed scope.');
  const streams = input.streams.map(stream => {
    if (!['following', 'coauthor', 'related'].includes(stream.source) || typeof stream.query !== 'string' || !stream.query.trim() || stream.query.length > 4096
        || !Array.isArray(stream.authorIds) || stream.authorIds.length > 40
        || stream.authorIds.some(id => typeof id !== 'string' || !id.startsWith('arxiv-author:name:v1:'))
        || !Number.isSafeInteger(stream.start) || stream.start < 0 || stream.start > FEED_QUERY_LIMIT
        || typeof stream.done !== 'boolean' || typeof stream.capped !== 'boolean' || (stream.capped && !stream.done)
        || !Array.isArray(stream.papers) || stream.papers.length > stream.start
        || (stream.start && !Number.isFinite(Date.parse(stream.frontier))) || (!stream.done && (!stream.start || stream.start % 50 !== 0))
        || (!stream.done && stream.start === FEED_QUERY_LIMIT)) throw new Error('Invalid Feed cache.');
    const papers = stream.papers.map(normalizeApiEntry);
    if (papers.some(paper => !paper.title)) throw new Error('Invalid Feed cache.');
    return { source: stream.source, query: stream.query, authorIds: [...stream.authorIds], start: stream.start, done: stream.done, capped: stream.capped,
      frontier: stream.start ? new Date(stream.frontier).toISOString() : null, papers };
  });
  if (!Array.isArray(input.areas) || input.areas.length > 2) throw new Error('Invalid Feed research areas.');
  if (input.areaSeeds !== undefined && (!Array.isArray(input.areaSeeds) || input.areaSeeds.length > 200 || !Number.isFinite(Date.parse(input.areasFetchedAt)))) throw new Error('Invalid Feed area seeds.');
  const areas = input.areas.map(area => {
    if (typeof area.category !== 'string' || !/^[a-z]+(?:-[a-z]+)?(?:\.[A-Z]{2})?$/u.test(area.category)
        || !Array.isArray(area.terms) || area.terms.length > 30 || area.terms.some(term => typeof term !== 'string' || !/^[\p{L}'-]{5,100}$/u.test(term))
        || !Array.isArray(area.phrases) || area.phrases.length > 3 || area.phrases.some(phrase => typeof phrase !== 'string' || !/^[\p{L}'-]+ [\p{L}'-]+$/u.test(phrase) || phrase.length > 200)
        || !Array.isArray(area.evidenceIds) || area.evidenceIds.length > 800) throw new Error('Invalid Feed research areas.');
    return { category: area.category, terms: [...area.terms], phrases: [...area.phrases], evidenceIds: area.evidenceIds.map(normalizeArxivId) };
  });
  return { version: 2, followedIds: evidence.followedIds, fetchedAt: new Date(input.fetchedAt).toISOString(),
    window: { start: new Date(input.window.start).toISOString(), end: new Date(input.window.end).toISOString() },
    excludedIds: [...new Set(input.excludedIds.map(normalizeArxivId))].sort(), evidence, areas, streams, requestsUsed: input.requestsUsed, truncated: input.truncated,
    ...(input.areaSeeds ? { areaSeeds: input.areaSeeds.slice(0, 200).map(normalizeApiEntry), areasFetchedAt: new Date(input.areasFetchedAt).toISOString() } : {}) };
}

export async function fetchFeedPage(query, { start, signal, onStatus }) {
  const text = await requestArxiv(query, { start, signal, onEvent: event => { if (event.type !== 'chunk') onStatus?.(event); } });
  return parseArxivPage(text, start);
}

const streamFor = (source, query, authorIds = []) => ({ source, query, authorIds, start: 0, done: false, capped: false, frontier: null, papers: [] });
const timedQuery = (query, window) => `(${query}) AND ${dateQuery(window)}`;
const allPapers = cache => cache.streams.flatMap(stream => stream.papers);

// Category evidence must remain recent too; a cached area cannot outlive all of
// the followed papers that justified its terminology.
export function activeResearchAreas(cache, authors, window) {
  const direct = cache.areaSeeds || cache.streams.filter(stream => stream.source === 'following').flatMap(stream => stream.papers);
  return cache.areas.map(area => researchAreas(direct.filter(paper => area.evidenceIds.includes(paper.arxivId)), authors, window)
    .find(current => current.category === area.category)).filter(Boolean);
}

/** One discovery snapshot, one exclusion snapshot and one total request budget.
 * Chronological frontiers fill pages after name, date, topic and bookmark filters.
 * A failed page never advances the committed cache; evidence is independently
 * reusable only after its own complete response validation. */
export async function loadFeed(authors, { cache = null, evidence = null, excludedIds = [], count = FEED_PAGE_SIZE, signal, onStatus,
  queryWindow = null, areasCache = null, allowPartial = false, onFailure = () => {}, onResponse = () => {},
  fetchPage = fetchFeedPage, onEvidence = async () => {}, now = () => new Date().toISOString() } = {}) {
  const stamp = now(), window = recentWindow(stamp);
  const relevanceIndex = { byName: new Map(authors.map(author => [normalizeAuthorName(author.displayName), author])), byId: new Map(authors.map(author => [author.id, author])) };
  const follows = paper => paper.authors.some(name => relevanceIndex.byName.has(normalizeAuthorName(name)));
  const resume = cache && cacheMatchesFollowing(cache, authors);
  const snapshot = resume ? structuredClone(cache) : { version: 2, followedIds: followedIds(authors), fetchedAt: stamp, window,
    excludedIds: [...new Set(excludedIds.map(normalizeArxivId))].sort(), streams: [], areas: [], evidence: null, requestsUsed: 0, truncated: false };
  const current = () => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  async function request(query, start) {
    current(); snapshot.requestsUsed++;
    const page = await fetchPage(query, { start, signal, onStatus }); current();
    if (!Number.isSafeInteger(page.count) || page.count < 0 || page.count > 50 || !Number.isSafeInteger(page.total) || page.total < 0
        || !Array.isArray(page.papers) || page.papers.length > page.count || (page.count && start + page.count > page.total)
        || (page.count < 50 && page.total > start + page.count)) throw new Error('arXiv returned inconsistent pagination metadata.');
    return { ...page, papers: page.papers.map(normalizeApiEntry) };
  }
  function limit(stream) { stream.done = stream.capped = snapshot.truncated = true; }
  async function advance(stream) {
    if (snapshot.requestsUsed >= FEED_REQUEST_LIMIT) { limit(stream); return; }
    onStatus?.({ type: 'source', source: stream.source });
    let page;
    try { page = await request(stream.query, stream.start); onResponse(stream.source); }
    catch (error) {
      if (!allowPartial || signal?.aborted) throw error;
      onFailure(stream.source, error); limit(stream); return;
    }
    const eligible = page.papers.filter(paper => eligiblePaper(paper, snapshot.window));
    const unique = new Map(stream.papers.map(paper => [paper.arxivId, paper]));
    for (const paper of eligible) {
      if (stream.source === 'following' && !follows(paper)) continue;
      if (stream.source !== 'following' && !recommendable(paper)) continue;
      const previous = unique.get(paper.arxivId);
      const version = value => Number(value?.versionedId?.match(/v(\d+)$/u)?.[1] || 0);
      if (!previous || version(paper) > version(previous)) unique.set(paper.arxivId, paper);
    }
    stream.papers = [...unique.values()]; stream.start += page.count;
    if (page.papers.length) stream.frontier = page.papers.reduce((date, paper) => paper.publishedAt < date ? paper.publishedAt : date, page.papers[0].publishedAt);
    const cap = stream.source === 'related' ? 50 : FEED_QUERY_LIMIT;
    stream.done = stream.start >= page.total || stream.start >= cap || page.count < 50 || (stream.frontier && stream.frontier < snapshot.window.start);
    stream.capped = stream.start >= cap && page.total > stream.start;
    snapshot.truncated ||= stream.capped;
  }
  let relationships = [];
  function recommendable(paper) {
    const areas = resume ? activeResearchAreas(snapshot, authors, currentCacheWindow(snapshot, now())) : snapshot.areas;
    return Boolean(recommendation(paper, authors, relationships, areas, relevanceIndex));
  }
  if (!resume) {
    const groups = feedGroups(authors), selected = groups.slice(0, FEED_FOLLOWED_GROUP_LIMIT);
    snapshot.truncated = selected.length < groups.length;
    const discoveryWindow = queryWindow || window;
    snapshot.streams = selected.map(group => streamFor('following', timedQuery(group.query, discoveryWindow), group.authors.map(author => author.id)));
    for (const stream of snapshot.streams) await advance(stream);
    const evidenceWindow = { start: new Date(Date.parse(stamp) - EVIDENCE_DAYS * DAY).toISOString(), end: stamp };
    let graph;
    if (evidenceIsFresh(evidence, authors, stamp)) graph = structuredClone(evidence);
    else {
      const papers = [], seen = new Set(); let truncated = snapshot.truncated, failed = false;
      for (const group of selected) {
        if (snapshot.requestsUsed >= FEED_REQUEST_LIMIT) { truncated = true; break; }
        onStatus?.({ type: 'source', source: 'evidence' });
        let page;
        try { page = await request(timedQuery(group.query, evidenceWindow), 0); }
        catch (error) {
          if (!allowPartial || signal?.aborted) throw error;
          onFailure('evidence', error); failed = truncated = true; continue;
        }
        truncated ||= page.total > page.count;
        for (const paper of page.papers) if (eligiblePaper(paper, evidenceWindow) && follows(paper) && !seen.has(paper.arxivId)) { papers.push(paper); seen.add(paper.arxivId); }
      }
      graph = { version: 1, followedIds: snapshot.followedIds, fetchedAt: failed ? evidence?.fetchedAt || new Date(Date.parse(stamp) - 8 * DAY).toISOString() : stamp,
        truncated, papers: failed && evidence ? [...papers, ...evidence.papers].slice(0, MAX_EVIDENCE_PAPERS) : papers };
    }
    // New direct papers may reveal a relationship without refreshing history or
    // extending the historical evidence cache's seven-day expiration.
    const merged = new Map([...allPapers(snapshot), ...graph.papers].map(paper => [paper.arxivId, paper]));
    graph.papers = [...merged.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.arxivId.localeCompare(b.arxivId)).slice(0, MAX_EVIDENCE_PAPERS);
    graph.truncated ||= merged.size > MAX_EVIDENCE_PAPERS;
    snapshot.evidence = normalizeEvidenceCache(graph);
    await onEvidence(snapshot.evidence); current();
    const discovery = discoverCoauthors(snapshot.evidence.papers, authors, stamp);
    relationships = discovery.relationships;
    snapshot.truncated ||= graph.truncated || discovery.truncated;
    for (const group of feedGroups(relationships).slice(0, 2)) snapshot.streams.push(streamFor('coauthor', timedQuery(group.query, discoveryWindow), group.authors.map(author => author.id)));
    if (queryWindow) {
      const freshAreas = areasCache && Date.parse(stamp) - Date.parse(areasCache.fetchedAt) < 7 * DAY;
      snapshot.areaSeeds = freshAreas ? areasCache.seeds : snapshot.evidence.papers.filter(paper => eligiblePaper(paper, window)).slice(0, 200);
      snapshot.areasFetchedAt = freshAreas ? areasCache.fetchedAt : stamp;
      snapshot.areas = researchAreas(snapshot.areaSeeds, authors, window);
      if (freshAreas) snapshot.areas = snapshot.areas.filter(area => areasCache.areas.some(item => item.category === area.category));
    } else snapshot.areas = researchAreas(allPapers(snapshot), authors, window);
    for (const area of snapshot.areas) {
      const phrases = area.phrases.map(phrase => `(ti:"${phrase}" OR abs:"${phrase}")`).join(' OR ');
      snapshot.streams.push(streamFor('related', timedQuery(`cat:${area.category} AND (${phrases})`, discoveryWindow)));
    }
  } else relationships = discoverCoauthors(snapshot.evidence.papers, authors, snapshot.window.end).relationships;
  for (;;) {
    current();
    const effective = currentCacheWindow(snapshot, now());
    const areas = activeResearchAreas(snapshot, authors, effective);
    if (!areas.length) for (const stream of snapshot.streams) if (stream.source === 'related') stream.done = true;
    const papers = discoveryPapers(allPapers(snapshot), authors, { window: effective, excludedIds: snapshot.excludedIds, relationships, areas });
    const boundary = papers[count - 1]?.publishedAt;
    const stream = snapshot.streams.find(item => !item.done && (!item.start || !boundary || item.frontier >= boundary));
    if (!stream) {
      snapshot.truncated ||= discoveryPapers(allPapers(snapshot), authors, { window: effective, excludedIds: snapshot.excludedIds, relationships, areas, relatedLimit: Infinity }).filter(paper => paper.reason.source === 'related').length > MAX_RELATED_PAPERS;
      snapshot.fetchedAt = resume ? snapshot.fetchedAt : now(); return normalizeFeedCache(snapshot);
    }
    await advance(stream);
  }
}

export function feedView(cache, authors, count = FEED_PAGE_SIZE, now = Date.now()) {
  if (!cache) return { papers: [], hasMore: false, capped: false, contributions: { following: 0, coauthor: 0, related: 0 } };
  const relationships = discoverCoauthors(cache.evidence.papers, authors, cache.window.end).relationships;
  const window = currentCacheWindow(cache, now);
  const areas = activeResearchAreas(cache, authors, window);
  const papers = discoveryPapers(allPapers(cache), authors, { window, excludedIds: cache.excludedIds, relationships, areas });
  const visible = papers.slice(0, count), contributions = { following: 0, coauthor: 0, related: 0 };
  for (const paper of visible) contributions[paper.reason.source]++;
  const canQuery = Date.parse(window.start) <= Date.parse(window.end) && cache.requestsUsed < FEED_REQUEST_LIMIT && cache.streams.some(stream => !stream.done && (stream.source !== 'related' || areas.length));
  return { papers: visible, hasMore: papers.length > count || canQuery, capped: cache.truncated, contributions };
}

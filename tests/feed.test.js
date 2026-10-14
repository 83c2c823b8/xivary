import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthor } from '../extension/src/domain/author.js';
import { FEED_QUERY_LIMIT, FEED_REQUEST_LIMIT, cacheMatchesFollowing, feedGroups, feedView, loadFeed, matchedFeedPapers, normalizeFeedCache } from '../extension/src/services/following-feed.js';
import { DAY, EVIDENCE_TTL, currentCacheWindow, dateQuery, discoverCoauthors, discoveryPapers, eligiblePaper, evidenceIsFresh, followedIds, fullDiscoveryName, normalizeEvidenceCache, recentWindow, researchAreas } from '../extension/src/feed/discovery.js';
import { normalizeApiEntry } from '../extension/src/services/arxiv-paper-service.js';
import { LocalRepository } from '../extension/src/repository/local-repository.js';
import { RepositoryClient } from '../extension/src/repository/repository-client.js';
import { createRepositoryHandler } from '../extension/src/background/repository-handler.js';
import { migrateQueue, emptyQueue } from '../extension/src/feed/queue.js';
import { projectState } from '../extension/src/repository/sync-model.js';

const now = '2026-10-14T00:00:00.000Z', timestamp = Date.parse(now), window = recentWindow(now);
const author = name => createAuthor({ displayName: name }, now);
const alex = author('Alex Kim'), sam = author('Sam Lee'), collaborator = author('Morgan Scholar');
const paper = (index, authors = ['Alex Kim'], publishedAt = new Date(timestamp - index * 60000).toISOString(), extra = {}) => ({
  arxivId: `2610.${String(index + 1).padStart(5, '0')}`, title: `Paper ${index}`, authors, abstract: 'Deterministic fixture.', publishedAt, categories: ['math.SG'], ...extra,
});
const topic = { title: 'Homological mirror symmetry and symplectic invariants', abstract: 'Fukaya categories and symplectic invariants for homological mirror symmetry.', categories: ['math.SG'] };
const evidencePaper = (index, names = ['Alex Kim', 'Morgan Scholar'], days = 100) => paper(index, names, new Date(timestamp - days * DAY).toISOString(), topic);
const page = papers => ({ papers, count: papers.length, total: papers.length });
const evidence = (authors, papers = []) => ({ version: 1, followedIds: followedIds(authors), fetchedAt: now, truncated: false, papers });
const options = (authors, extra = {}) => ({ now: () => now, evidence: evidence(authors), ...extra });
const view = (cache, authors, count = 25, at = now) => feedView(cache, authors, count, at);
const relations = discoverCoauthors([evidencePaper(100), evidencePaper(101, undefined, 120)], [alex], now).relationships;

// Existing identity and canonical-ID regressions remain independent of discovery.
test('individual full-name matching preserves normalization, accents, initials and namesake limitation', () => {
  const follows = [author('Anne–Marie O’Neill'), alex];
  const result = matchedFeedPapers([paper(1, ["ANNE-MARIE O'NEILL"]), paper(2, ['Alex Sato', 'Ken Kim']), paper(3, ['A. Kim']), paper(4, ['Álex Kim']), paper(5, ['Alex Kim'])], follows);
  assert.deepEqual(result.map(item => item.arxivId), [paper(1).arxivId, paper(5).arxivId]);
  assert.equal(author('Alex Kim').id, alex.id);
});

test('rolling eligibility is exactly 30 UTC days, includes the cutoff and ignores revisions and local timezone', () => {
  const precise = recentWindow('2026-10-14T00:00:00.123Z');
  assert.equal(Date.parse(precise.end) - Date.parse(precise.start), 30 * DAY);
  assert.equal(eligiblePaper(paper(1, undefined, precise.start), precise), true);
  assert.equal(eligiblePaper(paper(1, undefined, '2026-09-14T09:00:00.123+09:00'), precise), true);
  assert.equal(eligiblePaper(paper(1, undefined, '2026-09-13T23:59:59.999Z'), precise), false);
  assert.equal(eligiblePaper(paper(1, undefined, '2026-10-14T00:00:00.124Z'), precise), false);
  assert.equal(eligiblePaper(paper(1, undefined, '2020-01-01T00:00:00Z', { updatedAt: now }), precise), false);
  assert.equal(dateQuery(precise), 'submittedDate:[202609140000 TO 202610140001]');
});

test('direct coauthors need actual one-hop evidence; repeated/shared relationships deduplicate with provenance', () => {
  const seeds = [evidencePaper(100, ['Alex Kim', 'Sam Lee', 'Morgan Scholar']), evidencePaper(101), evidencePaper(102, ['Morgan Scholar', 'Recursive Stranger']), evidencePaper(103, ['Unknown Person', 'Area Neighbor'])];
  const result = discoverCoauthors(seeds, [alex, sam], now);
  assert.equal(result.relationships.length, 1); assert.equal(result.relationships[0].id, collaborator.id);
  assert.equal(result.relationships[0].totalEvidence, 2);
  assert.deepEqual(result.relationships[0].evidence[0].followedIds, followedIds([alex, sam]));
  assert.equal(result.relationships[0].evidence[0].arxivId, seeds[0].arxivId);
  assert.ok(!result.relationships.some(item => item.displayName === 'Recursive Stranger'));
  const candidate = paper(1, ['Morgan Scholar'], undefined, topic);
  assert.equal(discoveryPapers([candidate], [alex, sam], { window, relationships: result.relationships })[0].reason.source, 'coauthor');
});

test('initials, common short names, large collaborations, old links and unrelated namesake topics are restrained', () => {
  assert.equal(fullDiscoveryName('M. Scholar'), false);
  assert.equal(fullDiscoveryName('Anne-Marie O’Neill'), true);
  const seeds = [evidencePaper(100, ['Alex Kim', 'Sam Lee']), evidencePaper(101, ['Alex Kim', 'M. Scholar']), evidencePaper(102, ['Alex Kim', 'Ancient Scholar'], 1200), evidencePaper(103, ['Alex Kim', ...Array.from({ length: 13 }, (_, i) => `Team Member${i}`)])];
  assert.equal(discoverCoauthors(seeds, [alex], now).relationships.length, 0);
  const repeatedCommon = discoverCoauthors([evidencePaper(100, ['Alex Kim', 'Sam Lee']), evidencePaper(101, ['Alex Kim', 'Sam Lee'])], [alex], now).relationships;
  assert.equal(repeatedCommon.length, 1);
  assert.equal(discoveryPapers([paper(1, ['Sam Lee'], undefined, { title: 'A clinical population study', abstract: 'Unrelated medicine.' })], [alex], { window, relationships: repeatedCommon }).length, 0);
  assert.equal(discoveryPapers([paper(1, ['Sam Lee'], undefined, topic)], [alex], { window, relationships: repeatedCommon }).length, 1);
});

test('recent/repeated evidence is prioritized with per-follow and total coauthor limits', () => {
  const seeds = Array.from({ length: 30 }, (_, index) => evidencePaper(100 + index, ['Alex Kim', `Morgan Scholar${String.fromCharCode(65 + index % 26)}${String.fromCharCode(65 + Math.floor(index / 26))}`], 10 + index));
  const result = discoverCoauthors(seeds, [alex], now);
  assert.equal(result.relationships.length, 4); assert.equal(result.truncated, true);
  assert.equal(result.relationships[0].latestAt, seeds[0].publishedAt);
  const shared = discoverCoauthors([...seeds, evidencePaper(300, ['Alex Kim', 'Sam Lee', 'Shared Scholar'], 80)], [alex, sam], now);
  for (const followed of [alex, sam]) assert.ok(shared.relationships.filter(item => item.evidence.some(edge => edge.followedIds.includes(followed.id))).length <= 4);
});

test('category supplementation requires recent followed seeds, three specific terms and a real title phrase, capped at five', () => {
  const seed = paper(100, ['Alex Kim'], undefined, topic), areas = researchAreas([seed], [alex], window);
  assert.equal(areas.length, 1); assert.equal(areas[0].category, 'math.SG');
  const unrelated = paper(1, ['Other Scholar'], undefined, { title: 'An algebraic construction of spaces', abstract: 'A general theorem and applications.', categories: ['math.SG'] });
  assert.equal(discoveryPapers([unrelated], [alex], { window, areas }).length, 0);
  const related = Array.from({ length: 20 }, (_, index) => paper(index, ['Other Scholar'], undefined, topic));
  assert.equal(discoveryPapers(related, [alex], { window, areas }).length, 5);
  assert.equal(discoveryPapers(related, [alex], { window, areas })[0].reason.label, 'Related: math.SG');
  assert.equal(researchAreas([{ ...seed, publishedAt: new Date(timestamp - 31 * DAY).toISOString() }], [alex], window).length, 0);
  assert.equal(researchAreas([{ ...seed, authors: ['Morgan Scholar'] }], [alex], window).length, 0, 'Coauthors cannot recursively seed research areas');
  assert.equal(researchAreas([{ ...seed, title: 'Homological mirror $\\mathbb{R}$', abstract: '$\\mathbf{R}$' }], [alex], window).length, 0, 'LaTeX commands cannot supply topical evidence');
});

test('cross-source/version dedup chooses the retrieved version; recency precedes relationship and deterministic ties', () => {
  const seeds = [paper(100, ['Alex Kim'], undefined, topic)], areas = researchAreas(seeds, [alex], window);
  const followed = paper(1, ['Alex Kim', 'Morgan Scholar'], undefined, topic);
  const coauthor = paper(2, ['Morgan Scholar'], followed.publishedAt, topic);
  const related = paper(3, ['Other Scholar'], followed.publishedAt, topic);
  const newer = paper(0, ['Other Scholar'], undefined, topic);
  const versioned = { ...followed, arxivId: `${followed.arxivId}v2` };
  const config = { window, relationships: relations, areas };
  const result = discoveryPapers([related, coauthor, followed, newer, versioned], [alex], config);
  assert.deepEqual(result.map(item => item.arxivId), [newer.arxivId, followed.arxivId, coauthor.arxivId, related.arxivId]);
  assert.equal(result[1].versionedId, `${followed.arxivId}v2`);
  assert.deepEqual(discoveryPapers([versioned, newer, followed, coauthor, related], [alex], config), result);
  assert.equal(normalizeApiEntry(versioned).versionedId, versioned.arxivId);
  assert.equal(result[1].reason.source, 'following');
});

test('bookmark exclusions are captured on refresh, keep current rows stable, and do not exclude offline-only papers', async () => {
  const hits = [paper(0), paper(1), paper(2)], fetchPage = async () => page(hits);
  const cache = await loadFeed([alex], options([alex], { excludedIds: [hits[0].arxivId], fetchPage }));
  assert.deepEqual(view(cache, [alex]).papers.map(item => item.arxivId), [hits[1].arxivId, hits[2].arxivId]);
  const continued = await loadFeed([alex], options([alex], { cache, excludedIds: hits.map(item => item.arxivId), count: 50, fetchPage }));
  assert.deepEqual(view(continued, [alex]).papers.map(item => item.arxivId), [hits[1].arxivId, hits[2].arxivId]);
  const refreshed = await loadFeed([alex], options([alex], { excludedIds: [hits[0].arxivId, hits[1].arxivId], fetchPage }));
  assert.deepEqual(view(refreshed, [alex]).papers.map(item => item.arxivId), [hits[2].arxivId], 'Offline-only ID is not a bookmark exclusion');
});

test('pagination fills after bookmark/name filtering, counts raw duplicates, has a finite end and avoids cached-page requests', async () => {
  const hits = Array.from({ length: 117 }, (_, index) => paper(index));
  hits[31] = hits[30]; hits[32] = paper(32, ['Alex Sato', 'Ken Kim']);
  const starts = [], fetchPage = async (_query, { start }) => { starts.push(start); return { papers: hits.slice(start, start + 50), count: Math.min(50, hits.length - start), total: hits.length }; };
  const excludedIds = hits.slice(0, 60).map(item => item.arxivId);
  const first = await loadFeed([alex], options([alex], { fetchPage, excludedIds }));
  assert.deepEqual(starts, [0, 50]); assert.equal(view(first, [alex]).papers.length, 25);
  const second = await loadFeed([alex], options([alex], { cache: first, count: 50, fetchPage }));
  assert.deepEqual(starts, [0, 50, 100]); assert.equal(view(second, [alex], 50).papers.length, 50);
  const final = await loadFeed([alex], options([alex], { cache: second, count: 75, fetchPage }));
  assert.equal(starts.length, 3); assert.equal(view(final, [alex], 75).papers.length, 57); assert.equal(view(final, [alex], 75).hasMore, false);
  assert.equal(final.streams[0].start, 117);
});

test('query-group frontiers retain chronological ordering after filtering prolific authors', async () => {
  const authors = Array.from({ length: 41 }, (_, index) => author(`Author ${String(index).padStart(2, '0')}`));
  const groups = feedGroups(authors), busy = groups[0].authors[0].displayName, quiet = groups[1].authors[0].displayName;
  const starts = [], fetchPage = async (query, { start }) => {
    const prolific = query.includes(busy); starts.push([prolific ? 'busy' : 'quiet', start]);
    if (!prolific) return page([paper(199, [quiet])]);
    const all = Array.from({ length: 95 }, (_, index) => paper(index, [busy]));
    return { papers: all.slice(start, start + 50), count: Math.min(50, all.length - start), total: all.length };
  };
  const first = await loadFeed(authors, options(authors, { fetchPage }));
  assert.deepEqual(starts, [['busy', 0], ['quiet', 0]]);
  const next = await loadFeed(authors, options(authors, { cache: first, count: 75, fetchPage }));
  assert.deepEqual(starts.at(-1), ['busy', 50]);
  assert.deepEqual(view(next, authors, 75).papers.map(item => item.arxivId), Array.from({ length: 75 }, (_, index) => paper(index).arxivId));
});

test('coauthor-only papers reach the Feed without entering Following; fresh evidence avoids repeated history requests', async () => {
  const seeds = [evidencePaper(100), evidencePaper(101)], starts = [];
  const fetchPage = async query => { starts.push(query); return query.includes('Morgan Scholar') ? page([paper(1, ['Morgan Scholar'], undefined, topic)]) : page([]); };
  const graph = evidence([alex], seeds);
  const cache = await loadFeed([alex], options([alex], { evidence: graph, fetchPage }));
  assert.equal(view(cache, [alex]).contributions.coauthor, 1); assert.equal(view(cache, [alex]).papers[0].reason.label, 'Coauthor of Alex Kim');
  assert.equal(starts.length, 2); assert.equal(starts.some(query => query.includes('202310')), false);
  assert.equal(cache.followedIds.length, 1); assert.equal(cache.evidence.papers.length, 2);
});

test('date query, evidence expiration, stale cache aging and offline failure do not admit historical papers', async () => {
  const graph = evidence([alex], [evidencePaper(100), evidencePaper(101)]);
  assert.equal(evidenceIsFresh(graph, [alex], timestamp + EVIDENCE_TTL - 1), true);
  assert.equal(evidenceIsFresh(graph, [alex], timestamp + EVIDENCE_TTL), false);
  assert.equal(evidenceIsFresh(graph, [sam], timestamp), false);
  const calls = [];
  const cache = await loadFeed([alex], options([alex], { evidence: { ...graph, fetchedAt: new Date(timestamp - 8 * DAY).toISOString() }, fetchPage: async query => { calls.push(query); return page([]); } }));
  assert.equal(calls.length, 2, 'Expired graph gets one bounded history query, then no actors are discovered');
  assert.ok(calls[0].includes(dateQuery(window))); assert.ok(calls[1].includes('202310150000'));
  const old = await loadFeed([alex], options([alex], { fetchPage: async () => page([paper(1, undefined, new Date(timestamp - 29 * DAY).toISOString()), paper(2, undefined, new Date(timestamp - 31 * DAY).toISOString())]) }));
  assert.equal(view(old, [alex]).papers.length, 1); assert.equal(view(old, [alex], 25, timestamp + 2 * DAY).papers.length, 0);
  assert.equal(currentCacheWindow(old, timestamp + 2 * DAY).end, old.window.end);
  await assert.rejects(loadFeed([alex], options([alex], { fetchPage: async () => { throw Error('offline'); } })), /offline/);
  assert.equal(view(old, [alex], 25, timestamp + 2 * DAY).papers.length, 0);
  assert.equal(view(cache, [alex]).papers.length, 0);
});

test('cached category recommendations expire when their recent followed-paper evidence ages out', async () => {
  const seed = paper(100, ['Alex Kim'], new Date(timestamp - 29 * DAY).toISOString(), topic);
  const candidate = paper(1, ['Other Scholar'], undefined, topic);
  const cache = await loadFeed([alex], options([alex], { fetchPage: async query => page(query.includes('cat:') ? [candidate] : [seed]) }));
  assert.equal(view(cache, [alex]).contributions.related, 1);
  assert.equal(view(cache, [alex], 25, timestamp + 2 * DAY).papers.length, 0);
  assert.equal(view(cache, [alex], 25, timestamp + 2 * DAY).hasMore, false);
});

test('finite raw-hit and global fan-out budgets disclose incomplete coverage even when no candidates survive', async () => {
  const starts = [];
  const cache = await loadFeed([alex], options([alex], { fetchPage: async (_query, { start }) => { starts.push(start); return { count: 50, total: 10000, papers: Array.from({ length: 50 }, (_, index) => paper(start + index, ['A. Kim'])) }; } }));
  assert.deepEqual(starts, [0, 50, 100, 150]); assert.equal(cache.streams[0].start, FEED_QUERY_LIMIT); assert.equal(view(cache, [alex]).capped, true);
  const many = Array.from({ length: 1000 }, (_, index) => author(`Researcher ${index}`)); let requests = 0;
  const bounded = await loadFeed(many, options(many, { fetchPage: async (_query, { start }) => { requests++; return { count: 50, total: 10000, papers: Array.from({ length: 50 }, (_, index) => paper(start + index, ['Unrelated Scholar'])) }; } }));
  assert.equal(requests, FEED_REQUEST_LIMIT); assert.equal(view(bounded, many).hasMore, false); assert.equal(bounded.truncated, true);
  assert.equal(bounded.followedIds.length, 1000); assert.equal(bounded.streams.length, 4);
});

test('empty, malformed, partial failure, rate limit and cancellation preserve the prior Feed and validated evidence', async () => {
  const empty = await loadFeed([], options([], { fetchPage: () => assert.fail('No authors means no network') }));
  assert.equal(view(empty, []).papers.length, 0);
  const cache = await loadFeed([alex], options([alex], { fetchPage: async () => ({ count: 50, total: 100, papers: Array.from({ length: 50 }, (_, index) => paper(index)) }) }));
  const before = structuredClone(cache);
  await assert.rejects(loadFeed([alex], options([alex], { cache, count: 75, fetchPage: async () => { throw Error('429; retry later'); } })), /429/); assert.deepEqual(cache, before);
  const controller = new AbortController();
  await assert.rejects(loadFeed([alex], options([alex], { cache, count: 75, signal: controller.signal, fetchPage: async () => { controller.abort(); return page([]); } })), { name: 'AbortError' }); assert.deepEqual(cache, before);
  let committedEvidence;
  await assert.rejects(loadFeed([alex], options([alex], { evidence: evidence([alex], [evidencePaper(100), evidencePaper(101)]), onEvidence: async value => { committedEvidence = value; }, fetchPage: async query => { if (query.includes('Morgan Scholar')) throw Error('coauthor source unavailable'); return page([paper(0)]); } })), /coauthor source unavailable/);
  assert.ok(committedEvidence); assert.deepEqual(cache, before);
  for (const response of [{ papers: [], count: 0, total: 100 }, { papers: [paper(1)], count: 1, total: 0 }, { papers: [paper(1)], count: 1, total: 100 }]) await assert.rejects(loadFeed([alex], options([alex], { fetchPage: async () => response })), /inconsistent pagination/);
  assert.throws(() => normalizeFeedCache({ version: 1, streams: [] }), /Invalid Feed cache/);
});

test('repository cache/evidence RPC preserves user-owned data and Sync/portable boundaries, rejects stale scope and survives old caches', async () => {
  let state;
  const repository = new LocalRepository({ read: async () => structuredClone(state), write: async value => { state = structuredClone(value); } }, () => now);
  const handler = createRepositoryHandler(repository, 'test');
  const client = new RepositoryClient({ sendMessage: message => new Promise(resolve => handler(message, { id: 'test' }, resolve)) });
  await client.followAuthor(alex); await client.savePaper(paper(9));
  const before = structuredClone(state);
  const cache = await loadFeed([alex], options([alex], { fetchPage: async () => page([paper(0)]), onEvidence: value => client.putFollowingFeedEvidence(value) }));
  const queue = migrateQueue(cache, [alex], now);
  await client.putFollowingFeedCache(queue);
  for (const field of ['favorites', 'paperCollections', 'paperMemberships', 'authors', 'collections', 'memberships', 'settings', 'authorPaperCaches']) assert.deepEqual(state[field], before[field]);
  assert.deepEqual(await client.getFollowingFeedCache(), queue); assert.deepEqual(await client.getFollowingFeedEvidence(), cache.evidence);
  assert.deepEqual(projectState(state), projectState(before));
  for (const category of ['bookmarks', 'following']) { const portable = JSON.stringify(await client.exportCategory(category)); assert.ok(!portable.includes('followingFeedCache')); assert.ok(!portable.includes('followingFeedEvidence')); }
  await assert.rejects(client.putFollowingFeedCache({ ...queue, entries: [null] }), /Invalid/);
  assert.deepEqual(await client.getFollowingFeedCache(), queue);
  await client.unfollowAuthor(alex.id); assert.deepEqual(await client.getFollowingFeedCache(), queue); assert.equal(await client.getFollowingFeedEvidence(), null);
  await assert.rejects(client.putFollowingFeedCache(queue), /Following changed/); await assert.rejects(client.putFollowingFeedEvidence(cache.evidence), /Following changed/);
  state.followingFeedCache = { version: 1, streams: [] }; state.followingFeedEvidence = { broken: true };
  assert.deepEqual(await client.getFollowingFeedCache(), emptyQueue()); assert.equal(await client.getFollowingFeedEvidence(), null); assert.equal((await client.listFavorites()).length, 1);
  assert.equal(cacheMatchesFollowing(cache, []), false); assert.throws(() => normalizeEvidenceCache({ ...cache.evidence, followedIds: [alex.id, alex.id] }), /Invalid/);
});

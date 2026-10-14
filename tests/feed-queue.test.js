import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthor } from '../extension/src/domain/author.js';
import { LocalRepository } from '../extension/src/repository/local-repository.js';
import { RepositoryClient } from '../extension/src/repository/repository-client.js';
import { createRepositoryHandler } from '../extension/src/background/repository-handler.js';
import { refreshFollowingFeed } from '../extension/src/services/feed-refresh.js';
import { loadFeed } from '../extension/src/services/following-feed.js';
import { DAY, recommendation, followedIds } from '../extension/src/feed/discovery.js';
import { emptyQueue, mergeQueue, migrateQueue, normalizeQueue, pruneQueue, discoveryDue, incrementalWindow, FEED_INTERVAL, FEED_LEASE_MS, updatedLabel } from '../extension/src/feed/queue.js';

const stamp = Date.parse('2026-10-14T12:00:00.123Z');
const alex = createAuthor({ displayName: 'Alex Kim' }, new Date(stamp).toISOString());
const sam = createAuthor({ displayName: 'Sam Lee' }, new Date(stamp).toISOString());
const paper = (index, time = stamp - index * 60000, extra = {}) => ({ arxivId: `2610.${String(index + 1).padStart(5, '0')}`, title: `Queue paper ${index}`, authors: ['Alex Kim'], abstract: 'Fixture.', categories: ['math.SG'], publishedAt: new Date(time).toISOString(), ...extra });
const candidate = (index, time, extra) => { const value = paper(index, time, extra); return { ...value, reason: recommendation(value, [alex, sam]) }; };
const page = papers => ({ count: papers.length, total: papers.length, papers });
const makeQueue = items => mergeQueue(emptyQueue(), items, [alex], [], { now: stamp }).queue;
async function fixture() {
  let state, at = stamp, writes = 0, rejectWrite = false, id = 0;
  const storage = { read: async () => structuredClone(state), write: async value => { if (rejectWrite) throw Error('quota exceeded'); state = structuredClone(value); writes++; } };
  const repository = new LocalRepository(storage, () => new Date(at).toISOString(), () => `lease-${++id}`);
  const handler = createRepositoryHandler(repository, 'test');
  const client = new RepositoryClient({ sendMessage: message => new Promise(resolve => handler(message, { id: 'test' }, resolve)) });
  await client.followAuthor(alex);
  return { repository, client, storage, now: () => new Date(at).toISOString(), advance: ms => at += ms, state: () => structuredClone(state), writes: () => writes,
    corrupt: value => { state.followingFeedCache = value; }, reject: value => rejectWrite = value };
}

test('incremental insertion retains frozen metadata/reasons, canonical IDs and stable date/ID ordering', () => {
  const initial = makeQueue([candidate(10), candidate(20), candidate(30)]);
  const revised = candidate(20, stamp - 20 * 60000, { versionedId: `${paper(20).arxivId}v9`, title: 'Changed ranking and title' });
  const result = mergeQueue(initial, [revised, candidate(0), candidate(0)], [alex], [], { now: stamp + 1000 });
  assert.equal(result.added, 1); assert.equal(result.queue.entries.length, 4);
  assert.deepEqual(result.queue.entries.find(item => item.arxivId === paper(20).arxivId), initial.entries[1]);
  const ties = makeQueue([candidate(5, stamp), candidate(4, stamp, { authors: ['Alex Kim', 'Sam Lee'] }), candidate(3, stamp)]);
  assert.deepEqual(ties.entries.map(item => item.arxivId), [paper(3).arxivId, paper(4).arxivId, paper(5).arxivId]);
  assert.deepEqual(normalizeQueue(ties), ties);
});

test('100-paper capacity prunes oldest first, tracks admitted IDs and never reinserts capacity-removed IDs', () => {
  const queue = makeQueue(Array.from({ length: 120 }, (_, i) => candidate(i)));
  assert.equal(queue.entries.length, 100); assert.equal(queue.seen.length, 120); assert.equal(queue.truncated, true);
  assert.equal(queue.entries.at(-1).arxivId, paper(99).arxivId);
  const result = mergeQueue(queue, [candidate(110), candidate(999, stamp + 1000)], [alex], [], { now: stamp + 1000 });
  assert.equal(result.queue.entries[0].arxivId, paper(999).arxivId); assert.equal(result.queue.entries.length, 100);
  assert.ok(!result.queue.entries.some(item => item.arxivId === paper(110).arxivId));
  assert.deepEqual(result.queue.entries.slice(0, 25).map(item => item.arxivId), [paper(999).arxivId, ...queue.entries.slice(0, 24).map(item => item.arxivId)]);
});

test('UTC millisecond boundaries, future submissions, initial versus revised dates and rolling expiration', () => {
  const cutoff = stamp - 30 * DAY;
  const queue = makeQueue([candidate(1, cutoff), candidate(2, cutoff - 1), candidate(3, stamp + 1), candidate(4, stamp - 100 * DAY, { updatedAt: new Date(stamp).toISOString() })]);
  assert.deepEqual(queue.entries.map(item => item.arxivId), [paper(1).arxivId]);
  assert.equal(pruneQueue(queue, stamp + 1).entries.length, 0); assert.equal(pruneQueue(queue, stamp + 1).seen.length, 0);
  assert.equal(makeQueue([]).entries.length, 0);
});

test('bookmarking leaves visible snapshot intact; complete cycle removes it; offline-only remains and unbookmark does not reinsert', () => {
  const visible = makeQueue([candidate(1), candidate(2)]), before = structuredClone(visible);
  const partial = mergeQueue(visible, [], [alex], [paper(1).arxivId], { now: stamp, complete: false }).queue;
  assert.equal(partial.entries.length, 2);
  const refreshed = mergeQueue(visible, [candidate(3)], [alex], [paper(1).arxivId], { now: stamp }).queue;
  assert.deepEqual(visible, before); assert.deepEqual(refreshed.entries.map(item => item.arxivId), [paper(2).arxivId, paper(3).arxivId]);
  assert.ok(!mergeQueue(refreshed, [candidate(1)], [alex], [], { now: stamp }).queue.entries.some(item => item.arxivId === paper(1).arxivId));
});

test('refresh interval is exactly 12 hours and queries overlap the last success by one day', () => {
  const queue = makeQueue([candidate(1)]);
  assert.equal(discoveryDue(queue, [alex], stamp + FEED_INTERVAL - 1), false);
  assert.equal(discoveryDue(queue, [alex], stamp + FEED_INTERVAL), true);
  assert.equal(discoveryDue(queue, [alex, sam], stamp), true);
  assert.equal(incrementalWindow(queue, [alex], stamp + FEED_INTERVAL).start, new Date(stamp - DAY).toISOString());
  assert.equal(incrementalWindow(queue, [alex, sam], stamp).start, new Date(stamp - 30 * DAY).toISOString());
  assert.match(updatedLabel(queue, stamp + 4 * 3600000), /Updated 4h ago/);
});

test('first population commits atomically; fresh opening makes zero network calls; manual checks then cooldown', async () => {
  const f = await fixture(); let calls = 0;
  const fetchPage = async query => { calls++; return page(query.includes('2023') ? [] : [paper(1)]); };
  const opts = { fetchPage, now: f.now, locks: null };
  const first = await refreshFollowingFeed(f.client, opts); assert.equal(first.status, 'updated'); assert.equal(first.queue.entries.length, 1);
  const before = calls; assert.equal((await refreshFollowingFeed(f.client, opts)).status, 'fresh'); assert.equal(calls, before);
  assert.equal((await refreshFollowingFeed(f.client, { ...opts, manual: true })).status, 'cooldown'); assert.equal(calls, before);
  f.advance(60000); assert.equal((await refreshFollowingFeed(f.client, { ...opts, manual: true })).status, 'updated'); assert.equal(calls, before + 1);
  f.advance(FEED_INTERVAL); assert.equal((await refreshFollowingFeed(f.client, opts)).status, 'updated'); assert.equal(calls, before + 2);
});

test('same-view refresh promises deduplicate; repository lease protects independent views and survives worker recreation', async () => {
  const f = await fixture(); let release, calls = 0;
  const fetchPage = async () => { calls++; await new Promise(resolve => release = resolve); return page([]); };
  const a = refreshFollowingFeed(f.client, { fetchPage, now: f.now, locks: null });
  const b = refreshFollowingFeed(f.client, { fetchPage, now: f.now, locks: null }); assert.equal(a, b);
  await new Promise(resolve => setTimeout(resolve, 10));
  const recreated = new LocalRepository(f.storage, f.now);
  assert.equal((await recreated.beginFollowingFeedDiscovery(true)).status, 'busy');
  release(); await new Promise(resolve => setTimeout(resolve, 10)); release(); await a; assert.equal(calls, 2);
  assert.equal((await recreated.getFollowingFeedCache()).version, 3);
});

test('expired interrupted lease applies durable backoff, failed cycles double delay and rapid navigation makes no request', async () => {
  const f = await fixture(); await f.client.beginFollowingFeedDiscovery(false); f.advance(FEED_LEASE_MS + 1);
  const recreated = new LocalRepository(f.storage, f.now);
  const expired = await recreated.beginFollowingFeedDiscovery(false); assert.equal(expired.status, 'cooldown');
  assert.equal(expired.nextAttemptAt - Date.parse(f.now()), 5 * 60000);
  let calls = 0; const opts = { locks: null, now: f.now, fetchPage: async () => { calls++; throw Error('429 Retry-After'); } };
  assert.equal((await refreshFollowingFeed(f.client, opts)).status, 'cooldown'); assert.equal(calls, 0);
  f.advance(5 * 60000); assert.equal((await refreshFollowingFeed(f.client, opts)).status, 'failed');
  assert.equal(f.state()._followingFeedDiscovery.nextAttemptAt - Date.parse(f.now()), 10 * 60000);
  const before = calls; await refreshFollowingFeed(f.client, { ...opts, manual: true }); assert.equal(calls, before);
});

test('partial source failure admits valid candidates and retains existing queue/bookmarks without claiming a full successful cycle', async () => {
  const f = await fixture(); await f.client.putFollowingFeedCache(makeQueue([candidate(2)])); await f.client.savePaper(paper(2)); f.advance(FEED_INTERVAL);
  const result = await refreshFollowingFeed(f.client, { locks: null, now: f.now, fetchPage: async query => {
    if (query.includes('2023')) throw Error('503 evidence unavailable'); return page([paper(1)]);
  } });
  assert.equal(result.status, 'partial'); assert.equal(result.queue.entries.length, 2);
  assert.equal(result.queue.lastSuccessAt, new Date(stamp).toISOString()); assert.equal(result.queue.lastCycleAt, f.now());
  assert.equal(result.failures[0].source, 'evidence'); assert.equal((await f.client.listFavorites()).length, 1);
});

test('Following changes invalidate evidence, retain shared provenance and require a fresh full-window discovery', async () => {
  const f = await fixture(); await f.client.putFollowingFeedCache(makeQueue([candidate(1)])); await f.client.followAuthor(sam);
  const start = await f.client.beginFollowingFeedDiscovery(false); assert.equal(start.status, 'started'); assert.equal(start.evidence, null);
  assert.equal(incrementalWindow(start.queue, start.authors, stamp).start, new Date(stamp - 30 * DAY).toISOString());
  await f.client.unfollowAuthor(alex.id);
  await assert.rejects(f.client.commitFollowingFeedDiscovery({ token: start.token, candidates: [], complete: true, truncated: false }), /Following changed/);
  assert.equal((await f.client.getFollowingFeedCache()).entries.length, 1); await f.client.failFollowingFeedDiscovery(start.token);
  const result = mergeQueue(start.queue, [], [sam], [], { now: stamp }); assert.equal(result.queue.entries.length, 0);
});

test('seven-day evidence expiration and scope invalidation avoid historical queries between discovery cycles', async () => {
  const f = await fixture(); const graph = { version: 1, followedIds: followedIds([alex]), fetchedAt: f.now(), truncated: false, papers: [] };
  await f.client.putFollowingFeedEvidence(graph); let history = 0;
  const opts = { locks: null, now: f.now, fetchPage: async query => { if (query.includes('2023')) history++; return page([]); } };
  await refreshFollowingFeed(f.client, opts); assert.equal(history, 0);
  f.advance(7 * DAY - 1); await refreshFollowingFeed(f.client, opts); assert.equal(history, 0);
  f.advance(60001); await refreshFollowingFeed(f.client, { ...opts, manual: true }); assert.equal(history, 1);
  await f.client.followAuthor(sam); assert.equal(await f.client.getFollowingFeedEvidence(), null);
});

test('legacy v1/v2 migrate recent papers safely, schema3 survives restart; incompatible cache never damages owned records', async () => {
  const f = await fixture(); await f.client.savePaper(paper(9)); const before = f.state();
  const legacy = await loadFeed([alex], { now: f.now, fetchPage: async () => page([paper(1)]), evidence: { version: 1, followedIds: [alex.id], fetchedAt: f.now(), truncated: false, papers: [] } });
  f.corrupt(legacy); const migrated = await f.client.getFollowingFeedCache(); assert.equal(migrated.version, 3); assert.equal(migrated.entries.length, 1);
  const writes = f.writes(); assert.deepEqual(await f.client.getFollowingFeedCache(), migrated); assert.equal(f.writes(), writes);
  assert.deepEqual(await new LocalRepository(f.storage, f.now).getFollowingFeedCache(), migrated);
  assert.equal(migrateQueue({ version: 1, fetchedAt: f.now(), streams: [{ papers: [paper(1), paper(8, stamp - 40 * DAY)] }] }, [alex], stamp).entries.length, 1);
  f.corrupt({ version: 99, sensitive: 'untouched' }); assert.deepEqual(await f.client.getFollowingFeedCache(), emptyQueue()); assert.equal(f.state().followingFeedCache.version, 99);
  for (const field of ['favorites', 'paperCollections', 'paperMemberships', 'authors', 'collections', 'memberships', 'settings']) assert.deepEqual(f.state()[field], before[field]);
});

test('quota failure during atomic commit leaves previous persisted queue and owned data intact', async () => {
  const f = await fixture(); await f.client.putFollowingFeedCache(makeQueue([candidate(2)]));
  const lease = await f.client.beginFollowingFeedDiscovery(true), before = f.state(); f.reject(true);
  await assert.rejects(f.client.commitFollowingFeedDiscovery({ token: lease.token, candidates: [candidate(1)], complete: true, truncated: false }), /quota/);
  assert.deepEqual(f.state(), before);
});

test('commit reads current bookmarks and rejects stale token writes; clearing Following needs no API call', async () => {
  const f = await fixture(); await f.client.putFollowingFeedCache(makeQueue([candidate(2)]));
  const lease = await f.client.beginFollowingFeedDiscovery(true); await f.client.savePaper(paper(1));
  const result = await f.client.commitFollowingFeedDiscovery({ token: lease.token, candidates: [candidate(1)], complete: true, truncated: false });
  assert.equal(result.queue.entries.length, 1); assert.equal(result.queue.entries[0].arxivId, paper(2).arxivId);
  await assert.rejects(f.client.commitFollowingFeedDiscovery({ token: lease.token, candidates: [], complete: true, truncated: false }), /expired/);
  await f.client.unfollowAuthor(alex.id); f.advance(60000);
  const cleared = await refreshFollowingFeed(f.client, { locks: null, now: f.now, fetchPage: async () => { throw Error('must not query'); } });
  assert.equal(cleared.status, 'updated'); assert.equal(cleared.queue.entries.length, 0); assert.equal((await f.client.listFavorites()).length, 1);
});

test('related queue contribution stays subordinate across cycles; malformed provenance and unbounded legacy data are rejected', () => {
  const related = index => ({ ...candidate(index), authors: ['Other Scholar'], reason: { source: 'related', label: 'Related: math.SG', detail: 'Specific title phrase.', provenance: { followedIds: [alex.id], category: 'math.SG', evidence: [{ arxivId: paper(200).arxivId }] } } });
  const initial = makeQueue([candidate(10), ...[20, 30, 40, 50, 60].map(related)]);
  const result = mergeQueue(initial, [related(0)], [alex], [], { now: stamp });
  assert.equal(result.queue.entries.filter(item => item.reason.source === 'related').length, 5);
  assert.ok(result.queue.entries.some(item => item.reason.source === 'following')); assert.equal(result.queue.truncated, true);
  assert.throws(() => normalizeQueue({ ...initial, entries: [{ ...related(1), reason: { ...related(1).reason, provenance: { ...related(1).reason.provenance, evidence: [] } } }] }), /provenance/);
  assert.throws(() => migrateQueue({ version: 1, fetchedAt: new Date(stamp).toISOString(), streams: [{ papers: Array(201).fill(paper(1)) }] }, [alex], stamp), /Unsupported/);
});

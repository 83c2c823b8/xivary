import { loadFeed, feedView } from './following-feed.js';
import { incrementalWindow, queueMatchesFollowing } from '../feed/queue.js';

const running = new WeakMap();

/** Fetching/parsing stays in a demand-driven extension view. Web Locks coordinate
 * live views; the repository lease/backoff survives their closure and worker loss. */
export function refreshFollowingFeed(repository, { manual = false, signal, onStatus, fetchPage,
  now = () => new Date().toISOString(), locks = globalThis.navigator?.locks } = {}) {
  if (running.has(repository)) return running.get(repository);
  const cycle = async () => {
    const start = await repository.beginFollowingFeedDiscovery(manual);
    if (start.status !== 'started') return start;
    const failures = []; let responses = 0;
    try {
      if (!start.authors.length) return await repository.commitFollowingFeedDiscovery({ token: start.token, candidates: [], complete: true, truncated: false, areaCache: null });
      const snapshot = await loadFeed(start.authors, { evidence: start.evidence, excludedIds: start.bookmarkedIds,
        count: 100, signal, onStatus, fetchPage, now, allowPartial: true,
        queryWindow: incrementalWindow(start.queue, start.authors, now()),
        areasCache: queueMatchesFollowing(start.queue, start.authors) ? start.queue.areaCache : null,
        onEvidence: value => repository.putFollowingFeedEvidence(value),
        onFailure: (source, error) => failures.push({ source, message: error.message }),
        onResponse: () => responses++,
      });
      if (failures.length && !responses) return { ...await repository.failFollowingFeedDiscovery(start.token), failures, requestsUsed: snapshot.requestsUsed };
      const candidates = feedView(snapshot, start.authors, 100, now()).papers;
      const result = await repository.commitFollowingFeedDiscovery({ token: start.token, candidates, complete: !failures.length,
        truncated: snapshot.truncated, areaCache: { fetchedAt: snapshot.areasFetchedAt, seeds: snapshot.areaSeeds, areas: snapshot.areas } });
      return { ...result, failures, requestsUsed: snapshot.requestsUsed };
    } catch (error) {
      await repository.failFollowingFeedDiscovery(start.token).catch(() => {});
      throw error;
    }
  };
  const promise = (locks ? locks.request('xivary-feed-discovery', { signal }, cycle) : cycle()).finally(() => running.delete(repository));
  running.set(repository, promise);
  return promise;
}

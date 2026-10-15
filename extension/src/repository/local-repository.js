import { migratingStorage, withStorageLock } from './migration-storage.js';
import { LIBRARY_SNAPSHOT_VERSION } from '../domain/library-snapshot.js';
import { prepareState, STORAGE_SCHEMA_VERSION, collectionName, paperCollectionName } from './local-schema.js';
export { prepareState } from './local-schema.js';
import { exportBackup, parseBackupFiles, mergeBackup } from './portable-backup.js';
import { PaperRepository } from "./paper-repository.js";
import { parseLatexMacros } from "../domain/latex.js";
import { createPaper } from "../domain/paper.js";
import { reconcilePaperOrdering, moveBefore } from '../domain/paper-ordering.js';
import { createAuthor } from "../domain/author.js";
import { cleanText, normalizeArxivId } from "../domain/identifiers.js";
import { normalizeCachedAuthorResults } from "../services/arxiv-paper-service.js";
import { followedIds, normalizeEvidenceCache } from "../feed/discovery.js";
import { emptyQueue, migrateQueue, normalizeQueue, mergeQueue, queueMatchesFollowing, discoveryDue, FEED_INTERVAL, FEED_LEASE_MS, FEED_MANUAL_INTERVAL, retryDelay } from '../feed/queue.js';
import { exportPortableCategory, mergePortableCategory, parsePortableCategory } from "./portable-library.js";

const newest = field => (a, b) => b[field].localeCompare(a[field]);
const DEFAULT_PAPER_COLLECTION_ID = "paper-collection:saved-papers";

export class LocalRepository extends PaperRepository {
  constructor(storage, clock = () => new Date().toISOString(), makeId = () => crypto.randomUUID()) {
    super();
    this.storage = migratingStorage(storage, clock);
    this.initialization = null;
    this.clock = clock;
    this.makeId = makeId;
    this.pending = Promise.resolve();
    this.removals = new Map();
    this.entityVersions = new Map();
    this.undoNow = () => Date.now();
    this.offline = null; // Injected by the shared background entry point; independent of schema 5.
  }

  initialize() {
    if (!this.initialization) {
      const pending = this.run(state => ({ schemaVersion: state.schemaVersion }));
      this.initialization = pending.catch(error => { this.initialization = null; throw error; });
    }
    return this.initialization;
  }
  getOfflineLibrary() { return this.initialize().then(() => this.offline.list()); }
  getOfflineCopy(id) { return this.initialize().then(() => this.offline.get(id)); }
  saveOfflinePaper(paper, update) {
    if (typeof update !== 'boolean') throw new Error('Invalid offline update choice.');
    return this.initialize().then(() => this.offline.save(paper, update));
  }
  removeOfflineCopy(id) { return this.initialize().then(() => this.offline.remove(id)); }
  cancelOfflineSave(id) { return this.initialize().then(() => this.offline.cancel(id)); }
  getOfflinePdfChunk(id, revision, offset) { return this.initialize().then(() => this.offline.chunk(id, revision, offset)); }
  async openOfflinePaper(id) {
    const copy = await this.getOfflineCopy(id);
    if (!copy) throw new Error("This paper has no offline copy.");
    return this.openOfflineTab(copy.arxivId);
  }

  // One worker instance serializes migrations, reads and writes across all UI contexts.
  run(operation) {
    const result = this.pending.then(() => withStorageLock(this.storage, async () => {
      const stored = await this.storage.read();
      const state = prepareState(stored, this.clock());
      const before = entitySnapshots(state);
      const result = await operation(state);
      const after = entitySnapshots(state);
      for (const key of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(key) !== after.get(key)) this.entityVersions.set(key, (this.entityVersions.get(key) || 0) + 1);
      }
      return result;
    }));
    this.pending = result.catch(() => {});
    return result;
  }

  listFavorites() {
    return this.run(state => structuredClone(state.favorites).sort(newest("savedAt")));
  }

  getPaperLibrary() {
    return this.run(state => structuredClone({
      snapshotVersion: LIBRARY_SNAPSHOT_VERSION, schemaVersion: STORAGE_SCHEMA_VERSION,
      papers: state.favorites, collections: state.paperCollections,
      memberships: state.paperMemberships, settings: state.settings, ordering: reconcilePaperOrdering(state),
    }));
  }

  async persist(state) {
    if (state.paperOrdering !== undefined) state.paperOrdering = reconcilePaperOrdering(state);
    await this.storage.write(state);
  }

  movePaperCollection(id, beforeId) {
    if (typeof id !== 'string' || (beforeId !== null && typeof beforeId !== 'string')) return Promise.reject(new Error('Invalid collection move.'));
    return this.run(async state => {
      const ordering = reconcilePaperOrdering(state), next = moveBefore(ordering.collectionIds, id, beforeId);
      if (JSON.stringify(next) === JSON.stringify(ordering.collectionIds)) return false;
      state.paperOrdering = { ...ordering, collectionIds: next };
      await this.persist(state); return true;
    });
  }

  movePaperInCollection(collectionId, arxivId, beforeId) {
    return this.run(async state => {
      requirePaperCollection(state, collectionId);
      const id = normalizeArxivId(arxivId), before = beforeId === null ? null : normalizeArxivId(beforeId);
      const ordering = reconcilePaperOrdering(state), members = new Set(state.paperMemberships.filter(item => item.collectionId === collectionId).map(item => item.arxivId));
      const previous = ordering.paperOrders.find(item => item.collectionId === collectionId);
      const ids = previous?.paperIds || state.favorites.filter(paper => members.has(paper.arxivId)).map(paper => paper.arxivId);
      const next = moveBefore(ids, id, before);
      if (JSON.stringify(next) === JSON.stringify(ids)) return false;
      state.paperOrdering = { ...ordering, paperOrders: [...ordering.paperOrders.filter(item => item.collectionId !== collectionId), { collectionId, paperIds: next }] };
      await this.persist(state); return true;
    });
  }

  savePaper(input) {
    return this.run(async state => {
      const paper = this.addPaperToDefaultCollection(state, input);
      await this.persist(state);
      return structuredClone(paper);
    });
  }

  listFollowing() {
    return this.run(state => {
      const followed = new Set(state.memberships.map(item => item.authorId));
      return structuredClone(state.authors.filter(author => followed.has(author.id))).sort(newest("followedAt"));
    });
  }

  toggleFavorite(input) {
    return this.run(async state => {
      const paper = createPaper(input, this.clock());
      const exists = state.paperMemberships.some(item => item.arxivId === paper.arxivId);
      if (exists) this.removePaperEverywhere(state, paper.arxivId);
      else this.addPaperToDefaultCollection(state, paper);
      await this.persist(state);
      return exists ? null : paper;
    });
  }

  removeFavorite(arxivId) {
    return this.run(async state => {
      const id = normalizeArxivId(arxivId);
      return this.removeWithUndo(state, "paper", id, () => this.removePaperEverywhere(state, id));
    });
  }

  createPaperCollection(name, paper = null) {
    return this.run(async state => {
      const collection = this.newPaperCollection(state, name);
      state.settings.lastUsedPaperCollectionId = collection.id;
      if (paper !== null) this.addPaperMembership(state, paper, collection.id);
      await this.persist(state);
      return structuredClone(collection);
    });
  }

  renamePaperCollection(id, name) {
    return this.run(async state => {
      const collection = requirePaperCollection(state, id);
      collection.name = paperCollectionName(state, name, id);
      collection.updatedAt = this.clock();
      await this.persist(state);
      return structuredClone(collection);
    });
  }

  deletePaperCollection(id) {
    return this.run(async state => {
      requirePaperCollection(state, id);
      state.paperCollections = state.paperCollections.filter(item => item.id !== id);
      state.paperMemberships = state.paperMemberships.filter(item => item.collectionId !== id);
      this.removeOrphanedPapers(state);
      if (state.settings.lastUsedPaperCollectionId === id) {
        state.settings.lastUsedPaperCollectionId = state.paperCollections[0]?.id ?? null;
      }
      await this.persist(state);
    });
  }

  addPaperToCollection(input, collectionId) {
    return this.run(async state => {
      const paper = this.addPaperMembership(state, input, collectionId);
      await this.persist(state);
      return structuredClone(paper);
    });
  }

  removePaperFromCollection(arxivId, collectionId) {
    return this.run(async state => {
      requirePaperCollection(state, collectionId);
      const id = normalizeArxivId(arxivId);
      return this.removeWithUndo(state, "paper", id, () => {
        state.paperMemberships = state.paperMemberships.filter(item => item.arxivId !== id || item.collectionId !== collectionId);
        this.removeOrphanedPapers(state);
      });
    });
  }

  getAuthorLibrary() {
    return this.run(state => structuredClone({
      authors: state.authors, collections: state.collections,
      memberships: state.memberships, settings: state.settings,
    }));
  }

  followAuthor(input) {
    return this.run(async state => {
      const candidate = createAuthor(input, this.clock());
      const existing = state.authors.find(author => author.id === candidate.id);
      if (state.memberships.some(item => item.authorId === candidate.id)) return existing;
      let collection = state.collections.find(item => item.id === state.settings.lastUsedAuthorCollectionId)
        || state.collections[0];
      if (!collection) collection = this.newCollection(state, "Following");
      const author = this.addMembership(state, input, collection.id);
      await this.persist(state);
      return author;
    });
  }

  createAuthorCollection(name, author = null) {
    return this.run(async state => {
      const collection = this.newCollection(state, name);
      state.settings.lastUsedAuthorCollectionId = collection.id;
      if (author !== null) this.addMembership(state, author, collection.id);
      await this.persist(state);
      return collection;
    });
  }

  renameAuthorCollection(id, name) {
    return this.run(async state => {
      const collection = requireCollection(state, id);
      collection.name = collectionName(state, name, id);
      collection.updatedAt = this.clock();
      await this.persist(state);
      return collection;
    });
  }

  deleteAuthorCollection(id) {
    return this.run(async state => {
      requireCollection(state, id);
      state.collections = state.collections.filter(item => item.id !== id);
      state.memberships = state.memberships.filter(item => item.collectionId !== id);
      if (state.settings.lastUsedAuthorCollectionId === id) {
        state.settings.lastUsedAuthorCollectionId = state.collections[0]?.id ?? null;
      }
      await this.persist(state);
    });
  }

  addAuthorToCollection(author, collectionId) {
    return this.run(async state => {
      const record = this.addMembership(state, author, collectionId);
      await this.persist(state);
      return record;
    });
  }

  removeAuthorFromCollection(authorId, collectionId) {
    return this.run(async state => {
      requireCollection(state, collectionId);
      return this.removeWithUndo(state, "author", authorId, () => {
        state.memberships = state.memberships.filter(item => item.authorId !== authorId || item.collectionId !== collectionId);
      });
    });
  }

  unfollowAuthor(id) {
    return this.run(async state => {
      if (typeof id !== "string" || !id.startsWith("arxiv-author:name:v1:")) throw new TypeError("Invalid author ID.");
      return this.removeWithUndo(state, "author", id, () => {
        state.memberships = state.memberships.filter(item => item.authorId !== id);
      });
    });
  }

  /** Short-lived background-owned receipts, never persisted or synchronized. */
  async removeWithUndo(state, kind, id, remove) {
    const membershipField = kind === "paper" ? "paperMemberships" : "memberships";
    const recordField = kind === "paper" ? "favorites" : "authors";
    const idField = kind === "paper" ? "arxivId" : "id";
    const memberId = kind === "paper" ? "arxivId" : "authorId";
    const record = structuredClone(state[recordField].find(item => item[idField] === id));
    const before = state[membershipField].filter(item => item[memberId] === id);
    const orderTargets = kind === 'paper' && state.paperOrdering ? reconcilePaperOrdering(state).paperOrders
      .filter(order => order.paperIds.includes(id)).map(order => ({ collectionId: order.collectionId, successors: order.paperIds.slice(order.paperIds.indexOf(id) + 1) })) : [];
    remove();
    const removed = before.filter(item => !state[membershipField].some(other => other[memberId] === id && other.collectionId === item.collectionId));
    await this.persist(state);
    if (!removed.length) return null;
    for (const [token, receipt] of this.removals) if (receipt.expires <= this.undoNow()) this.removals.delete(token);
    if (this.removals.size >= 100) this.removals.delete(this.removals.keys().next().value);
    const key = `${kind}:${id}`, token = crypto.randomUUID();
    this.removals.set(token, { kind, id, record, removed: structuredClone(removed), orderTargets,
      collectionVersions: Object.fromEntries(removed.map(item => {
        const collectionKey = `${kind}-collection:${item.collectionId}`;
        return [collectionKey, this.entityVersions.get(collectionKey) || 0];
      })),
      version: (this.entityVersions.get(key) || 0) + 1, after: entitySnapshots(state).get(key), expires: this.undoNow() + 8000 });
    return { undoToken: token };
  }

  undoRemoval(token) {
    return this.run(async state => {
      const receipt = typeof token === "string" && this.removals.get(token);
      if (!receipt || receipt.expires <= this.undoNow()) throw new Error("Undo has expired. Existing data was left unchanged.");
      const { kind, id, record, removed } = receipt, key = `${kind}:${id}`;
      const collectionField = kind === "paper" ? "paperCollections" : "collections";
      if ((this.entityVersions.get(key) || 0) !== receipt.version || entitySnapshots(state).get(key) !== receipt.after
          || Object.entries(receipt.collectionVersions).some(([key, version]) => (this.entityVersions.get(key) || 0) !== version)
          || removed.some(item => !state[collectionField].some(collection => collection.id === item.collectionId))) {
        throw new Error("This item changed after removal. Undo was not applied.");
      }
      const recordField = kind === "paper" ? "favorites" : "authors";
      const idField = kind === "paper" ? "arxivId" : "id";
      const membershipField = kind === "paper" ? "paperMemberships" : "memberships";
      if (!state[recordField].some(item => item[idField] === id)) state[recordField].push(structuredClone(record));
      state[membershipField].push(...structuredClone(removed));
      if (kind === 'paper' && state.paperOrdering) {
        state.paperOrdering = reconcilePaperOrdering(state);
        for (const target of receipt.orderTargets || []) {
          const order = state.paperOrdering.paperOrders.find(order => order.collectionId === target.collectionId);
          if (order && removed.some(item => item.collectionId === target.collectionId)) {
            order.paperIds = moveBefore(order.paperIds, id, target.successors.find(next => order.paperIds.includes(next)) ?? null);
          }
        }
      }
      await this.persist(prepareState(state, this.clock()));
      this.removals.delete(token);
    });
  }

  getAuthorPaperCache(authorId) {
    return this.run(state => structuredClone(state.authorPaperCaches.find(item => item.authorId === authorId) ?? null));
  }

  getFollowingFeedCache() {
    return this.run(async state => {
      const queue = this.feedQueue(state);
      if (state.followingFeedCache && JSON.stringify(queue) !== JSON.stringify(state.followingFeedCache)) {
        // Validate first: an incompatible cache remains recoverable until a new
        // discovery commit replaces it. Valid migrations/pruning are idempotent.
        try { migrateQueue(state.followingFeedCache, this.feedAuthors(state), this.clock()); }
        catch { return queue; }
        state.followingFeedCache = queue;
        await this.persist(state);
      }
      return structuredClone(queue);
    });
  }

  putFollowingFeedCache(input) {
    return this.run(async state => {
      const cache = normalizeQueue(input);
      if (!queueMatchesFollowing(cache, this.feedAuthors(state))) throw new Error('Following changed; refresh the Feed.');
      state.followingFeedCache = cache;
      await this.persist(state);
      return structuredClone(cache);
    });
  }

  feedAuthors(state) {
    const live = new Set(state.memberships.map(item => item.authorId));
    return state.authors.filter(author => live.has(author.id));
  }

  feedQueue(state) {
    try { return migrateQueue(state.followingFeedCache, this.feedAuthors(state), this.clock()); }
    catch { return emptyQueue(); }
  }

  beginFollowingFeedDiscovery(manual) {
    if (typeof manual !== 'boolean') return Promise.reject(new Error('Invalid Feed refresh choice.'));
    return this.run(async state => {
      const now = Date.parse(this.clock()), queue = this.feedQueue(state), authors = this.feedAuthors(state);
      const input = state._followingFeedDiscovery;
      const activeValid = !input?.active || (typeof input.active.token === 'string' && Number.isFinite(input.active.startedAt)
        && input.active.until - input.active.startedAt === FEED_LEASE_MS && Array.isArray(input.active.followedIds)
        && input.active.followedIds.every(id => typeof id === 'string' && id.startsWith('arxiv-author:name:v1:')));
      const policy = input && Number.isSafeInteger(input.failures) && input.failures >= 0 && input.failures <= 32
        && Number.isFinite(input.nextAttemptAt) && input.nextAttemptAt >= 0 && input.nextAttemptAt <= now + FEED_INTERVAL && activeValid
        ? input : { failures: 0, nextAttemptAt: 0, active: null };
      if (policy.active?.until > now) return { status: 'busy', queue };
      if (policy.active) {
        policy.active = null; policy.failures = Math.min(32, policy.failures + 1);
        policy.nextAttemptAt = now + retryDelay(policy.failures);
        state._followingFeedDiscovery = policy; await this.persist(state);
      }
      if (!manual && !discoveryDue(queue, authors, now)) return { status: 'fresh', queue };
      if (policy.nextAttemptAt > now) return { status: 'cooldown', queue, nextAttemptAt: policy.nextAttemptAt };
      const token = this.makeId();
      policy.active = { token, followedIds: followedIds(authors), startedAt: now, until: now + FEED_LEASE_MS };
      state._followingFeedDiscovery = policy;
      await this.persist(state);
      let evidence = null;
      try {
        const graph = normalizeEvidenceCache(state.followingFeedEvidence);
        if (JSON.stringify(graph.followedIds) === JSON.stringify(followedIds(authors))) evidence = graph;
      } catch { /* Disposable evidence can be rebuilt. */ }
      return structuredClone({ status: 'started', token, queue, authors, evidence, bookmarkedIds: state.favorites.map(paper => paper.arxivId) });
    });
  }

  commitFollowingFeedDiscovery(input) {
    if (!input || typeof input.token !== 'string' || typeof input.complete !== 'boolean' || typeof input.truncated !== 'boolean'
        || !Array.isArray(input.candidates) || input.candidates.length > 100) return Promise.reject(new Error('Invalid Feed discovery commit.'));
    return this.run(async state => {
      const policy = state._followingFeedDiscovery, authors = this.feedAuthors(state), now = Date.parse(this.clock());
      if (!policy?.active || policy.active.token !== input.token || policy.active.until <= now) throw new Error('Feed discovery expired; cached results retained.');
      if (JSON.stringify(policy.active.followedIds) !== JSON.stringify(followedIds(authors))) throw new Error('Following changed; cached results retained.');
      const result = mergeQueue(this.feedQueue(state), input.candidates, authors, state.favorites.map(paper => paper.arxivId),
        { now, complete: input.complete, truncated: input.truncated, areaCache: input.areaCache ?? null });
      state.followingFeedCache = result.queue;
      policy.active = null;
      policy.failures = input.complete ? 0 : Math.min(32, policy.failures + 1);
      policy.nextAttemptAt = now + (input.complete ? FEED_MANUAL_INTERVAL : retryDelay(policy.failures));
      await this.persist(state); // Queue and durable lease commit together.
      return structuredClone({ status: input.complete ? 'updated' : 'partial', ...result });
    });
  }

  failFollowingFeedDiscovery(token) {
    return this.run(async state => {
      const policy = state._followingFeedDiscovery;
      if (policy?.active?.token === token) {
        policy.active = null; policy.failures = Math.min(32, policy.failures + 1);
        policy.nextAttemptAt = Date.parse(this.clock()) + retryDelay(policy.failures);
        await this.persist(state);
      }
      return { status: 'failed', queue: structuredClone(this.feedQueue(state)) };
    });
  }

  getFollowingFeedEvidence() {
    return this.run(state => {
      try {
        const cache = normalizeEvidenceCache(state.followingFeedEvidence);
        const live = new Set(state.memberships.map(item => item.authorId));
        return JSON.stringify(cache.followedIds) === JSON.stringify(followedIds(state.authors.filter(author => live.has(author.id)))) ? cache : null;
      } catch { return null; }
    });
  }

  putFollowingFeedEvidence(input) {
    return this.run(async state => {
      const cache = normalizeEvidenceCache(input);
      const live = new Set(state.memberships.map(item => item.authorId));
      if (JSON.stringify(cache.followedIds) !== JSON.stringify(followedIds(state.authors.filter(author => live.has(author.id))))) throw new Error('Following changed; refresh the Feed.');
      state.followingFeedEvidence = cache;
      await this.persist(state);
      return structuredClone(cache);
    });
  }

  getArxivRequestState() {
    return this.run(state => structuredClone(state._arxivApi ?? { until: 0 }));
  }

  setArxivRequestState(value) {
    if (!value || !Number.isFinite(value.until) || value.until < 0) return Promise.reject(new Error("Invalid arXiv request deadline."));
    return this.run(async state => {
      state._arxivApi = { until: value.until };
      await this.persist(state);
      return structuredClone(state._arxivApi);
    });
  }

  putAuthorPaperCache(input) {
    return this.run(async state => {
      const cache = normalizeCachedAuthorResults(input);
      state.authorPaperCaches = state.authorPaperCaches.filter(item => item.authorId !== cache.authorId);
      state.authorPaperCaches.push(cache);
      await this.persist(state);
      return structuredClone(cache);
    });
  }

  getPreferences() {
    return this.run(state => structuredClone({
      vimMode: state.settings.vimMode,
      renderLatexInAbstracts: state.settings.renderLatexInAbstracts,
      customLatexMacros: state.settings.customLatexMacros,
      openXivaryFromToolbarInNewTab: state.settings.openXivaryFromToolbarInNewTab,
      openAuthorResultsInNewTab: state.settings.openAuthorResultsInNewTab,
      openArxivLinksInNewTab: state.settings.openArxivLinksInNewTab,
      organizeFollowedAuthorsIntoCollections: state.settings.organizeFollowedAuthorsIntoCollections,
    }));
  }

  setOpenXivaryFromToolbarInNewTab(enabled) {
    if (typeof enabled !== "boolean") return Promise.reject(new TypeError("The toolbar navigation preference must be true or false."));
    return this.run(async state => {
      state.settings.openXivaryFromToolbarInNewTab = enabled;
      await this.persist(state);
      return { openXivaryFromToolbarInNewTab: enabled };
    });
  }

  setRenderLatexInAbstracts(enabled) {
    if (typeof enabled !== "boolean") return Promise.reject(new TypeError("The LaTeX rendering preference must be true or false."));
    return this.run(async state => {
      state.settings.renderLatexInAbstracts = enabled;
      await this.persist(state);
      return { renderLatexInAbstracts: enabled };
    });
  }

  setVimMode(enabled) {
    if (typeof enabled !== "boolean") return Promise.reject(new TypeError("Vim Mode must be true or false."));
    return this.run(async state => {
      state.settings.vimMode = enabled;
      await this.persist(state);
      return { vimMode: enabled };
    });
  }

  setCustomLatexMacros(text) {
    return this.run(async state => {
      parseLatexMacros(text); // Validate before changing state or writing anything.
      state.settings.customLatexMacros = text;
      await this.persist(state);
      return { customLatexMacros: text };
    });
  }

  setOpenAuthorResultsInNewTab(enabled) {
    if (typeof enabled !== "boolean") return Promise.reject(new TypeError("The author navigation preference must be true or false."));
    return this.run(async state => {
      state.settings.openAuthorResultsInNewTab = enabled;
      await this.persist(state);
      return { openAuthorResultsInNewTab: enabled };
    });
  }

  setOpenArxivLinksInNewTab(enabled) {
    if (typeof enabled !== "boolean") return Promise.reject(new TypeError("The link preference must be true or false."));
    return this.run(async state => {
      state.settings.openArxivLinksInNewTab = enabled;
      await this.persist(state);
      return structuredClone({ openArxivLinksInNewTab: enabled });
    });
  }

  setOrganizeFollowedAuthorsIntoCollections(enabled) {
    if (typeof enabled !== "boolean") return Promise.reject(new TypeError("The author collection preference must be true or false."));
    return this.run(async state => {
      state.settings.organizeFollowedAuthorsIntoCollections = enabled;
      await this.persist(state);
      return structuredClone({ organizeFollowedAuthorsIntoCollections: enabled });
    });
  }

  exportBackup(category, selection) {
    return this.run(state => exportBackup(state, category, selection, this.clock()));
  }

  async importBackup(inputs, category) {
    // Validate every selected file before acquiring the mutation queue or writing.
    const backup = await parseBackupFiles(inputs, category);
    return this.run(async state => {
      const merged = mergeBackup(state, backup);
      const proposed = prepareState(merged.state, this.clock());
      await this.persist(proposed);
      return structuredClone(merged.result);
    }, false);
  }

  exportCategory(category, selection) {
    return this.run(state => structuredClone(exportPortableCategory(state, this.clock(), category, selection)));
  }

  async importCategory(text, category) {
    const backup = parsePortableCategory(text, category);
    return this.run(async state => {
      const merged = mergePortableCategory(state, backup);
      const proposed = prepareState(merged.state, this.clock());
      await this.persist(proposed);
      return structuredClone(merged.result);
    }, false);
  }

  newCollection(state, name) {
    const normalized = collectionName(state, name);
    const now = this.clock();
    const collection = { id: `collection:${this.makeId()}`, name: normalized, createdAt: now, updatedAt: now };
    if (state.collections.some(item => item.id === collection.id)) throw new Error("Collection ID collision. Please retry.");
    state.collections.push(collection);
    return collection;
  }

  addMembership(state, input, collectionId) {
    requireCollection(state, collectionId);
    const now = this.clock();
    const candidate = createAuthor(input, now);
    let author = state.authors.find(item => item.id === candidate.id);
    if (!author) { author = candidate; state.authors.push(author); }
    if (!state.memberships.some(item => item.authorId === author.id && item.collectionId === collectionId)) {
      state.memberships.push({ authorId: author.id, collectionId, addedAt: now, updatedAt: now });
    }
    state.settings.lastUsedAuthorCollectionId = collectionId;
    return author;
  }

  newPaperCollection(state, name, id = `paper-collection:${this.makeId()}`) {
    const normalized = paperCollectionName(state, name);
    const now = this.clock();
    const collection = { id, name: normalized, createdAt: now, updatedAt: now };
    if (state.paperCollections.some(item => item.id === id)) throw new Error("Collection ID collision. Please retry.");
    state.paperCollections.push(collection);
    return collection;
  }

  addPaperToDefaultCollection(state, input) {
    const candidate = createPaper(input, this.clock());
    const existing = state.favorites.find(item => item.arxivId === candidate.arxivId);
    if (state.paperMemberships.some(item => item.arxivId === candidate.arxivId)) return existing;
    let collection = state.paperCollections.find(item => item.id === state.settings.lastUsedPaperCollectionId)
      || state.paperCollections[0];
    if (!collection) collection = this.newPaperCollection(state, "Saved Papers", DEFAULT_PAPER_COLLECTION_ID);
    return this.addPaperMembership(state, existing || candidate, collection.id);
  }

  addPaperMembership(state, input, collectionId) {
    requirePaperCollection(state, collectionId);
    const now = this.clock();
    const candidate = createPaper(input, now);
    let paper = state.favorites.find(item => item.arxivId === candidate.arxivId);
    if (!paper) { paper = candidate; state.favorites.push(paper); }
    if (!state.paperMemberships.some(item => item.arxivId === paper.arxivId && item.collectionId === collectionId)) {
      state.paperMemberships.push({ arxivId: paper.arxivId, collectionId, addedAt: now, updatedAt: now });
    }
    state.settings.lastUsedPaperCollectionId = collectionId;
    return paper;
  }

  removePaperEverywhere(state, arxivId) {
    state.paperMemberships = state.paperMemberships.filter(item => item.arxivId !== arxivId);
    state.favorites = state.favorites.filter(item => item.arxivId !== arxivId);
  }

  removeOrphanedPapers(state) {
    const savedIds = new Set(state.paperMemberships.map(item => item.arxivId));
    state.favorites = state.favorites.filter(item => savedIds.has(item.arxivId));
  }
}

function requireCollection(state, id) {
  const collection = state.collections.find(item => item.id === id);
  if (!collection) throw new Error("Collection no longer exists. Refresh and try again.");
  return collection;
}

function requirePaperCollection(state, id) {
  const collection = state.paperCollections.find(item => item.id === id);
  if (!collection) throw new Error("Collection no longer exists. Refresh and try again.");
  return collection;
}

// Per-entity guards detect re-save/re-follow and ABA changes while a receipt lives.
// Include collection existence/generation so deleted classifications cannot return.
function entitySnapshots(state) {
  const snapshots = new Map();
  for (const [kind, records, memberships, collections, idField, memberId] of [
    ["paper", state.favorites, state.paperMemberships, state.paperCollections, "arxivId", "arxivId"],
    ["author", state.authors, state.memberships, state.collections, "id", "authorId"],
  ]) {
    const recordsById = new Map(records.map(item => [item[idField], item]));
    const collectionsById = new Map(collections.map(item => [item.id, item]));
    const membersById = new Map();
    for (const item of memberships) {
      if (!membersById.has(item[memberId])) membersById.set(item[memberId], []);
      membersById.get(item[memberId]).push(item);
    }
    for (const collection of collections) snapshots.set(`${kind}-collection:${collection.id}`, JSON.stringify([collection.id, collection.createdAt]));
    for (const id of new Set([...recordsById.keys(), ...membersById.keys()])) {
      const members = (membersById.get(id) || []).sort((a, b) => a.collectionId.localeCompare(b.collectionId));
      snapshots.set(`${kind}:${id}`, JSON.stringify([recordsById.get(id), members,
        members.map(item => { const collection = collectionsById.get(item.collectionId); return [collection?.id, collection?.createdAt]; })]));
    }
  }
  return snapshots;
}

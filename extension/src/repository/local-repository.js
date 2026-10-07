import { PaperRepository } from "./paper-repository.js";
import { createPaper } from "../domain/paper.js";
import { createAuthor } from "../domain/author.js";
import { cleanText, normalizeArxivId } from "../domain/identifiers.js";
import { normalizeCachedAuthorResults } from "../services/arxiv-paper-service.js";
import { exportPortableCategory, mergePortableCategory, parsePortableCategory } from "./portable-library.js";

const newest = field => (a, b) => b[field].localeCompare(a[field]);
const DEFAULT_PAPER_COLLECTION_ID = "paper-collection:saved-papers";

export class LocalRepository extends PaperRepository {
  constructor(storage, clock = () => new Date().toISOString(), makeId = () => crypto.randomUUID()) {
    super();
    this.storage = storage;
    this.clock = clock;
    this.makeId = makeId;
    this.pending = Promise.resolve();
  }

  // One worker instance serializes migrations, reads and writes across all UI contexts.
  run(operation, persistMigration = true) {
    const result = this.pending.then(async () => {
      const stored = await this.storage.read();
      const state = prepareState(stored, this.clock());
      if (persistMigration && stored && stored.schemaVersion !== 5) await this.storage.write(state);
      return operation(state);
    });
    this.pending = result.catch(() => {});
    return result;
  }

  listFavorites() {
    return this.run(state => structuredClone(state.favorites).sort(newest("savedAt")));
  }

  getPaperLibrary() {
    return this.run(state => structuredClone({
      papers: state.favorites, collections: state.paperCollections,
      memberships: state.paperMemberships, settings: state.settings,
    }));
  }

  savePaper(input) {
    return this.run(async state => {
      const paper = this.addPaperToDefaultCollection(state, input);
      await this.storage.write(state);
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
      await this.storage.write(state);
      return exists ? null : paper;
    });
  }

  removeFavorite(arxivId) {
    return this.run(async state => {
      const id = normalizeArxivId(arxivId);
      this.removePaperEverywhere(state, id);
      await this.storage.write(state);
    });
  }

  createPaperCollection(name, paper = null) {
    return this.run(async state => {
      const collection = this.newPaperCollection(state, name);
      state.settings.lastUsedPaperCollectionId = collection.id;
      if (paper !== null) this.addPaperMembership(state, paper, collection.id);
      await this.storage.write(state);
      return structuredClone(collection);
    });
  }

  renamePaperCollection(id, name) {
    return this.run(async state => {
      const collection = requirePaperCollection(state, id);
      collection.name = paperCollectionName(state, name, id);
      collection.updatedAt = this.clock();
      await this.storage.write(state);
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
      await this.storage.write(state);
    });
  }

  addPaperToCollection(input, collectionId) {
    return this.run(async state => {
      const paper = this.addPaperMembership(state, input, collectionId);
      await this.storage.write(state);
      return structuredClone(paper);
    });
  }

  removePaperFromCollection(arxivId, collectionId) {
    return this.run(async state => {
      requirePaperCollection(state, collectionId);
      const id = normalizeArxivId(arxivId);
      state.paperMemberships = state.paperMemberships.filter(item => item.arxivId !== id || item.collectionId !== collectionId);
      this.removeOrphanedPapers(state);
      await this.storage.write(state);
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
      await this.storage.write(state);
      return author;
    });
  }

  createAuthorCollection(name, author = null) {
    return this.run(async state => {
      const collection = this.newCollection(state, name);
      state.settings.lastUsedAuthorCollectionId = collection.id;
      if (author !== null) this.addMembership(state, author, collection.id);
      await this.storage.write(state);
      return collection;
    });
  }

  renameAuthorCollection(id, name) {
    return this.run(async state => {
      const collection = requireCollection(state, id);
      collection.name = collectionName(state, name, id);
      collection.updatedAt = this.clock();
      await this.storage.write(state);
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
      await this.storage.write(state);
    });
  }

  addAuthorToCollection(author, collectionId) {
    return this.run(async state => {
      const record = this.addMembership(state, author, collectionId);
      await this.storage.write(state);
      return record;
    });
  }

  removeAuthorFromCollection(authorId, collectionId) {
    return this.run(async state => {
      requireCollection(state, collectionId);
      state.memberships = state.memberships.filter(item => item.authorId !== authorId || item.collectionId !== collectionId);
      await this.storage.write(state);
    });
  }

  unfollowAuthor(id) {
    return this.run(async state => {
      if (typeof id !== "string" || !id.startsWith("arxiv-author:name:v1:")) throw new TypeError("Invalid author ID.");
      state.memberships = state.memberships.filter(item => item.authorId !== id);
      await this.storage.write(state);
    });
  }

  getAuthorPaperCache(authorId) {
    return this.run(state => structuredClone(state.authorPaperCaches.find(item => item.authorId === authorId) ?? null));
  }

  putAuthorPaperCache(input) {
    return this.run(async state => {
      const cache = normalizeCachedAuthorResults(input);
      state.authorPaperCaches = state.authorPaperCaches.filter(item => item.authorId !== cache.authorId);
      state.authorPaperCaches.push(cache);
      await this.storage.write(state);
      return structuredClone(cache);
    });
  }

  getPreferences() {
    return this.run(state => structuredClone({
      openArxivLinksInNewTab: state.settings.openArxivLinksInNewTab,
      organizeFollowedAuthorsIntoCollections: state.settings.organizeFollowedAuthorsIntoCollections,
    }));
  }

  setOpenArxivLinksInNewTab(enabled) {
    if (typeof enabled !== "boolean") return Promise.reject(new TypeError("The link preference must be true or false."));
    return this.run(async state => {
      state.settings.openArxivLinksInNewTab = enabled;
      await this.storage.write(state);
      return structuredClone({ openArxivLinksInNewTab: enabled });
    });
  }

  setOrganizeFollowedAuthorsIntoCollections(enabled) {
    if (typeof enabled !== "boolean") return Promise.reject(new TypeError("The author collection preference must be true or false."));
    return this.run(async state => {
      state.settings.organizeFollowedAuthorsIntoCollections = enabled;
      await this.storage.write(state);
      return structuredClone({ organizeFollowedAuthorsIntoCollections: enabled });
    });
  }

  exportCategory(category, selection) {
    return this.run(state => structuredClone(exportPortableCategory(state, this.clock(), category, selection)));
  }

  async importCategory(text, category) {
    const backup = parsePortableCategory(text, category);
    return this.run(async state => {
      const merged = mergePortableCategory(state, backup);
      const proposed = prepareState(merged.state, this.clock());
      await this.storage.write(proposed);
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

function validDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** One-time schema 1 -> 2 migration. Favorites are deliberately not rewritten. */
function migrateFollowing(authors) {
  const merged = new Map();
  for (const author of authors) {
    const oldName = cleanText(author.displayName, "Author name").toLowerCase();
    const paperId = normalizeArxivId(author.sourceArxivId);
    const index = author.sourceAuthorIndex;
    const oldId = `arxiv-author:v1:${paperId}:${index}:${encodeURIComponent(oldName)}`;
    if (!Number.isSafeInteger(index) || index < 0 || author.id !== oldId
        || !validDate(author.followedAt) || !validDate(author.updatedAt)) {
      throw new Error("Invalid followed author data. Migration left existing data unchanged.");
    }
    const { sourceArxivId, sourceAuthorIndex, ...retained } = author;
    const canonical = {
      ...retained,
      ...createAuthor(author, author.followedAt),
      updatedAt: author.updatedAt,
    };
    const previous = merged.get(canonical.id);
    if (!previous) {
      merged.set(canonical.id, canonical);
      continue;
    }
    // Latest updated record supplies the spelling and optional fields; ties keep
    // the first stored record. Preserve the earliest time the author was followed.
    const winner = Date.parse(canonical.updatedAt) > Date.parse(previous.updatedAt) ? canonical : previous;
    merged.set(canonical.id, {
      ...winner,
      followedAt: Date.parse(canonical.followedAt) < Date.parse(previous.followedAt)
        ? canonical.followedAt : previous.followedAt,
    });
  }
  return [...merged.values()];
}

function requireCollection(state, id) {
  const collection = state.collections.find(item => item.id === id);
  if (!collection) throw new Error("Collection no longer exists. Refresh and try again.");
  return collection;
}

function collectionName(state, value, exceptId) {
  const name = cleanText(value, "Collection name");
  if (name.length > 80) throw new Error("Collection names must be at most 80 characters.");
  if (state.collections.some(item => item.id !== exceptId && item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("A collection with this name already exists.");
  }
  return name;
}

function requirePaperCollection(state, id) {
  const collection = state.paperCollections.find(item => item.id === id);
  if (!collection) throw new Error("Collection no longer exists. Refresh and try again.");
  return collection;
}

function paperCollectionName(state, value, exceptId) {
  const name = cleanText(value, "Collection name");
  if (name.length > 80) throw new Error("Collection names must be at most 80 characters.");
  if (state.paperCollections.some(item => item.id !== exceptId && item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("A collection with this name already exists.");
  }
  return name;
}

export function prepareState(stored, now) {
  const state = stored === undefined ? {
    schemaVersion: 5, favorites: [],
    paperCollections: [{ id: DEFAULT_PAPER_COLLECTION_ID, name: "Saved Papers", createdAt: now, updatedAt: now }],
    paperMemberships: [], authors: [], collections: [], memberships: [], authorPaperCaches: [],
    settings: {
      lastUsedAuthorCollectionId: null,
      lastUsedPaperCollectionId: DEFAULT_PAPER_COLLECTION_ID,
      openArxivLinksInNewTab: false,
      organizeFollowedAuthorsIntoCollections: false,
    },
  } : structuredClone(stored);
  if (!state || ![1, 2, 3, 4, 5].includes(state.schemaVersion) || !Array.isArray(state.favorites)) {
    throw new Error("Unsupported or damaged library data. Existing data was left unchanged.");
  }
  for (const paper of state.favorites) {
    const validated = createPaper(paper, paper.savedAt);
    if (paper.arxivId !== validated.arxivId || !validDate(paper.savedAt) || !validDate(paper.updatedAt)) {
      throw new Error("Invalid saved paper data.");
    }
  }
  if (state.schemaVersion < 3) {
    if (!Array.isArray(state.following)) throw new Error("Invalid followed author data.");
    if (state.schemaVersion === 1) state.following = migrateFollowing(state.following);
    state.authors = state.following;
    state.collections = [{ id: "collection:following", name: "Following", createdAt: now, updatedAt: now }];
    state.memberships = state.authors.map(author => ({
      authorId: author.id, collectionId: "collection:following",
      addedAt: author.followedAt, updatedAt: author.updatedAt,
    }));
    state.settings = { ...state.settings, lastUsedAuthorCollectionId: "collection:following" };
    delete state.following;
    state.schemaVersion = 3;
  }
  if (![state.authors, state.collections, state.memberships].every(Array.isArray) || !state.settings) {
    throw new Error("Invalid author collection data.");
  }
  if (state.settings.openArxivLinksInNewTab === undefined) state.settings.openArxivLinksInNewTab = false;
  if (typeof state.settings.openArxivLinksInNewTab !== "boolean") throw new Error("Invalid link preference.");
  if (state.settings.organizeFollowedAuthorsIntoCollections === undefined) state.settings.organizeFollowedAuthorsIntoCollections = false;
  if (typeof state.settings.organizeFollowedAuthorsIntoCollections !== "boolean") throw new Error("Invalid author collection preference.");
  const authorIds = new Set();
  for (const author of state.authors) {
    const validated = createAuthor(author, author.followedAt);
    if (author.id !== validated.id || author.normalizedName !== validated.normalizedName
        || !validDate(author.followedAt) || !validDate(author.updatedAt) || authorIds.has(author.id)) {
      throw new Error("Invalid followed author data.");
    }
    authorIds.add(author.id);
  }
  const collectionIds = new Set();
  for (const collection of state.collections) {
    if (typeof collection.id !== "string" || !collection.id.startsWith("collection:")
        || collectionIds.has(collection.id) || !validDate(collection.createdAt) || !validDate(collection.updatedAt)) {
      throw new Error("Invalid collection data.");
    }
    collectionName(state, collection.name, collection.id);
    collectionIds.add(collection.id);
  }
  const pairs = new Set();
  for (const item of state.memberships) {
    const key = JSON.stringify([item.authorId, item.collectionId]);
    if (!authorIds.has(item.authorId) || !collectionIds.has(item.collectionId) || pairs.has(key)
        || !validDate(item.addedAt) || !validDate(item.updatedAt)) throw new Error("Invalid collection membership.");
    pairs.add(key);
  }
  const lastUsed = state.settings.lastUsedAuthorCollectionId;
  if (lastUsed !== null && !collectionIds.has(lastUsed)) throw new Error("Invalid last-used collection.");
  if (state.schemaVersion === 3) {
    state.authorPaperCaches = [];
    state.schemaVersion = 4;
  }
  if (!Array.isArray(state.authorPaperCaches)) throw new Error("Invalid author paper cache data.");
  state.authorPaperCaches = state.authorPaperCaches.map(normalizeCachedAuthorResults);
  if (state.schemaVersion === 4) {
    state.paperCollections = [{ id: DEFAULT_PAPER_COLLECTION_ID, name: "Saved Papers", createdAt: now, updatedAt: now }];
    state.paperMemberships = state.favorites.map(paper => ({
      arxivId: paper.arxivId, collectionId: DEFAULT_PAPER_COLLECTION_ID,
      addedAt: paper.savedAt, updatedAt: paper.updatedAt,
    }));
    state.settings = { ...state.settings, lastUsedPaperCollectionId: DEFAULT_PAPER_COLLECTION_ID };
    state.schemaVersion = 5;
  }
  if (!Array.isArray(state.paperCollections) || !Array.isArray(state.paperMemberships)) {
    throw new Error("Invalid paper collection data.");
  }
  const paperIds = new Set(state.favorites.map(paper => paper.arxivId));
  const paperCollectionIds = new Set();
  for (const collection of state.paperCollections) {
    if (typeof collection.id !== "string" || !collection.id.startsWith("paper-collection:")
        || paperCollectionIds.has(collection.id) || !validDate(collection.createdAt) || !validDate(collection.updatedAt)) {
      throw new Error("Invalid paper collection data.");
    }
    paperCollectionName(state, collection.name, collection.id);
    paperCollectionIds.add(collection.id);
  }
  const paperPairs = new Set();
  for (const item of state.paperMemberships) {
    const key = JSON.stringify([item.arxivId, item.collectionId]);
    if (!paperIds.has(item.arxivId) || !paperCollectionIds.has(item.collectionId) || paperPairs.has(key)
        || !validDate(item.addedAt) || !validDate(item.updatedAt)) throw new Error("Invalid paper collection membership.");
    paperPairs.add(key);
  }
  for (const paperId of paperIds) {
    if (!state.paperMemberships.some(item => item.arxivId === paperId)) throw new Error("Saved paper has no collection membership.");
  }
  const lastUsedPaper = state.settings.lastUsedPaperCollectionId;
  if (lastUsedPaper !== null && !paperCollectionIds.has(lastUsedPaper)) throw new Error("Invalid last-used paper collection.");
  return state;
}

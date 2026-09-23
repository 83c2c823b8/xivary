import { PaperRepository } from "./paper-repository.js";
import { createPaper } from "../domain/paper.js";
import { createAuthor } from "../domain/author.js";
import { cleanText, normalizeArxivId } from "../domain/identifiers.js";

const newest = field => (a, b) => b[field].localeCompare(a[field]);

export class LocalRepository extends PaperRepository {
  constructor(storage, clock = () => new Date().toISOString()) {
    super();
    this.storage = storage;
    this.clock = clock;
    this.pending = Promise.resolve();
  }

  // One instance in the worker is the sole writer. Reads join the same queue.
  run(operation) {
    const result = this.pending.then(async () => {
      const stored = await this.storage.read();
      const state = stored === undefined
        ? { schemaVersion: 2, favorites: [], following: [] }
        : stored;
      if (!state || ![1, 2].includes(state.schemaVersion) || !Array.isArray(state.favorites)
          || !Array.isArray(state.following)) {
        throw new Error("Unsupported or damaged library data. Existing data was left unchanged.");
      }
      // Validate before any write; preserve unknown fields for future migrations.
      for (const paper of state.favorites) {
        const validated = createPaper(paper, paper.savedAt);
        if (paper.arxivId !== validated.arxivId || !validDate(paper.savedAt)
            || !validDate(paper.updatedAt)) throw new Error("Invalid saved paper data.");
      }
      const needsMigration = state.schemaVersion === 1;
      if (needsMigration) state.following = migrateFollowing(state.following);
      for (const author of state.following) {
        const validated = createAuthor(author, author.followedAt);
        if (author.id !== validated.id || !validDate(author.followedAt)
            || !validDate(author.updatedAt)) throw new Error("Invalid followed author data.");
      }
      if (needsMigration) {
        state.schemaVersion = 2;
        await this.storage.write(state);
      }
      return operation(state);
    });
    this.pending = result.catch(() => {});
    return result;
  }

  listFavorites() {
    return this.run(state => structuredClone(state.favorites).sort(newest("savedAt")));
  }

  listFollowing() {
    return this.run(state => structuredClone(state.following).sort(newest("followedAt")));
  }

  toggleFavorite(input) {
    return this.run(async state => {
      const paper = createPaper(input, this.clock());
      const exists = state.favorites.some(item => item.arxivId === paper.arxivId);
      state.favorites = state.favorites.filter(item => item.arxivId !== paper.arxivId);
      if (!exists) state.favorites.push(paper);
      await this.storage.write(state);
      return exists ? null : paper;
    });
  }

  removeFavorite(arxivId) {
    return this.run(async state => {
      const id = normalizeArxivId(arxivId);
      state.favorites = state.favorites.filter(paper => paper.arxivId !== id);
      await this.storage.write(state);
    });
  }

  toggleFollow(input) {
    return this.run(async state => {
      const author = createAuthor(input, this.clock());
      const exists = state.following.some(item => item.id === author.id);
      state.following = state.following.filter(item => item.id !== author.id);
      if (!exists) state.following.push(author);
      await this.storage.write(state);
      return exists ? null : author;
    });
  }

  unfollowAuthor(id) {
    return this.run(async state => {
      if (typeof id !== "string" || !id.startsWith("arxiv-author:name:v1:")) {
        throw new TypeError("Invalid author ID.");
      }
      state.following = state.following.filter(author => author.id !== id);
      await this.storage.write(state);
    });
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

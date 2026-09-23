import { PaperRepository } from "./paper-repository.js";
import { createPaper } from "../domain/paper.js";
import { createAuthor } from "../domain/author.js";
import { normalizeArxivId } from "../domain/identifiers.js";

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
        ? { schemaVersion: 1, favorites: [], following: [] }
        : stored;
      if (!state || state.schemaVersion !== 1 || !Array.isArray(state.favorites)
          || !Array.isArray(state.following)) {
        throw new Error("Unsupported or damaged library data. Existing data was left unchanged.");
      }
      // Validate before any write; preserve unknown fields for future migrations.
      for (const paper of state.favorites) {
        const validated = createPaper(paper, paper.savedAt);
        if (paper.arxivId !== validated.arxivId || !validDate(paper.savedAt)
            || !validDate(paper.updatedAt)) throw new Error("Invalid saved paper data.");
      }
      for (const author of state.following) {
        const validated = createAuthor(author, author.followedAt);
        if (author.id !== validated.id || !validDate(author.followedAt)
            || !validDate(author.updatedAt)) throw new Error("Invalid followed author data.");
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
      if (typeof id !== "string" || !id.startsWith("arxiv-author:v1:")) {
        throw new TypeError("Invalid author reference ID.");
      }
      state.following = state.following.filter(author => author.id !== id);
      await this.storage.write(state);
    });
  }
}

function validDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

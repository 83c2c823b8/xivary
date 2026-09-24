/** Asynchronous persistence contract. UI code depends only on these methods.
 * JSON-compatible records; failures reject with Error. Lists are newest first.
 * Favorite toggle returns a record or null. Follow/add membership is idempotent.
 * Author entities persist independently of their many-to-many memberships.
 */
export class PaperRepository {
  async listFavorites() { throw new Error("Not implemented"); }
  async getPaperLibrary() { throw new Error("Not implemented"); }
  async savePaper(paper) { throw new Error("Not implemented"); }
  async listFollowing() { throw new Error("Not implemented"); }
  async toggleFavorite(paper) { throw new Error("Not implemented"); }
  async removeFavorite(arxivId) { throw new Error("Not implemented"); }
  async createPaperCollection(name, paper = null) { throw new Error("Not implemented"); }
  async renamePaperCollection(id, name) { throw new Error("Not implemented"); }
  async deletePaperCollection(id) { throw new Error("Not implemented"); }
  async addPaperToCollection(paper, collectionId) { throw new Error("Not implemented"); }
  async removePaperFromCollection(arxivId, collectionId) { throw new Error("Not implemented"); }
  async followAuthor(author) { throw new Error("Not implemented"); }
  async unfollowAuthor(id) { throw new Error("Not implemented"); }
  async getAuthorLibrary() { throw new Error("Not implemented"); }
  async createAuthorCollection(name, author = null) { throw new Error("Not implemented"); }
  async renameAuthorCollection(id, name) { throw new Error("Not implemented"); }
  async deleteAuthorCollection(id) { throw new Error("Not implemented"); }
  async addAuthorToCollection(author, collectionId) { throw new Error("Not implemented"); }
  async removeAuthorFromCollection(authorId, collectionId) { throw new Error("Not implemented"); }
  async getAuthorPaperCache(authorId) { throw new Error("Not implemented"); }
  async putAuthorPaperCache(cache) { throw new Error("Not implemented"); }
}

/** Asynchronous persistence contract. UI code depends only on these methods.
 * JSON-compatible records; failures reject with Error. Lists are newest first.
 * Toggle returns the saved record, or null when removed. Remove is idempotent.
 * Despite its name this MVP interface also owns followed author references.
 */
export class PaperRepository {
  async listFavorites() { throw new Error("Not implemented"); }
  async listFollowing() { throw new Error("Not implemented"); }
  async toggleFavorite(paper) { throw new Error("Not implemented"); }
  async removeFavorite(arxivId) { throw new Error("Not implemented"); }
  async toggleFollow(author) { throw new Error("Not implemented"); }
  async unfollowAuthor(id) { throw new Error("Not implemented"); }
}

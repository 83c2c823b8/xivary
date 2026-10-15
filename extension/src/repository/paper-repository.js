/** Asynchronous persistence contract. UI code depends only on these methods.
 * JSON-compatible records; failures reject with Error. Lists are newest first.
 * Favorite toggle returns a record or null. Follow/add membership is idempotent.
 * Author entities persist independently of their many-to-many memberships.
 */
export class PaperRepository {
  async setFollowingSelection(id) { throw new Error("Not implemented"); }
  async moveAuthorCollection(id, beforeId) { throw new Error("Not implemented"); }
  async setLibrarySelection(id) { throw new Error("Not implemented"); }
  async moveAuthorInCollection(collectionId, id, beforeId) { throw new Error('Not implemented'); }
  async moveFollowedAuthor(id, beforeId) { throw new Error('Not implemented'); }
  async initialize() { throw new Error("Not implemented"); }
  async exportBackup(category, selection) { throw new Error('Not implemented'); }
  async importBackup(inputs, category) { throw new Error('Not implemented'); }
  async movePaperCollection(id, beforeId) { throw new Error('Not implemented'); }
  async movePaperInCollection(collectionId, arxivId, beforeId) { throw new Error('Not implemented'); }
  async getFollowingFeedCache() { throw new Error("Not implemented"); }
  async putFollowingFeedCache(cache) { throw new Error("Not implemented"); }
  async beginFollowingFeedDiscovery(manual) { throw new Error("Not implemented"); }
  async commitFollowingFeedDiscovery(result) { throw new Error("Not implemented"); }
  async failFollowingFeedDiscovery(token) { throw new Error("Not implemented"); }
  async getFollowingFeedEvidence() { throw new Error("Not implemented"); }
  async putFollowingFeedEvidence(cache) { throw new Error("Not implemented"); }
  async readOfflinePdf(id) { throw new Error("Not implemented"); }
  async getOfflineLibrary() { throw new Error("Not implemented"); }
  async getOfflineCopy(id) { throw new Error("Not implemented"); }
  async saveOfflinePaper(paper, update) { throw new Error("Not implemented"); }
  async removeOfflineCopy(id) { throw new Error("Not implemented"); }
  async cancelOfflineSave(id) { throw new Error("Not implemented"); }
  async getOfflinePdfChunk(id, revision, offset) { throw new Error("Not implemented"); }
  async openOfflinePaper(id) { throw new Error("Not implemented"); }
  async getArxivRequestState() { throw new Error("Not implemented"); }
  async setArxivRequestState(state) { throw new Error("Not implemented"); }
  async setVimMode(enabled) { throw new Error("Not implemented"); }
  async setRenderLatexInAbstracts(enabled) { throw new Error("Not implemented"); }
  async setCustomLatexMacros(text) { throw new Error("Not implemented"); }
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
  async setOpenXivaryFromToolbarInNewTab(enabled) { throw new Error("Not implemented"); }
  async setOpenAuthorResultsInNewTab(enabled) { throw new Error("Not implemented"); }
  async undoRemoval(token) { throw new Error("Not implemented"); }
  async getPreferences() { throw new Error("Not implemented"); }
  async setOpenArxivLinksInNewTab(enabled) { throw new Error("Not implemented"); }
  async setOrganizeFollowedAuthorsIntoCollections(enabled) { throw new Error("Not implemented"); }
  async exportCategory(category, selection) { throw new Error("Not implemented"); }
  async importCategory(text, category) { throw new Error("Not implemented"); }
}

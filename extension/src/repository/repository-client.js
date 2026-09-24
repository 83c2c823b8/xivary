import { PaperRepository } from "./paper-repository.js";

export const REPOSITORY_CHANNEL = "arxiv-library:repository:v1";

/** Transport adapter; UI never knows whether the worker uses local or HTTP data. */
export class RepositoryClient extends PaperRepository {
  constructor(runtime = globalThis.chrome.runtime) {
    super();
    this.runtime = runtime;
  }

  async request(method, args = []) {
    const response = await this.runtime.sendMessage({ channel: REPOSITORY_CHANNEL, method, args });
    if (!response?.ok) throw new Error(response?.error || "The library is unavailable. Reload this page and try again.");
    return response.result;
  }

  listFavorites() { return this.request("listFavorites"); }
  getPaperLibrary() { return this.request("getPaperLibrary"); }
  savePaper(paper) { return this.request("savePaper", [paper]); }
  listFollowing() { return this.request("listFollowing"); }
  toggleFavorite(paper) { return this.request("toggleFavorite", [paper]); }
  removeFavorite(arxivId) { return this.request("removeFavorite", [arxivId]); }
  createPaperCollection(name, paper = null) { return this.request("createPaperCollection", [name, paper]); }
  renamePaperCollection(id, name) { return this.request("renamePaperCollection", [id, name]); }
  deletePaperCollection(id) { return this.request("deletePaperCollection", [id]); }
  addPaperToCollection(paper, collectionId) { return this.request("addPaperToCollection", [paper, collectionId]); }
  removePaperFromCollection(arxivId, collectionId) { return this.request("removePaperFromCollection", [arxivId, collectionId]); }
  followAuthor(author) { return this.request("followAuthor", [author]); }
  unfollowAuthor(id) { return this.request("unfollowAuthor", [id]); }
  getAuthorLibrary() { return this.request("getAuthorLibrary"); }
  createAuthorCollection(name, author = null) { return this.request("createAuthorCollection", [name, author]); }
  renameAuthorCollection(id, name) { return this.request("renameAuthorCollection", [id, name]); }
  deleteAuthorCollection(id) { return this.request("deleteAuthorCollection", [id]); }
  addAuthorToCollection(author, collectionId) { return this.request("addAuthorToCollection", [author, collectionId]); }
  removeAuthorFromCollection(authorId, collectionId) { return this.request("removeAuthorFromCollection", [authorId, collectionId]); }
  getAuthorPaperCache(authorId) { return this.request("getAuthorPaperCache", [authorId]); }
  putAuthorPaperCache(cache) { return this.request("putAuthorPaperCache", [cache]); }
  getPreferences() { return this.request("getPreferences"); }
  setOpenArxivLinksInNewTab(enabled) { return this.request("setOpenArxivLinksInNewTab", [enabled]); }
  setOrganizeFollowedAuthorsIntoCollections(enabled) { return this.request("setOrganizeFollowedAuthorsIntoCollections", [enabled]); }
}

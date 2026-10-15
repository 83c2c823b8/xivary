import { normalizeLibrarySnapshot } from '../domain/library-snapshot.js';
import { PaperRepository } from "./paper-repository.js";
import { getBrowserApi } from "../platform/browser-api.js";

export const REPOSITORY_CHANNEL = "arxiv-library:repository:v1";
export const PREFERENCES_CHANGED_CHANNEL = "xivary:preferences-changed:v1";

/** Transport adapter; UI never knows whether the worker uses local or HTTP data. */
export class RepositoryClient extends PaperRepository {
  constructor(runtime = getBrowserApi().runtime) {
    super();
    this.runtime = runtime;
  }

  getOfflineLibrary() { return this.request("getOfflineLibrary"); }
  getOfflineCopy(id) { return this.request("getOfflineCopy", [id]); }
  saveOfflinePaper(paper, update = false) { return this.request("saveOfflinePaper", [paper, update]); }
  removeOfflineCopy(id) { return this.request("removeOfflineCopy", [id]); }
  cancelOfflineSave(id) { return this.request("cancelOfflineSave", [id]); }
  getOfflinePdfChunk(id, revision, offset) { return this.request("getOfflinePdfChunk", [id, revision, offset]); }
  openOfflinePaper(id) { return this.request("openOfflinePaper", [id]); }
  subscribeOffline(changed) {
    const listener = (message, sender) => {
      if (message?.channel === "xivary:offline-changed:v1" && sender.id === this.runtime.id) changed();
      return false;
    };
    this.runtime.onMessage.addListener(listener);
    return () => this.runtime.onMessage.removeListener(listener);
  }
  // Bounded JSON messages keep large blobs out of the Chrome messaging serializer.
  async readOfflinePdf(id) {
    const copy = await this.getOfflineCopy(id);
    if (!copy) throw new Error("This paper has no offline copy.");
    const parts = [];
    for (let offset = 0; offset < copy.size; offset += 512 * 1024) {
      const text = atob(await this.getOfflinePdfChunk(id, copy.revision || copy.savedAt, offset));
      const bytes = Uint8Array.from(text, character => character.charCodeAt(0));
      if (bytes.length !== Math.min(512 * 1024, copy.size - offset)) throw new Error("Offline PDF is incomplete.");
      parts.push(bytes);
    }
    return { copy, blob: new Blob(parts, { type: "application/pdf" }) };
  }

  get available() { return this.runtime.available !== false; }
  getFollowingFeedCache() { return this.request("getFollowingFeedCache"); }
  putFollowingFeedCache(cache) { return this.request("putFollowingFeedCache", [cache]); }
  beginFollowingFeedDiscovery(manual) { return this.request('beginFollowingFeedDiscovery', [manual]); }
  commitFollowingFeedDiscovery(result) { return this.request('commitFollowingFeedDiscovery', [result]); }
  failFollowingFeedDiscovery(token) { return this.request('failFollowingFeedDiscovery', [token]); }
  subscribeFollowingFeed(changed) {
    const listener = (message, sender) => {
      if (message?.channel === 'xivary:feed-changed:v1' && sender.id === this.runtime.id) changed();
      return false;
    };
    this.runtime.onMessage.addListener(listener);
    return () => this.runtime.onMessage.removeListener(listener);
  }
  getFollowingFeedEvidence() { return this.request("getFollowingFeedEvidence"); }
  putFollowingFeedEvidence(cache) { return this.request("putFollowingFeedEvidence", [cache]); }
  setVimMode(enabled) { return this.request("setVimMode", [enabled]); }

  /** Notifications invalidate a view; fresh values still cross the repository. */
  subscribePreferences(changed) {
    const listener = (message, sender) => {
      if (message?.channel === PREFERENCES_CHANGED_CHANNEL && sender.id === this.runtime.id) changed();
      return false;
    };
    this.runtime.onMessage.addListener(listener);
    return () => this.runtime.onMessage.removeListener(listener);
  }
  setRenderLatexInAbstracts(enabled) { return this.request("setRenderLatexInAbstracts", [enabled]); }
  setCustomLatexMacros(text) { return this.request("setCustomLatexMacros", [text]); }

  async request(method, args = []) {
    const response = await this.runtime.sendMessage({ channel: REPOSITORY_CHANNEL, method, args });
    if (!response?.ok) throw new Error(response?.error || "The library is unavailable. Reload this page and try again.");
    return response.result;
  }

  exportBackup(category, selection = { kind: 'all' }) { return this.request('exportBackup', [category, selection]); }
  importBackup(inputs, category = 'all') { return this.request('importBackup', [inputs, category]); }

  setFollowingSelection(id) { return this.request("setFollowingSelection", [id]); }
  moveAuthorCollection(id, beforeId) { return this.request("moveAuthorCollection", [id, beforeId]); }
  setLibrarySelection(id) { return this.request("setLibrarySelection", [id]); }
  listFavorites() { return this.request("listFavorites"); }
  async initialize() { return this.request("initialize"); }
  async getPaperLibrary() { return normalizeLibrarySnapshot(await this.request("getPaperLibrary")); }
  movePaperCollection(id, beforeId) { return this.request('movePaperCollection', [id, beforeId]); }
  movePaperInCollection(collectionId, arxivId, beforeId) { return this.request('movePaperInCollection', [collectionId, arxivId, beforeId]); }
  savePaper(paper) { return this.request("savePaper", [paper]); }
  listFollowing() { return this.request("listFollowing"); }
  moveAuthorInCollection(collectionId, id, beforeId) { return this.request('moveAuthorInCollection', [collectionId, id, beforeId]); }
  moveFollowedAuthor(id, beforeId) { return this.request('moveFollowedAuthor', [id, beforeId]); }
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
  setOpenXivaryFromToolbarInNewTab(enabled) { return this.request("setOpenXivaryFromToolbarInNewTab", [enabled]); }
  setOpenAuthorResultsInNewTab(enabled) { return this.request("setOpenAuthorResultsInNewTab", [enabled]); }
  undoRemoval(token) { return this.request("undoRemoval", [token]); }
  getPreferences() { return this.request("getPreferences"); }
  setOpenArxivLinksInNewTab(enabled) { return this.request("setOpenArxivLinksInNewTab", [enabled]); }
  setOrganizeFollowedAuthorsIntoCollections(enabled) { return this.request("setOrganizeFollowedAuthorsIntoCollections", [enabled]); }
  exportCategory(category, selection = { kind: "all" }) { return this.request("exportCategory", [category, selection]); }
  importCategory(text, category) { return this.request("importCategory", [text, category]); }
}

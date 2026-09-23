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
  listFollowing() { return this.request("listFollowing"); }
  toggleFavorite(paper) { return this.request("toggleFavorite", [paper]); }
  removeFavorite(arxivId) { return this.request("removeFavorite", [arxivId]); }
  toggleFollow(author) { return this.request("toggleFollow", [author]); }
  unfollowAuthor(id) { return this.request("unfollowAuthor", [id]); }
}

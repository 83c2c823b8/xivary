import { REPOSITORY_CHANNEL } from "../repository/repository-client.js";

const methods = new Map([
  ["listFavorites", 0], ["listFollowing", 0], ["toggleFavorite", 1],
  ["removeFavorite", 1], ["followAuthor", 1], ["unfollowAuthor", 1],
  ["getAuthorLibrary", 0], ["createAuthorCollection", 2], ["renameAuthorCollection", 2],
  ["deleteAuthorCollection", 1], ["addAuthorToCollection", 2], ["removeAuthorFromCollection", 2],
  ["getAuthorPaperCache", 1], ["putAuthorPaperCache", 1],
]);

export function createRepositoryHandler(repository, extensionId) {
  return (message, sender, sendResponse) => {
    if (message?.channel !== REPOSITORY_CHANNEL) return false;
    if (sender.id !== extensionId || !methods.has(message.method)
        || !Array.isArray(message.args) || message.args.length !== methods.get(message.method)) {
      sendResponse({ ok: false, error: "Invalid library request." });
      return false;
    }
    Promise.resolve().then(() => repository[message.method](...message.args)).then(
      result => sendResponse({ ok: true, result: result ?? null }),
      error => sendResponse({ ok: false, error: error.message || "Unable to update the library." }),
    );
    // Keep the MV3 message channel alive until the storage operation completes.
    return true;
  };
}

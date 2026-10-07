import { authorResultsUrl } from "../author/author-route.js";

export const AUTHOR_NAVIGATION_CHANNEL = "xivary.author-navigation";

export function createAuthorNavigationHandler(api) {
  return (message, sender, sendResponse) => {
    if (message?.channel !== AUTHOR_NAVIGATION_CHANNEL) return false;
    if (sender.id !== api.runtime.id || typeof message.name !== "string" || !sender.url?.startsWith("https://arxiv.org/abs/")) {
      sendResponse({ ok: false });
      return false;
    }
    Promise.resolve().then(() => api.tabs.create({ url: authorResultsUrl(message.name, api.runtime) })).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  };
}

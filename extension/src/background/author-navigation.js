import { authorResultsUrl } from "../author/author-route.js";

export const AUTHOR_NAVIGATION_CHANNEL = "xivary.author-navigation";

export function createAuthorNavigationHandler(api, repository) {
  return (message, sender, sendResponse) => {
    if (message?.channel !== AUTHOR_NAVIGATION_CHANNEL) return false;
    if (sender.id !== api.runtime.id || typeof message.name !== "string" || !supportedSender(sender.url)) {
      sendResponse({ ok: false });
      return false;
    }
    Promise.resolve().then(async () => {
      const url = authorResultsUrl(message.name, api.runtime);
      const preferences = await repository.getPreferences();
      if (preferences.openAuthorResultsInNewTab) return api.tabs.create({ url });
      if (!Number.isInteger(sender.tab?.id)) throw new Error("Missing source tab.");
      return api.tabs.update(sender.tab.id, { url });
    }).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  };
}

function supportedSender(value) {
  try { const url = new URL(value); return url.origin === "https://arxiv.org" &&
    (url.pathname.startsWith("/abs/") || /^\/search\/(?:[^/]+)?\/?$/.test(url.pathname)); }
  catch { return false; }
}

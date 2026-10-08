const pages = new Set(['library/library.html', 'authors/authors.html']);

/** The toolbar popup remains the launcher; other navigation does not use this. */
export async function launchPage(api, repository, page) {
  if (!pages.has(page)) throw new Error('Unsupported launcher page.');
  const url = api.runtime.getURL(`src/${page}`);
  const preferences = await repository.getPreferences();
  if (preferences.openXivaryFromToolbarInNewTab) return api.tabs.create({ url });
  let active;
  try { [active] = await api.tabs.query({ active: true, currentWindow: true }); }
  catch { /* No reliable source tab: preserve it and open one new tab. */ }
  const restricted = active?.url && !/^(?:https?:|file:|chrome-extension:|moz-extension:)/.test(active.url)
    && !['about:blank', 'about:newtab', 'chrome://newtab/'].includes(active.url);
  if (!Number.isInteger(active?.id) || active.id < 0 || restricted) return api.tabs.create({ url });
  // URL may be withheld without tabs permission. Native navigation decides whether
  // this tab is navigable. Rejection surfaces in the popup, never causes a second write.
  return api.tabs.update(active.id, { url });
}

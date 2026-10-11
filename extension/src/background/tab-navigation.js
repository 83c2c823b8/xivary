import { TAB_NAVIGATION_CHANNEL } from '../platform/tab-navigation.js';

/** Only tab IDs/indices are needed; no broad tabs permission or URL discovery. */
export function adjacentTab(tabs, sourceId, direction) {
  const ordered = [...tabs].sort((a, b) => a.index - b.index);
  const index = ordered.findIndex(tab => tab.id === sourceId);
  if (index < 0 || ordered.length < 2) return null;
  return ordered[(index + direction + ordered.length) % ordered.length];
}

export function createTabNavigationHandler(api, repository) {
  const paths = new Set(['src/library/library.html', 'src/authors/authors.html', 'src/author/author.html', 'src/settings/settings.html']);
  return (message, sender, respond) => {
    if (message?.channel !== TAB_NAVIGATION_CHANNEL) return false;
    const allowed = [...paths].some(path => sender.url?.split(/[?#]/, 1)[0] === api.runtime.getURL(path));
    if (sender.id !== api.runtime.id || !allowed || !Number.isInteger(message.sourceTabId) ||
        ![1,-1].includes(message.direction)) { respond({ ok: false }); return false; }
    const run = async () => {
      if (!(await repository.getPreferences()).vimMode) return false;
      const source = await api.tabs.get(message.sourceTabId);
      // Never let a stale request switch tabs after the source lost activation.
      if (!source.active || (source.url !== undefined && source.url !== sender.url) || (sender.tab && sender.tab.id !== source.id)) return false;
      const tabs = await api.tabs.query({ windowId: source.windowId });
      const target = adjacentTab(tabs, source.id, message.direction);
      if (!target || !tabs.some(tab => tab.id === source.id && tab.active)) return false;
      const live = await api.tabs.get(source.id);
      if (!live.active || live.windowId !== source.windowId || (live.url !== undefined && live.url !== sender.url)) return false;
      await api.tabs.update(target.id, { active: true });
      return true;
    };
    void run().then(result => respond({ ok: true, result }), () => respond({ ok: false }));
    return true;
  };
}

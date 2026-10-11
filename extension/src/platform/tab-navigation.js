import { getBrowserApi } from './browser-api.js';

export const TAB_NAVIGATION_CHANNEL = 'xivary:tab-navigation:v1';

/** Identify the requesting extension tab, rather than guessing a focused window. */
export async function activateAdjacentTab(direction, api = getBrowserApi()) {
  const source = await api.tabs.getCurrent();
  if (!Number.isInteger(source?.id)) return false;
  const response = await api.runtime.sendMessage({ channel: TAB_NAVIGATION_CHANNEL, sourceTabId: source.id, direction });
  return response?.ok === true && response.result === true;
}

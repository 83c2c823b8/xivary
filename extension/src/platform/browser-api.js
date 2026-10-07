/** Native Promise APIs: Firefox's browser namespace, Chromium's chrome fallback.
 * Resolve lazily so portable modules and injected test doubles need no browser.
 * Keep API objects intact: methods must retain their native receiver.
 */
export function getBrowserApi(scope = globalThis) {
  const api = scope.browser ?? scope.chrome;
  if (!api?.runtime) throw new Error("Xivary requires a browser extension context.");
  return api;
}

/** Package capability, not user-agent sniffing. Firefox's generated event-page
 * manifest intentionally never opts into the Chrome sync implementation.
 */
export function usesChromeSync(api = getBrowserApi()) {
  const manifest = api.runtime.getManifest?.();
  return Boolean(manifest?.background?.service_worker && !manifest.browser_specific_settings?.gecko);
}

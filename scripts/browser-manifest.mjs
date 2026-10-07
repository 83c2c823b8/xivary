/** Derive browser metadata from the unpacked Chromium source manifest.
 * Application files and domain schema stay shared; Firefox omits Chrome's sync alarm permission.
 */
export function browserManifest(source, target) {
  if (!["chromium", "firefox"].includes(target)) throw new Error(`Unknown browser: ${target}`);
  if (source.manifest_version !== 3 || !source.background?.service_worker
      || source.background.type !== "module") throw new Error("Expected a module MV3 source manifest.");
  const manifest = structuredClone(source);
  if (target === "firefox") {
    manifest.permissions = manifest.permissions.filter(permission => permission !== "alarms");
    delete manifest.minimum_chrome_version;
    manifest.background = { scripts: [source.background.service_worker], type: "module" };
    manifest.browser_specific_settings = {
      gecko: {
        id: "xivary@arxiv-tool",
        strict_min_version: "140.0",
        // Author-feed and field-search queries are sent to arXiv, not telemetry.
        data_collection_permissions: { required: ["searchTerms"] },
      },
    };
  }
  return manifest;
}

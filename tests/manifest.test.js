import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../extension/", import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)]))).flat();
}

test("manifest uses MV3, narrow permissions and existing entry points", async () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.background.type, "module");
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://arxiv.org/abs/*"]);
  const paths = [manifest.background.service_worker, manifest.action.default_popup,
    ...manifest.content_scripts.flatMap(script => [...script.js, ...script.css]),
    ...manifest.web_accessible_resources.flatMap(group => group.resources)];
  for (const path of paths) await access(resolve(root, path));
});

test("local module imports and popup assets exist; content module graph is accessible", async () => {
  const exposed = new Set(manifest.web_accessible_resources.flatMap(group => group.resources));
  for (const path of await files(root)) {
    if (!path.endsWith(".js")) continue;
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const target = resolve(dirname(path), match[1]);
      await access(target);
      if (exposed.has(relative(root, path))) assert.ok(exposed.has(relative(root, target)), `${target} must be web accessible`);
    }
  }
  const popup = resolve(root, manifest.action.default_popup);
  const html = await readFile(popup, "utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) await access(resolve(dirname(popup), match[1]));
});

test("Chrome storage access is confined to the persistence adapter", async () => {
  for (const path of await files(resolve(root, "src"))) {
    if (!path.endsWith(".js") || path === resolve(root, "src/lib/storage.js")) continue;
    assert.doesNotMatch(await readFile(path, "utf8"), /(?:chrome|browser)\s*\.\s*storage\b/, path);
  }
});

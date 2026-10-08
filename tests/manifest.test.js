import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../extension/", import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const packageMetadata = JSON.parse(await readFile(resolve(root, "../package.json"), "utf8"));

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)]))).flat();
}

test("manifest uses MV3, narrow permissions and existing entry points", async () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Xivary");
  assert.equal(manifest.action.default_title, "Xivary");
  assert.equal(manifest.version, "0.2.0");
  assert.equal(packageMetadata.version, manifest.version);
  assert.deepEqual(manifest.permissions, ["storage", "alarms"]);
  assert.deepEqual(manifest.host_permissions, ["https://export.arxiv.org/*"]);
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.options_page, "src/settings/settings.html");
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://arxiv.org/abs/*", "https://arxiv.org/search/*"]);
  assert.deepEqual(manifest.web_accessible_resources.map(group => group.matches), [["https://arxiv.org/*"]]);
  const paths = [manifest.background.service_worker, manifest.action.default_popup,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap(script => [...script.js, ...script.css]),
    ...manifest.web_accessible_resources.flatMap(group => group.resources)];
  for (const path of paths) await access(resolve(root, path));
});

test("manifest icon set contains exact Chromium sizes", async () => {
  assert.deepEqual(Object.keys(manifest.icons), ["16", "32", "48", "128"]);
  assert.deepEqual(Object.keys(manifest.action.default_icon), ["16", "24", "32"]);
  const expected = new Map([
    [manifest.icons["16"], 16], [manifest.action.default_icon["24"], 24],
    [manifest.icons["32"], 32], [manifest.icons["48"], 48], [manifest.icons["128"], 128]
  ]);
  for (const [path, size] of expected) {
    const png = await readFile(resolve(root, path));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], path);
    assert.equal(png.readUInt32BE(16), size, path);
    assert.equal(png.readUInt32BE(20), size, path);
  }
});

test("visible extension identity is Xivary", async () => {
  const formerName = new RegExp(["arXiv", "Research", "Library"].join(" "));
  for (const path of await files(root)) {
    if (!/\.(?:html|js|json)$/.test(path)) continue;
    assert.doesNotMatch(await readFile(path, "utf8"), formerName, path);
  }
  const pages = [manifest.action.default_popup, "src/library/library.html", "src/authors/authors.html",
    "src/author/author.html", "src/search/search.html", manifest.options_page];
  for (const page of pages) assert.match(await readFile(resolve(root, page), "utf8"), /Xivary/, page);
});

test("full-tab extension pages and their local assets exist", async () => {
  for (const page of ["library/library.html", "authors/authors.html", "author/author.html", "search/search.html", "settings/settings.html"]) {
    const htmlPath = resolve(root, "src", page);
    const html = await readFile(htmlPath, "utf8");
    for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      if (!/^[a-z][a-z\d+.-]*:/i.test(match[1])) await access(resolve(dirname(htmlPath), match[1]));
    }
  }
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

test("native extension namespaces are confined to the platform boundary", async () => {
  for (const path of await files(resolve(root, "src"))) {
    if (!path.endsWith(".js") || relative(root, path).startsWith("src/platform/")) continue;
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /\b(?:chrome|browser)\s*\./, path);
    if (path !== resolve(root, "src/lib/storage.js")) {
      assert.doesNotMatch(source, /\.storage\s*\.\s*(?:local|sync|session)\b/, path);
    }
  }
});

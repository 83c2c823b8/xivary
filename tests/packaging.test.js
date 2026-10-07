import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserManifest } from "../scripts/browser-manifest.mjs";
import { packageExtension } from "../scripts/package-extension.mjs";

const source = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("browser manifests retain shared resources and limit the sync alarm permission to Chromium", () => {
  const before = structuredClone(source);
  const chromium = browserManifest(source, "chromium");
  assert.deepEqual(chromium, source);
  assert.notEqual(chromium, source);
  const firefox = browserManifest(source, "firefox");
  assert.equal(firefox.manifest_version, 3);
  assert.deepEqual(firefox.background, { scripts: [source.background.service_worker], type: "module" });
  assert.equal(firefox.minimum_chrome_version, undefined);
  assert.deepEqual(firefox.browser_specific_settings.gecko, {
    id: "xivary@arxiv-tool", strict_min_version: "140.0",
    data_collection_permissions: { required: ["searchTerms"] },
  });
  delete chromium.background;
  delete chromium.minimum_chrome_version;
  delete firefox.background;
  delete firefox.browser_specific_settings;
  assert.deepEqual(firefox.permissions, ["storage"]);
  assert.deepEqual(chromium.permissions, ["storage", "alarms"]);
  chromium.permissions = ["storage"];
  assert.deepEqual(firefox, chromium);
  assert.deepEqual(source, before);
  assert.throws(() => browserManifest(source, "unknown"), /Unknown browser/);
  assert.throws(() => browserManifest({ manifest_version: 2 }, "firefox"), /module MV3/);
});

test("both ZIP artifacts contain identical runtime sources and their generated manifests", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "xivary-packaging-"));
  try {
    let previousFiles;
    for (const target of ["chromium", "firefox"]) {
      const { artifact, directory, manifest, files } = await packageExtension(target, temporary);
      const extracted = join(temporary, `extracted-${target}`);
      execFileSync("unzip", ["-q", artifact, "-d", extracted], { stdio: "inherit" });
      const names = [];
      for (const path of await readdir(extracted, { recursive: true })) {
        if ((await stat(join(extracted, path))).isFile()) names.push(path.replaceAll("\\", "/"));
      }
      names.sort();
      assert.deepEqual(names, files);
      if (previousFiles) assert.deepEqual(files, previousFiles);
      previousFiles = files;
      assert.ok(files.includes("assets/fonts/LICENSE.txt"));
      assert.ok(!files.includes("assets/fonts/README.md"));
      for (const path of files) {
        const archived = await readFile(join(extracted, path));
        assert.deepEqual(archived, await readFile(join(directory, path)), `${target}: ${path}`);
        if (path === "manifest.json") assert.deepEqual(JSON.parse(archived), manifest);
        else assert.deepEqual(archived, await readFile(new URL(`../extension/${path}`, import.meta.url)), path);
      }
      const background = manifest.background.service_worker || manifest.background.scripts[0];
      assert.ok(files.includes(background));
      assert.ok(files.includes(manifest.options_page));
      assert.ok(files.includes(manifest.action.default_popup));
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ChromiumTestSession, waitFor } from "./chromium-test-session.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "xivary-release-"));
const profile = join(temporary, "profile"), downloadsPath = join(temporary, "downloads");
await mkdir(downloadsPath);
let chrome = new ChromiumTestSession(profile);
const preferenceNames = ["openArxivLinksInNewTab", "organizeFollowedAuthorsIntoCollections"];
const syncKey = name => `xivary.sync:${JSON.stringify(["s", name])}`;
const paper = { arxivId: "2401.00001", title: "Release transfer fixture", authors: ["Alex Kim"] };
const client = operation => `(async () => { const { RepositoryClient } = await import('../repository/repository-client.js'); const repository = new RepositoryClient(); return ${operation}; })()`;
const localState = "chrome.storage.local.get('arxivResearchLibrary').then(value => value.arxivResearchLibrary)";

async function settingsPage(extensionId) {
  const page = await chrome.page(`chrome-extension://${extensionId}/src/settings/settings.html`);
  await chrome.until(page.sessionId, "document.readyState === 'complete' && document.querySelector('#open-arxiv-new-tab') && !document.querySelector('#open-arxiv-new-tab').disabled");
  return page;
}

async function enableTestExtension(extensionId) {
  const extension = (await chrome.send("Extensions.getExtensions")).extensions.find(item => item.id === extensionId);
  if (extension?.enabled) return;
  const manager = await chrome.page("chrome://extensions/");
  await chrome.until(manager.sessionId, "!!chrome.management");
  assert.equal(await chrome.evaluate(manager.sessionId, `new Promise(resolve => chrome.management.setEnabled(${JSON.stringify(extensionId)}, true, () => resolve(chrome.runtime.lastError?.message ?? 'enabled')))`), "enabled");
}

try {
  const { id: extensionId } = await chrome.send("Extensions.loadUnpacked", { path: join(root, "extension") });
  console.log(`Chrome ${(await chrome.send('Browser.getVersion')).product}; disposable profile, no account`);
  let settings = await settingsPage(extensionId);
  const session = settings.sessionId;
  const paperCollection = await chrome.evaluate(session, client(`repository.createPaperCollection('Release bookmarks', ${JSON.stringify(paper)})`));
  const authorCollection = await chrome.evaluate(session, client("repository.createAuthorCollection('Release following', { displayName: 'Alex Kim' })"));
  await chrome.evaluate(session, client("repository.setOpenArxivLinksInNewTab(true)"));
  await chrome.evaluate(session, client("repository.setOrganizeFollowedAuthorsIntoCollections(true)"));
  await chrome.send("Page.reload", {}, session);
  await chrome.until(session, "document.readyState === 'complete' && document.querySelector('#open-arxiv-new-tab').checked && document.querySelector('#organize-author-collections').checked");
  assert.deepEqual(await chrome.evaluate(session, "[...document.querySelectorAll('[data-import]')].map(node => node.dataset.import)"), ["bookmarks", "following"]);
  assert.deepEqual(await chrome.evaluate(session, "[...document.querySelectorAll('[data-export]')].map(node => node.dataset.export)"), ["bookmarks", "following"]);

  const downloads = new Map(), choosers = [];
  chrome.listeners.push(message => {
    if (message.method === "Browser.downloadWillBegin") downloads.set(message.params.guid, { ...message.params, state: "inProgress" });
    if (message.method === "Browser.downloadProgress") Object.assign(downloads.get(message.params.guid) ?? {}, message.params);
    if (message.method === "Page.fileChooserOpened" && message.sessionId === session) choosers.push(message.params);
  });
  await chrome.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: downloadsPath, eventsEnabled: true });
  await chrome.send("Page.setInterceptFileChooserDialog", { enabled: true }, session);

  async function exportFile(category, selection) {
    const previous = new Set(downloads.keys());
    await chrome.click(session, `[data-export="${category}"]`);
    await chrome.until(session, "document.querySelector('#export-dialog').open");
    await chrome.evaluate(session, `document.querySelector('#export-selection').value = ${JSON.stringify(selection)}`);
    assert.equal(await chrome.evaluate(session, "document.querySelector('#export-selection').value"), selection);
    await chrome.click(session, "#confirm-export");
    const download = await waitFor(() => [...downloads.values()].find(item => !previous.has(item.guid) && item.state === "completed"), `${category} download`);
    const path = join(downloadsPath, download.guid);
    const data = JSON.parse(await readFile(path, "utf8"));
    assert.equal(data.category, category);
    assert.equal(data.version, 2);
    assert.equal(Object.hasOwn(data, "preferences"), false);
    assert.match(download.suggestedFilename, new RegExp(`^xivary-${category}-`));
    await chrome.until(session, "!document.querySelector('#export-dialog').open");
    return { data, path };
  }

  async function importFile(category, path, successful = true) {
    const previous = choosers.length;
    await chrome.click(session, `[data-import="${category}"]`);
    const chooser = await waitFor(() => choosers[previous], `${category} file chooser`);
    await chrome.send("DOM.setFileInputFiles", { files: [path], backendNodeId: chooser.backendNodeId }, session);
    await chrome.until(session, `!document.querySelector('[data-import="${category}"]').disabled && (${successful
      ? "document.querySelector('#status').textContent.includes('imported into')"
      : "document.querySelector('#status').classList.contains('error') && document.querySelector('#status').textContent.includes('not valid JSON')"})`);
  }

  for (const [category, collection, getLibrary, deleteCollection] of [
    ["bookmarks", paperCollection, "getPaperLibrary", "deletePaperCollection"],
    ["following", authorCollection, "getAuthorLibrary", "deleteAuthorCollection"],
  ]) {
    const all = await exportFile(category, "all");
    assert.deepEqual(all.data.selection, { kind: "all" });
    const selected = await exportFile(category, collection.id);
    assert.deepEqual(selected.data.selection, { kind: "collection", collectionId: collection.id });
    const membershipField = category === "bookmarks" ? "paperMemberships" : "authorMemberships";
    assert.equal(selected.data[membershipField].length, 1);
    assert.ok(selected.data[membershipField].every(item => item.collectionId === collection.id));
    const otherCategory = category === "bookmarks" ? "getAuthorLibrary" : "getPaperLibrary";
    const otherBefore = await chrome.evaluate(session, client(`repository.${otherCategory}()`));
    await chrome.evaluate(session, client(`repository.${deleteCollection}(${JSON.stringify(collection.id)})`));
    await importFile(category, selected.path);
    const restored = await chrome.evaluate(session, client(`repository.${getLibrary}()`));
    assert.ok(restored.collections.some(item => item.id === collection.id));
    assert.equal(restored.memberships.filter(item => item.collectionId === collection.id).length, 1);
    await importFile(category, selected.path);
    assert.deepEqual(await chrome.evaluate(session, client(`repository.${getLibrary}()`)), restored);
    const otherAfter = await chrome.evaluate(session, client(`repository.${otherCategory}()`));
    // Library responses include the shared settings object. Deleting the source
    // collection legitimately repairs its own local last-used pointer.
    const { settings: otherSettingsBefore, ...otherStateBefore } = otherBefore;
    const { settings: otherSettingsAfter, ...otherStateAfter } = otherAfter;
    assert.deepEqual(otherStateAfter, otherStateBefore);
    const otherPointer = category === "bookmarks" ? "lastUsedAuthorCollectionId" : "lastUsedPaperCollectionId";
    assert.equal(otherSettingsAfter[otherPointer], otherSettingsBefore[otherPointer]);
    assert.deepEqual(await chrome.evaluate(session, client("repository.getPreferences()")), { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true });
    console.log(`Release flow PASS: ${category} All/collection download, native file chooser import, restoration, repeat and non-interference`);
  }

  const downloadCount = downloads.size;
  await chrome.click(session, '[data-export="bookmarks"]');
  await chrome.until(session, "document.querySelector('#export-dialog').open");
  await chrome.click(session, "#cancel-export");
  await chrome.until(session, "!document.querySelector('#export-dialog').open && document.activeElement.dataset.export === 'bookmarks'");
  assert.equal(downloads.size, downloadCount);
  const beforeInvalid = await chrome.evaluate(session, client("repository.getPaperLibrary()"));
  const malformedPath = join(temporary, "malformed.json"); await writeFile(malformedPath, "{ invalid");
  await importFile("bookmarks", malformedPath, false);
  assert.deepEqual(await chrome.evaluate(session, client("repository.getPaperLibrary()")), beforeInvalid);
  console.log("Release flow PASS: export Cancel, malformed-file feedback, no Preferences transfer UI");

  // This is real Chrome storage/event integration, with a test-authored peer
  // record in ONE unsigned-in profile. It does not test account propagation.
  await chrome.evaluate(session, "(() => { window.releaseSyncEvents = 0; window.releaseAlarmEvents = 0; chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync') window.releaseSyncEvents++; }); chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'xivary-sync-pending') window.releaseAlarmEvents++; }); })()");
  const following = await chrome.page(`chrome-extension://${extensionId}/src/authors/authors.html`);
  await chrome.until(following.sessionId, "document.querySelector('#collection-sidebar')?.hidden === false && document.querySelectorAll('.author-row').length === 1");
  const beforeRemote = await chrome.evaluate(session, localState);
  const remote = Object.fromEntries(preferenceNames.map(name => [syncKey(name), { v: 1, rev: [beforeRemote._chromeSync.counter + 10, "release-peer"], value: false, deleted: null }]));
  await chrome.evaluate(session, `chrome.storage.sync.set(${JSON.stringify(remote)})`);
  await chrome.until(session, `${localState}.then(state => !state.settings.openArxivLinksInNewTab && !state.settings.organizeFollowedAuthorsIntoCollections)`);
  const reconciled = await chrome.evaluate(session, localState);
  assert.deepEqual(reconciled.favorites, beforeRemote.favorites);
  assert.deepEqual(reconciled.memberships, beforeRemote.memberships);
  assert.ok(await chrome.evaluate(session, "window.releaseSyncEvents > 0"));
  const otherPage = await chrome.page("about:blank");
  await chrome.send("Page.bringToFront", {}, otherPage.sessionId);
  await chrome.send("Page.bringToFront", {}, session);
  await chrome.until(session, "!document.querySelector('#open-arxiv-new-tab').checked && !document.querySelector('#organize-author-collections').checked");
  await chrome.send("Page.bringToFront", {}, following.sessionId);
  await chrome.until(following.sessionId, "document.querySelector('#collection-sidebar').hidden && document.querySelectorAll('.author-row').length === 1 && !document.querySelector('.manage-collections')");
  await chrome.send("Page.bringToFront", {}, session);
  console.log("Chrome Sync PASS: actual sync area, onChanged reconciliation and Settings focus refresh (single-profile test peer)");

  const versions = new Map();
  chrome.listeners.push(message => {
    if (message.method === "ServiceWorker.workerVersionUpdated") for (const version of message.params.versions) versions.set(version.versionId, version);
  });
  await chrome.send("ServiceWorker.enable", {}, session);
  const version = await waitFor(() => [...versions.values()].find(item => item.scriptURL === `chrome-extension://${extensionId}/src/background/service-worker.js` && item.runningStatus === "running"), "extension service worker version");
  // Two quick UI updates leave the second desired state pending in the 2.1s
  // write interval. Stop the worker and let the real one-shot alarm wake it.
  await chrome.click(session, "#open-arxiv-new-tab + .toggle");
  await chrome.until(session, "document.querySelector('#open-arxiv-new-tab').checked && !document.querySelector('#open-arxiv-new-tab').disabled");
  await chrome.click(session, "#organize-author-collections + .toggle");
  await chrome.until(session, "document.querySelector('#organize-author-collections').checked && !document.querySelector('#organize-author-collections').disabled");
  const pending = await chrome.evaluate(session, `Promise.all([${localState}, chrome.storage.sync.get(null), chrome.alarms.get('xivary-sync-pending')])`);
  const pendingKey = syncKey("organizeFollowedAuthorsIntoCollections");
  assert.notDeepEqual(pending[0]._chromeSync.records[pendingKey], pending[1][pendingKey]);
  assert.ok(pending[2]?.scheduledTime);
  const workerTarget = (await chrome.send("Target.getTargets")).targetInfos.find(target => target.type === "service_worker" && target.url.includes(extensionId));
  await chrome.send("ServiceWorker.stopWorker", { versionId: version.versionId }, session);
  await waitFor(async () => !(await chrome.send("Target.getTargets")).targetInfos.some(target => target.targetId === workerTarget.targetId), "worker stopped");
  console.log("Chrome Sync: worker stopped with durable pending preference; waiting for the real recovery alarm");
  await chrome.until(session, `chrome.storage.sync.get(${JSON.stringify(pendingKey)}).then(values => JSON.stringify(values[${JSON.stringify(pendingKey)}]) === ${JSON.stringify(JSON.stringify(pending[0]._chromeSync.records[pendingKey]))})`, 80000);
  assert.ok(await chrome.evaluate(session, "window.releaseAlarmEvents > 0"));
  const recreated = (await chrome.send("Target.getTargets")).targetInfos.find(target => target.type === "service_worker" && target.url.includes(extensionId));
  assert.ok(recreated && recreated.targetId !== workerTarget.targetId);
  assert.equal((await chrome.evaluate(session, localState))._chromeSync.id, pending[0]._chromeSync.id);
  console.log("Chrome Sync PASS: alarm delivery, worker recreation and publication without repository/UI activity");

  const beforeReload = await chrome.evaluate(session, localState);
  await chrome.send("Runtime.evaluate", { expression: "chrome.runtime.reload()" }, session);
  // Chrome disables a CDP-loaded unpacked extension on runtime.reload(). Reenable
  // it through Chrome's own extensions page, in this disposable profile only.
  await waitFor(async () => (await chrome.send("Extensions.getExtensions")).extensions.some(item => item.id === extensionId && !item.enabled), "unpacked reload disabled the test extension");
  await enableTestExtension(extensionId);
  settings = await settingsPage(extensionId);
  const reloaded = await chrome.evaluate(settings.sessionId, localState);
  assert.equal(reloaded._chromeSync.id, beforeReload._chromeSync.id);
  for (const field of ["favorites", "authors", "paperCollections", "collections", "paperMemberships", "memberships", "authorPaperCaches", "settings"]) assert.deepEqual(reloaded[field], beforeReload[field], `reload: ${field}`);
  assert.deepEqual(await chrome.evaluate(settings.sessionId, client("repository.getPreferences()")), { openArxivLinksInNewTab: true, organizeFollowedAuthorsIntoCollections: true });
  console.log("Chrome Sync PASS: extension reload preserves library, preferences and replica identity");

  // Create another pending preference before restarting the whole browser with
  // the same test profile. Never clear storage or fabricate replica bookkeeping.
  await chrome.evaluate(settings.sessionId, client("repository.setOpenArxivLinksInNewTab(false)"));
  await chrome.evaluate(settings.sessionId, client("repository.setOrganizeFollowedAuthorsIntoCollections(false)"));
  const beforeRestart = await chrome.evaluate(settings.sessionId, `Promise.all([${localState}, chrome.storage.sync.get(null)])`);
  assert.notDeepEqual(beforeRestart[0]._chromeSync.records[pendingKey], beforeRestart[1][pendingKey]);
  // Let the existing write interval elapse without invoking the repository; the
  // pending record must be recovered by the next browser's background startup.
  await new Promise(resolve => setTimeout(resolve, 2200));
  await chrome.close();
  chrome = new ChromiumTestSession(profile);
  assert.equal((await chrome.send("Extensions.loadUnpacked", { path: join(root, "extension") })).id, extensionId);
  await enableTestExtension(extensionId);
  settings = await settingsPage(extensionId);
  const restarted = await chrome.evaluate(settings.sessionId, localState);
  assert.equal(restarted._chromeSync.id, beforeRestart[0]._chromeSync.id);
  assert.equal(restarted._chromeSync.counter, beforeRestart[0]._chromeSync.counter);
  for (const field of ["favorites", "authors", "paperCollections", "collections", "paperMemberships", "memberships", "authorPaperCaches", "settings"]) assert.deepEqual(restarted[field], beforeRestart[0][field], `restart: ${field}`);
  assert.deepEqual(await chrome.evaluate(settings.sessionId, client("repository.getPreferences()")), { openArxivLinksInNewTab: false, organizeFollowedAuthorsIntoCollections: false });
  await chrome.until(settings.sessionId, `chrome.storage.sync.get(${JSON.stringify(pendingKey)}).then(values => JSON.stringify(values[${JSON.stringify(pendingKey)}]) === ${JSON.stringify(JSON.stringify(beforeRestart[0]._chromeSync.records[pendingKey]))})`);
  const followingRestarted = await chrome.page(`chrome-extension://${extensionId}/src/authors/authors.html`);
  await chrome.until(followingRestarted.sessionId, "document.querySelector('#collection-sidebar')?.hidden && document.querySelectorAll('.author-row').length === 1");
  await chrome.click(followingRestarted.sessionId, ".settings-link");
  await chrome.send("Page.bringToFront", {}, followingRestarted.sessionId);
  await chrome.evaluate(followingRestarted.sessionId, "document.fonts.ready.then(()=>true)");
  await chrome.until(followingRestarted.sessionId, "document.readyState === 'complete' && document.querySelector('#organize-author-collections') && !document.querySelector('#organize-author-collections').disabled");
  await chrome.click(followingRestarted.sessionId, "#organize-author-collections + .toggle");
  await chrome.until(followingRestarted.sessionId, "document.querySelector('#organize-author-collections').checked && !document.querySelector('#organize-author-collections').disabled");
  await chrome.click(followingRestarted.sessionId, ".app-nav a[href*=authors]");
  await chrome.until(followingRestarted.sessionId, "document.querySelector('#collection-sidebar')?.hidden === false && document.querySelectorAll('.author-row').length === 1");
  await chrome.click(followingRestarted.sessionId, `[data-collection-id=${JSON.stringify(authorCollection.id)}]`);
  assert.equal(await chrome.evaluate(followingRestarted.sessionId, "document.querySelectorAll('.author-row').length"), 1);
  console.log("Following PASS: remote preference focus refresh and restored collection browsing after full Chrome profile restart");
  console.log("RELEASE SMOKE PASS: native transfer flows and Chrome Sync events, alarm, worker, reload and browser-profile restart; no account propagation claimed");
} finally {
  await chrome.close();
  await rm(temporary, { recursive: true, force: true });
}

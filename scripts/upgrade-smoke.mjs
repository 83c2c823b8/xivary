import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChromiumTestSession, waitFor } from './chromium-test-session.mjs';

// Historical source builds, not published store binaries. Keep one installed
// identity and profile for each upgrade; never uninstall or clear its storage.
const root = fileURLToPath(new URL('../', import.meta.url));
const releaseVersion = JSON.parse(await readFile(join(root, 'extension/manifest.json'), 'utf8')).version;
const temporary = await mkdtemp(join(tmpdir(), 'xivary-upgrade-'));
const snapshots = ['124f5e7', '8bbf3fd', '72a0d3f']; // 0.2.0/0.3.0 preparation and pre-candidate Vim/LaTeX source
const fields = ['favorites', 'authors', 'paperCollections', 'collections', 'paperMemberships', 'memberships', 'authorPaperCaches'];
const client = operation => `(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();return ${operation};})()`;
const state = "chrome.storage.local.get('arxivResearchLibrary').then(values=>values.arxivResearchLibrary)";
const macros = String.raw`\Stab = \operatorname{Stab}`;

try {
  for (const snapshot of snapshots) {
    const directory = join(temporary, snapshot);
    await mkdir(directory);
    const archive = execFileSync('git', ['archive', snapshot, 'extension'], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', directory], { input: archive });
    const extension = join(directory, 'extension');
    const previousVersion = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8')).version;
    const profile = join(directory, 'profile');
    let chrome = new ChromiumTestSession(profile);
    const runtimeErrors = [];
    function observe() {
      chrome.listeners.push(message => {
        if (message.method === 'Runtime.exceptionThrown' ||
            message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') runtimeErrors.push(message.params);
      });
    }
    observe();
    try {
      const { id } = await chrome.send('Extensions.loadUnpacked', { path: extension });
      async function settings() {
        const page = await chrome.page(`chrome-extension://${id}/src/settings/settings.html`);
        await chrome.until(page.sessionId, "document.readyState==='complete' && document.querySelector('#open-arxiv-new-tab') && !document.querySelector('#open-arxiv-new-tab').disabled");
        await chrome.evaluate(page.sessionId, client('repository.getPreferences()'));
        const worker = await waitFor(async () => (await chrome.send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url.includes(id)), 'upgrade worker running');
        const { sessionId } = await chrome.send('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
        await chrome.send('Runtime.enable', {}, sessionId);
        return page.sessionId;
      }
      async function enable() {
        const manager = await chrome.page('chrome://extensions/');
        await chrome.until(manager.sessionId, '!!chrome.management');
        assert.equal(await chrome.evaluate(manager.sessionId, `new Promise(resolve=>chrome.management.setEnabled(${JSON.stringify(id)},true,()=>resolve(chrome.runtime.lastError?.message??'enabled')))`), 'enabled');
      }
      async function reload(session) {
        await chrome.send('Runtime.evaluate', { expression: 'setTimeout(()=>chrome.runtime.reload(),50)' }, session);
        await waitFor(async () => (await chrome.send('Extensions.getExtensions')).extensions.some(item => item.id === id && !item.enabled), 'source update reload');
        await enable();
        return settings();
      }
      let session = await settings();
      const paper = { arxivId: '2401.00001', title: 'Retain $x^2$ and all metadata', authors: ['Alex Kim'], abstract: 'Upgrade fixture', categories: ['math.AG'], publishedAt: '2024-01-01T00:00:00Z' };
      await chrome.evaluate(session, client(`repository.createPaperCollection('Upgrade papers',${JSON.stringify(paper)})`));
      await chrome.evaluate(session, client(`repository.createPaperCollection('Shared papers',${JSON.stringify(paper)})`));
      await chrome.evaluate(session, client("repository.createAuthorCollection('Upgrade authors',{displayName:'Alex Kim'})"));
      await chrome.evaluate(session, client("repository.createAuthorCollection('Shared authors',{displayName:'Alex Kim'})"));
      await chrome.evaluate(session, client('repository.setOpenArxivLinksInNewTab(true)'));
      await chrome.evaluate(session, client('repository.setOrganizeFollowedAuthorsIntoCollections(true)'));
      const previousPreferences = await chrome.evaluate(session, client('repository.getPreferences()'));
      if (Object.hasOwn(previousPreferences, 'vimMode')) {
        await chrome.evaluate(session, client('repository.setVimMode(true)'));
        await chrome.evaluate(session, client(`repository.setCustomLatexMacros(${JSON.stringify(macros)})`));
        await chrome.evaluate(session, client('repository.setRenderLatexInAbstracts(false)'));
      }
      const authorId = await chrome.evaluate(session, client('repository.listFollowing().then(authors=>authors[0].id)'));
      await chrome.evaluate(session, client(`repository.putAuthorPaperCache(${JSON.stringify({ authorId, papers: [paper], fetchedAt: '2026-10-12T00:00:00Z', queryUsed: 'au:"Alex Kim"' })})`));
      const before = await chrome.evaluate(session, state);
      assert.equal(before.schemaVersion, 5);
      assert.ok(before.favorites.length && before.authors.length && before.paperMemberships.length && before.memberships.length);
      const backups = await chrome.evaluate(session, client("Promise.all(['bookmarks','following'].map(category=>repository.exportCategory(category)))"));
      // Replace only the disposable source directory, retaining the same path/ID.
      await rm(extension, { recursive: true });
      await cp(join(root, 'extension'), extension, { recursive: true });
      // LoadUnpacked rereads the manifest at the existing path. runtime.reload()
      // alone can keep Chrome's cached unpacked manifest/version metadata.
      assert.equal((await chrome.send('Extensions.loadUnpacked', { path: extension })).id, id);
      await enable();
      session = await settings();
      assert.equal(await chrome.evaluate(session, 'chrome.runtime.getManifest().version'), releaseVersion);
      const after = await chrome.evaluate(session, state);
      assert.equal(after.schemaVersion, 8);
      for (const field of fields) assert.deepEqual(after[field], before[field], `${previousVersion} upgrade: ${field}`);
      for (const [key, value] of Object.entries(before.settings)) assert.deepEqual(after.settings[key], value, `retain setting ${key}`);
      assert.equal(after._chromeSync.id, before._chromeSync.id);
      const preferences = await chrome.evaluate(session, client('repository.getPreferences()'));
      assert.equal(preferences.vimMode, Object.hasOwn(previousPreferences, 'vimMode'));
      assert.equal(preferences.renderLatexInAbstracts, !Object.hasOwn(previousPreferences, 'vimMode'));
      assert.equal(preferences.customLatexMacros, Object.hasOwn(previousPreferences, 'vimMode') ? macros : '');
      const exports = await chrome.evaluate(session, client("Promise.all(['bookmarks','following'].map(category=>repository.exportCategory(category)))"));
      assert.deepEqual(exports.map(({ exportedAt, ...data }) => data), backups.map(({ exportedAt, ...data }) => data));
      await chrome.evaluate(session, client('repository.setVimMode(true)'));
      await chrome.evaluate(session, client(`repository.setCustomLatexMacros(${JSON.stringify(macros)})`));
      await chrome.evaluate(session, client('repository.setRenderLatexInAbstracts(false)'));
      session = await reload(session);
      const retained = await chrome.evaluate(session, state);
      for (const field of fields) assert.deepEqual(retained[field], before[field], `first new preference write: ${field}`);
      await chrome.close();
      chrome = new ChromiumTestSession(profile);
      observe();
      assert.equal((await chrome.send('Extensions.loadUnpacked', { path: extension })).id, id);
      await enable();
      session = await settings();
      const restarted = await chrome.evaluate(session, state);
      for (const field of [...fields, 'settings']) assert.deepEqual(restarted[field], retained[field], `profile restart: ${field}`);
      await chrome.until(session, `document.querySelector('#vim-mode').checked && !document.querySelector('#render-latex').checked && document.querySelector('#latex-macros').value===${JSON.stringify(macros)}`);
      const sync = await chrome.evaluate(session, 'chrome.storage.sync.get(null)');
      assert.equal(Object.keys(sync).some(key => /vimMode|customLatexMacros|renderLatexInAbstracts/.test(key)), false);
      assert.deepEqual(runtimeErrors, []);
      console.log(`UPGRADE PASS: source ${previousVersion} (${snapshot}) → ${releaseVersion}, same ID/profile, schema 5→8, papers/authors/collections/memberships/settings/exports retained; local Vim/macros reload/restart; page/worker errors absent`);
    } finally { await chrome.close(); }
  }
} finally { await rm(temporary, { recursive: true, force: true }); }

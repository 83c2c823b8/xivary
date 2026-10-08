import test from 'node:test';
import assert from 'node:assert/strict';
import { launchPage } from '../extension/src/popup/launcher.js';

function fixture(newTab, tabs = [{ id: 7 }]) {
  const calls = [], api = { runtime: { getURL: path => `extension://${path}` }, tabs: {
    create: async value => { calls.push(['create', value]); },
    update: async (id, value) => { calls.push(['update', id, value]); },
    query: async options => { assert.deepEqual(options, { active: true, currentWindow: true }); return tabs; },
  }};
  return { api, calls, repository: { getPreferences: async () => ({ openXivaryFromToolbarInNewTab: newTab }) } };
}

test('toolbar launch reads the preference each time and preserves Library/Following routes', async () => {
  const f = fixture(true);
  await launchPage(f.api, f.repository, 'library/library.html');
  f.repository.getPreferences = async () => ({ openXivaryFromToolbarInNewTab: false });
  await launchPage(f.api, f.repository, 'authors/authors.html');
  assert.deepEqual(f.calls, [['create', {url:'extension://src/library/library.html'}], ['update',7,{url:'extension://src/authors/authors.html'}]]);
});

test('missing, invalid and known restricted tabs fall back to exactly one new tab', async () => {
  for (const tabs of [[],[{id:-1}],[{id:7,url:'chrome://settings/'}],[{id:7,url:'about:preferences'}]]) {
    const f=fixture(false,tabs); await launchPage(f.api,f.repository,'library/library.html');
    assert.equal(f.calls.length,1); assert.equal(f.calls[0][0],'create');
  }
  const f=fixture(false); f.api.tabs.query=async()=>{throw new Error('No window');};
  await launchPage(f.api,f.repository,'library/library.html'); assert.equal(f.calls[0][0],'create');
});

test('navigation or preference failure does not issue a second write, and arbitrary routes are rejected', async () => {
  const f=fixture(false); f.api.tabs.update=async(id,value)=>{f.calls.push(['update',id,value]);throw new Error('Not navigable');};
  await assert.rejects(launchPage(f.api,f.repository,'library/library.html'),/Not navigable/);
  assert.equal(f.calls.length,1); assert.equal(f.calls[0][0],'update');
  f.repository.getPreferences=async()=>{throw new Error('Storage failed');};
  await assert.rejects(launchPage(f.api,f.repository,'library/library.html'),/Storage failed/);
  await assert.rejects(launchPage(f.api,f.repository,'settings/settings.html'),/Unsupported/);
  assert.equal(f.calls.length,1); assert.equal(f.calls[0][0],'update');
});

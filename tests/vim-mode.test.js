import test from 'node:test';
import assert from 'node:assert/strict';
import { hintTargets, hintLabels, HINT_ALPHABET, editable, unsafeKey, scrollDestination, bindVimMode, SEQUENCE_TIMEOUT } from '../extension/src/ui/vim-mode.js';
import { LocalRepository } from '../extension/src/repository/local-repository.js';
import { RepositoryClient, PREFERENCES_CHANGED_CHANNEL } from '../extension/src/repository/repository-client.js';
import { createRepositoryHandler } from '../extension/src/background/repository-handler.js';
import { projectState, PREFERENCES } from '../extension/src/repository/sync-model.js';

test('Vim preference defaults off, migrates without changing data, persists locally and rejects invalid values', async () => {
  let disk;
  const storage = { read: async () => structuredClone(disk), write: async value => { disk = structuredClone(value); } };
  const repo = new LocalRepository(storage);
  assert.equal((await repo.getPreferences()).vimMode, false);
  await repo.savePaper({ arxivId: '2401.00001', title: 'Keep this paper', authors: ['Alex Kim'] });
  await repo.followAuthor({ displayName: 'Alex Kim' });
  delete disk.settings.vimMode;
  const before = structuredClone(disk);
  assert.equal((await new LocalRepository(storage).getPreferences()).vimMode, false);
  assert.deepEqual(disk, before, 'reading defaults never rewrites the old envelope');
  await assert.rejects(repo.setVimMode('true'), /true or false/);
  assert.deepEqual(disk, before);
  await repo.setVimMode(true);
  assert.equal((await new LocalRepository(storage).getPreferences()).vimMode, true);
  assert.deepEqual({ ...disk, settings: before.settings }, before, 'only the setting changes');
  assert.equal(PREFERENCES.includes('vimMode'), false);
  assert.equal(JSON.stringify(projectState(disk)).includes('vimMode'), false);
  assert.equal(JSON.stringify(await repo.exportCategory('bookmarks')).includes('vimMode'), false);
  assert.equal(JSON.stringify(await repo.exportCategory('following')).includes('vimMode'), false);
  storage.write = async () => { throw new Error('Disk failure'); };
  await assert.rejects(repo.setVimMode(false), /Disk failure/);
  assert.equal((await repo.getPreferences()).vimMode, true);
});

test('successful local commits notify clients; failures never notify and unavailable receivers do not fail saves', async () => {
  let value = false, notices = 0;
  const repo = { setVimMode: async enabled => { if (enabled === 'fail') throw new Error('Disk failure'); value = enabled; return { vimMode: value }; } };
  const handler = createRepositoryHandler(repo, 'test', () => { notices++; throw new Error('No receivers'); });
  const listeners = new Set();
  const runtime = { id: 'test', onMessage: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
    sendMessage: message => new Promise(resolve => handler(message, { id: 'test' }, resolve)) };
  const client = new RepositoryClient(runtime);
  assert.deepEqual(await client.setVimMode(true), { vimMode: true });
  assert.equal(notices, 1);
  await assert.rejects(client.setVimMode('fail'), /Disk failure/);
  assert.equal(notices, 1);
  let received = 0;
  const unsubscribe = client.subscribePreferences(() => received++);
  const listener = [...listeners][0];
  listener({ channel: PREFERENCES_CHANGED_CHANNEL }, { id: 'other' });
  listener({ channel: 'other' }, { id: 'test' });
  assert.equal(received, 0);
  listener({ channel: PREFERENCES_CHANGED_CHANNEL }, { id: 'test' });
  assert.equal(received, 1);
  unsubscribe(); assert.equal(listeners.size, 0);
});

test('hint sequences remain deterministic, unique and prefix-free at alphabet boundaries and thousands of targets', () => {
  assert.deepEqual(hintLabels(0), []);
  assert.deepEqual(hintLabels(3), ['a', 's', 'd']);
  for (const count of [8, 9, 64, 65, 512, 513, 3000]) {
    const labels = hintLabels(count);
    assert.equal(labels.length, count); assert.equal(new Set(labels).size, count);
    assert.equal(new Set(labels.map(label => label.length)).size, 1);
    assert.ok(labels.every(label => [...label].every(char => HINT_ALPHABET.includes(char))));
    assert.deepEqual(labels, hintLabels(count));
  }
});

test('scroll commands use fixed steps, half the visible height and clamp to both boundaries', () => {
  const move = (key, top = 200) => scrollDestination(key, top, 600, 3000);
  assert.equal(move('j'), 280); assert.equal(move('k'), 120);
  assert.equal(move('d'), 500); assert.equal(move('u'), 0);
  assert.equal(move('gg'), 0); assert.equal(move('G'), 2400);
  assert.equal(move('k', 0), 0); assert.equal(move('j', 2400), 2400);
  assert.equal(scrollDestination('G', 0, 600, 100), 0);
});

test('wrapped links use visible fragments rather than an empty bounding-box center', () => {
  const node = { isConnected: true, closest: () => null, matches: () => false, contains: () => false,
    getClientRects: () => [{ left: 0, right: 100, top: 0, bottom: 20 }, { left: 0, right: 20, top: 24, bottom: 44 }] };
  const doc = { querySelectorAll: () => [node], documentElement: { clientWidth: 100 }, elementFromPoint: (_, y) => y > 24 ? node : null };
  const view = { innerHeight: 100, getComputedStyle: () => ({ display: 'inline', visibility: 'visible', opacity: '1' }) };
  assert.deepEqual(hintTargets(doc, view), [node]);
  doc.elementFromPoint = () => null;
  assert.deepEqual(hintTargets(doc, view), [], 'fully covered link is excluded');
});

test('input guards cover modified keys, IME, prior handlers and editable ancestors', () => {
  for (const property of ['ctrlKey', 'altKey', 'metaKey', 'isComposing', 'defaultPrevented']) assert.equal(unsafeKey({ [property]: true }), true);
  assert.equal(unsafeKey({ keyCode: 229 }), true);
  assert.equal(unsafeKey({ key: 'G', shiftKey: true }), false);
  assert.equal(editable({ closest: selector => selector.includes('[role="textbox"]') }), true);
  assert.equal(editable({}), false);
});

// Tiny event surfaces test the controller lifecycle without imitating a DOM renderer.
function surface() {
  const listeners = new Map();
  return {
    addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    dispatch: (type, event = {}) => { for (const fn of listeners.get(type) || []) fn(event); },
    count: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  };
}
test('controller defaults off, responds live, bounds gg, suspends composition and cleans up on page exit', async () => {
  const doc = Object.assign(surface(), { querySelectorAll: () => [], scrollingElement: { scrollTop: 200, scrollHeight: 3000 } });
  let timer, timerDelay, reads = 0, changed, preference = false;
  const view = Object.assign(surface(), { innerHeight: 600, setTimeout: (fn, delay) => { timer = fn; timerDelay = delay; return 1; }, clearTimeout: () => { timer = null; }, scrollTo: options => { doc.scrollingElement.scrollTop = options.top; assert.equal(options.behavior, 'instant'); } });
  const repo = { getPreferences: async () => { reads++; return { vimMode: preference }; }, subscribePreferences: fn => { changed = fn; return () => { changed = null; }; } };
  const dispose = bindVimMode(repo, doc, view);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const press = (key, extra = {}) => {
    const event = { key, target: {}, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    doc.dispatch('keydown', event); return event.defaultPrevented;
  };
  await flush(); assert.equal(press('j'), false); assert.equal(doc.scrollingElement.scrollTop, 200);
  preference = true; changed(); await flush();
  assert.equal(press('j'), true); assert.equal(doc.scrollingElement.scrollTop, 280);
  press('g'); assert.equal(timerDelay, SEQUENCE_TIMEOUT); assert.equal(doc.scrollingElement.scrollTop, 280);
  timer(); press('g'); assert.equal(doc.scrollingElement.scrollTop, 280);
  press('g'); assert.equal(doc.scrollingElement.scrollTop, 0);
  press('G'); assert.equal(doc.scrollingElement.scrollTop, 2400);
  doc.dispatch('compositionstart'); assert.equal(press('k'), false);
  doc.dispatch('compositionend'); assert.equal(press('k', { isComposing: true }), false);
  assert.equal(press('k', { keyCode: 229 }), false);
  assert.equal(press('k', { ctrlKey: true }), false);
  assert.equal(press('k', { target: { closest: () => ({}) } }), false);
  assert.equal(press('k'), true); assert.equal(doc.scrollingElement.scrollTop, 2320);
  assert.equal(press('h'), false); assert.equal(press('l'), false, 'pages with no internal tabs stay native');
  assert.equal(reads, 2, 'scrolling does not read storage');
  press('g'); preference = false; changed(); await flush();
  assert.equal(timer, null); assert.equal(press('g'), false);
  doc.dispatch('keydown', { key: 'Escape', target: {}, preventDefault: () => assert.fail('inactive Escape') });
  dispose(); dispose(); assert.equal(changed, null); assert.equal(doc.count() + view.count(), 0);
});

test('out-of-order preference reads cannot re-enable a disabled or disposed controller', async () => {
  const pending = []; let changed;
  const doc = Object.assign(surface(), { querySelectorAll: () => [] });
  const view = Object.assign(surface(), { clearTimeout() {} });
  const repo = { getPreferences: () => new Promise(resolve => pending.push(resolve)), subscribePreferences: fn => { changed = fn; return () => {}; } };
  const dispose = bindVimMode(repo, doc, view);
  changed(); pending[1]({ vimMode: false }); pending[0]({ vimMode: true });
  await new Promise(resolve => setImmediate(resolve));
  const event = { key: 'j', target: {}, preventDefault: () => assert.fail('stale enable') };
  doc.dispatch('keydown', event);
  changed(); dispose(); pending[2]({ vimMode: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(doc.count() + view.count(), 0);
});

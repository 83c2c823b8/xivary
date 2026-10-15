import test from 'node:test';
import assert from 'node:assert/strict';
import { hintTargets, hintAnchor, hintPosition, hintLabels, HINT_ALPHABET, editable, unsafeKey, scrollDestination, bindVimMode, SEQUENCE_TIMEOUT, createScrollAnimator, SCROLL_DURATION, EDGE_SCROLL_MAX_DURATION, edgeScrollDuration, escapeAlias, inputTarget } from '../extension/src/ui/vim-mode.js';
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
  disk.schemaVersion = 5;
  delete disk.settings.vimMode;
  const before = structuredClone(disk);
  assert.equal((await new LocalRepository(storage).getPreferences()).vimMode, false);
  for(const key of ['favorites','authors','collections','paperCollections','memberships','paperMemberships'])assert.deepEqual(disk[key],before[key]);
  assert.equal(disk.schemaVersion,6);
  const migrated=structuredClone(disk);
  await assert.rejects(repo.setVimMode('true'), /true or false/);
  assert.deepEqual(disk, migrated);
  await repo.setVimMode(true);
  assert.equal((await new LocalRepository(storage).getPreferences()).vimMode, true);
  assert.deepEqual({ ...disk, settings: migrated.settings }, migrated, 'only the setting changes');
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

test('styled switches use explicit visible geometry with one semantic target and preserve availability guards', () => {
  const proxy = { isConnected: true, hasAttribute: name => name === 'data-vim-control',
    matches: () => false, parentElement: { closest: () => null }, contains: () => false,
    getClientRects: () => [{left:300,right:338,top:100,bottom:122}] };
  let disabled = false, hidden = false, hit = proxy;
  const control = { isConnected: true, nextElementSibling: proxy, contains: () => false,
    closest: () => hidden ? {} : null,
    matches: selector => selector.includes('type="checkbox"') || selector === ':disabled' && disabled };
  const doc = { querySelectorAll: selector => { assert.ok(!selector.includes('label.setting-row')); return [control]; },
    documentElement: {clientWidth:360}, elementFromPoint: () => hit };
  const view = {innerHeight:650,getComputedStyle: () => ({display:'inline',visibility:'visible',opacity:'1'})};
  assert.equal(hintAnchor(control),proxy);
  assert.deepEqual(hintTargets(doc,view),[control]);
  disabled=true;assert.deepEqual(hintTargets(doc,view),[]);disabled=false;
  hidden=true;assert.deepEqual(hintTargets(doc,view),[]);hidden=false;
  hit={};assert.deepEqual(hintTargets(doc,view),[]);
  control.nextElementSibling={hasAttribute:()=>false};assert.equal(hintAnchor(control),control,'unassociated siblings never supply geometry');
});

test('switch hints sit beside the actual switch and measured labels stay within narrow viewports', () => {
  const rect={left:300,top:100,height:22};
  assert.deepEqual(hintPosition(rect,24,22,360,650,true),{left:272,top:100});
  assert.deepEqual(hintPosition({left:-5,top:-10,height:22},24,22,360,650,true),{left:2,top:2});
  assert.deepEqual(hintPosition({left:355,top:645,height:22},24,22,360,650),{left:334,top:626});
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
  const view = Object.assign(surface(), { history: {back(){},forward(){}}, innerHeight: 600, performance: { now: () => 0 }, matchMedia: () => ({ matches: true }), setTimeout: (fn, delay) => { timer = fn; timerDelay = delay; return 1; }, clearTimeout: () => { timer = null; }, scrollTo: options => { doc.scrollingElement.scrollTop = options.top; assert.equal(options.behavior, 'instant'); } });
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
  assert.equal(press('h'), true); assert.equal(press('l'), true, 'history works independently of internal tabs');
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

function animationSurface() {
  let now = 0, next = 0, writes = 0;
  const frames = new Map(), reduced = { matches: false };
  const doc = Object.assign(surface(), { querySelectorAll: () => [], scrollingElement: { scrollTop: 200, scrollHeight: 3000 } });
  const view = Object.assign(surface(), {
    history: {back(){},forward(){}}, innerHeight: 600, performance: { now: () => now }, matchMedia: () => reduced,
    requestAnimationFrame: fn => { frames.set(++next, fn); return next; }, cancelAnimationFrame: id => frames.delete(id),
    scrollTo: ({ top }) => { writes++; doc.scrollingElement.scrollTop = top; },
    setTimeout, clearTimeout,
  });
  const step = time => { now = time; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now)); };
  return { doc, view, frames, reduced, step, writes: () => writes };
}

test('gg/G animate short and very long pages within a bounded distance-aware duration', () => {
  assert.ok(edgeScrollDuration(100) < edgeScrollDuration(1000));
  assert.equal(edgeScrollDuration(1e9), EDGE_SCROLL_MAX_DURATION);
  for (const total of [900, 3000, 500000]) for (const key of ['gg', 'G']) {
    const { doc, view, frames, step } = animationSurface();
    const root = doc.scrollingElement;
    root.scrollHeight = total;
    root.scrollTop = key === 'gg' ? total - view.innerHeight : 0;
    // Exercise the element API rather than relying on window.scrollTo.
    root.scrollTo = ({ top, behavior }) => { assert.equal(behavior, 'instant'); root.scrollTop = top; };
    view.scrollTo = () => assert.fail('must write to the actual scroll root');
    const initial = root.scrollTop, target = key === 'gg' ? 0 : total - view.innerHeight;
    const animation = createScrollAnimator(doc, view);
    animation.move(key); assert.equal(root.scrollTop, initial); assert.equal(frames.size, 1);
    step(16); assert.ok(root.scrollTop > Math.min(initial, target) && root.scrollTop < Math.max(initial, target));
    animation.move(key); assert.equal(frames.size, 1, 'repeated edges do not restart or queue');
    step(EDGE_SCROLL_MAX_DURATION); assert.equal(root.scrollTop, target); assert.equal(frames.size, 0);
  }
});

test('edge reversal and j/k retarget from the live position without carrying an edge backlog', () => {
  const { doc, view, frames, step } = animationSurface();
  const animation = createScrollAnimator(doc, view), root = doc.scrollingElement;
  animation.move('G'); step(16); const down = root.scrollTop;
  animation.move('gg'); step(32); assert.ok(root.scrollTop < down);
  animation.move('G'); step(48); const live = root.scrollTop;
  animation.move('j'); step(48 + SCROLL_DURATION);
  assert.equal(root.scrollTop, live + 80); assert.equal(frames.size, 0);
});

test('edge scrolling is immediate for reduced motion and no-op on non-scrollable pages', () => {
  const { doc, view, frames, reduced } = animationSurface();
  const animation = createScrollAnimator(doc, view);
  reduced.matches = true;
  animation.move('G'); assert.equal(doc.scrollingElement.scrollTop, 2400);
  animation.move('gg'); assert.equal(doc.scrollingElement.scrollTop, 0); assert.equal(frames.size, 0);
  reduced.matches = false; doc.scrollingElement.scrollHeight = 100;
  animation.move('G'); assert.equal(doc.scrollingElement.scrollTop, 0); assert.equal(frames.size, 0);
});

test('native keys, wheel, navigation and disabled Vim interrupt edge scrolling without claiming native keys', async () => {
  const { doc, view, frames, step } = animationSurface();
  let enabled = true, changed;
  const dispose = bindVimMode({ getPreferences: async () => ({ vimMode: enabled }), subscribePreferences: fn => { changed = fn; return () => {}; } }, doc, view);
  await new Promise(resolve => setImmediate(resolve));
  const press = (key, extra = {}) => {
    const event = { key, target: {}, preventDefault() { this.defaultPrevented = true; }, ...extra };
    doc.dispatch('keydown', event); return event;
  };
  let now = 0;
  for (const stop of [
    () => assert.equal(press('ArrowDown').defaultPrevented, undefined),
    () => assert.equal(press('Tab').defaultPrevented, undefined),
    () => assert.equal(press('l', { ctrlKey: true }).defaultPrevented, undefined),
    () => press('Escape'), () => doc.dispatch('wheel'), () => view.dispatch('popstate'),
    () => view.dispatch('hashchange'),
  ]) {
    press('G'); step(now += 16); const at = doc.scrollingElement.scrollTop;
    assert.equal(frames.size, 1); stop(); assert.equal(frames.size, 0);
    step(now += 300); assert.equal(doc.scrollingElement.scrollTop, at);
    doc.scrollingElement.scrollTop = 200;
  }
  press('G'); enabled = false; changed(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(frames.size, 0); assert.equal(press('G').defaultPrevented, undefined);
  enabled = true; changed(); await new Promise(resolve => setImmediate(resolve));
  press('G'); view.dispatch('pagehide', {});
  assert.equal(frames.size, 0); dispose(); assert.equal(doc.count() + view.count(), 0);
});

test('j/k uses one responsive frame chain, accumulates repeats and reverses immediately', () => {
  const { doc, view, frames, step } = animationSurface();
  const animation = createScrollAnimator(doc, view);
  animation.move('j'); assert.equal(frames.size, 1);
  step(16); assert.ok(doc.scrollingElement.scrollTop > 200 && doc.scrollingElement.scrollTop < 280);
  animation.move('j'); animation.move('j'); assert.equal(frames.size, 1);
  step(16 + SCROLL_DURATION); assert.equal(doc.scrollingElement.scrollTop, 440); assert.equal(frames.size, 0);
  animation.move('j'); step(120); const midway = doc.scrollingElement.scrollTop;
  animation.move('k'); step(136); assert.ok(doc.scrollingElement.scrollTop < midway, 'direction reverses on the next frame');
  step(120 + SCROLL_DURATION); assert.equal(doc.scrollingElement.scrollTop, midway - 80);
});

test('scroll animation respects boundaries/reduced motion and cancels changed or native contexts', () => {
  for (const change of [
    ({ doc }) => { doc.scrollingElement.scrollTop += 20; },
    ({ doc }) => { doc.scrollingElement.scrollHeight += 20; },
    ({ view }) => { view.innerHeight += 20; },
    ({ doc }) => { doc.scrollingElement = { scrollTop: 0, scrollHeight: 5000 }; },
  ]) {
    const context = animationSurface(), animation = createScrollAnimator(context.doc, context.view);
    animation.move('j'); const initialWrites=context.writes(); change(context); context.step(16);
    assert.equal(context.writes(), initialWrites); assert.equal(context.frames.size, 0);
  }
  const { doc, view, reduced, frames, step, writes } = animationSurface();
  const animation = createScrollAnimator(doc, view);
  reduced.matches = true; animation.move('j'); assert.equal(doc.scrollingElement.scrollTop, 280); assert.equal(frames.size, 0);
  doc.scrollingElement.scrollTop = 0; const before = writes(); animation.move('k'); assert.equal(writes(), before);
  reduced.matches = false; animation.move('j'); animation.cancel(); step(200); assert.equal(doc.scrollingElement.scrollTop, 0);
  animation.move('j'); reduced.matches = true; step(216); assert.equal(doc.scrollingElement.scrollTop, 80); assert.equal(frames.size, 0);
});

test('live disabling, editing, pointer/wheel, resize, blur and composition cancel pending scrolling', async () => {
  const { doc, view, frames } = animationSurface();
  let changed, enabled = true;
  const dispose = bindVimMode({ getPreferences: async () => ({ vimMode: enabled }), subscribePreferences: fn => { changed = fn; return () => {}; } }, doc, view);
  await new Promise(resolve => setImmediate(resolve));
  const press = () => doc.dispatch('keydown', { key: 'j', target: {}, preventDefault() {} });
  for (const [surface, type, event] of [[doc,'wheel'],[doc,'touchstart'],[doc,'pointerdown'],[view,'resize'],[view,'blur'],[doc,'focusin',{target:{}}],[doc,'compositionstart']]) {
    press(); assert.equal(frames.size, 1); surface.dispatch(type, event); assert.equal(frames.size, 0);
    doc.dispatch('compositionend');
  }
  press(); enabled = false; changed(); await new Promise(resolve => setImmediate(resolve)); assert.equal(frames.size, 0);
  dispose(); assert.equal(doc.count() + view.count(), 0);
});

test('editable Escape yields to component cancellation/IME and preserves values; J/K stay guarded', async () => {
  const { doc, view } = animationSurface();
  let enabled = true, transient = false, calls = [], blurred = 0;
  const field = { value: 'Keep typed text', type: 'search', closest() { return this; }, matches: selector => selector === 'input', contains: () => false, blur: () => { blurred++; doc.activeElement = null; } };
  doc.activeElement = field;
  doc.querySelectorAll = () => transient ? [{ isConnected: true, closest: () => null, matches: () => false, getClientRects: () => [{}] }] : [];
  view.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
  const dispose = bindVimMode({ getPreferences: async () => ({ vimMode: enabled }), subscribePreferences: () => () => {} }, doc, view, direction => calls.push(direction));
  await new Promise(resolve => setImmediate(resolve));
  const event = extra => ({ key: 'Escape', target: field, preventDefault() { this.defaultPrevented = true; }, ...extra });
  for (const extra of [{defaultPrevented:true},{isComposing:true},{keyCode:229},{ctrlKey:true}]) view.dispatch('keydown', event(extra));
  doc.dispatch('compositionstart'); view.dispatch('keydown', event()); doc.dispatch('compositionend');
  transient = true; view.dispatch('keydown', event()); transient = false;
  assert.equal(blurred, 0);
  for (const key of ['J','K']) doc.dispatch('keydown', event({key})); assert.deepEqual(calls, []);
  const escape = event(); view.dispatch('keydown', escape); assert.equal(blurred, 1); assert.equal(escape.defaultPrevented, true); assert.equal(field.value, 'Keep typed text');
  for (const key of ['J','K']) {
    doc.dispatch('keydown', event({key,target:{}})); await new Promise(resolve => setImmediate(resolve));
  }
  assert.deepEqual(calls, [-1,1]);
  for (const extra of [{isComposing:true},{keyCode:229},{ctrlKey:true}]) doc.dispatch('keydown', event({key:'J',target:{},...extra}));
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(calls, [-1,1]);
  enabled = false; dispose();
});

test('h/l invoke real history methods only in enabled Normal Mode', async () => {
  const { doc, view } = animationSurface();
  let enabled = false, changed, back = 0, forward = 0;
  view.history = { back: () => back++, forward: () => forward++ };
  const dispose = bindVimMode({getPreferences:async()=>({vimMode:enabled}),subscribePreferences:fn=>{changed=fn;return()=>{};}},doc,view);
  await new Promise(resolve=>setImmediate(resolve));
  const press = (key, extra={}) => {
    const event={key,target:{},preventDefault(){this.defaultPrevented=true;},...extra};doc.dispatch('keydown',event);return event;
  };
  assert.equal(press('h').defaultPrevented,undefined); assert.equal(press('l').defaultPrevented,undefined);
  enabled=true; changed(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(press('h').defaultPrevented,true);assert.equal(press('l').defaultPrevented,true);
  for(const key of ['h','l']) for(const extra of [{target:{closest:()=>({})}},{isComposing:true},{keyCode:229},{ctrlKey:true},{defaultPrevented:true}]) press(key,extra);
  doc.dispatch('compositionstart'); press('h'); press('l');doc.dispatch('compositionend');
  assert.deepEqual([back,forward],[1,1]);dispose();
});

test('Ctrl+[ semantic Escape recognizes logical brackets and physical layout fallback, with strict IME/modifier guards', () => {
  assert.equal(escapeAlias({key:'[',ctrlKey:true}),true);
  assert.equal(escapeAlias({key:'@',code:'BracketLeft',ctrlKey:true}),true);
  for(const extra of [{shiftKey:true},{altKey:true},{metaKey:true},{isComposing:true},{keyCode:229}]) assert.equal(escapeAlias({key:'[',ctrlKey:true,...extra}),false);
  assert.equal(escapeAlias({key:'['}),false);assert.equal(escapeAlias({key:'Escape'}),false);
});

test('gi chooses stable primary editors, rejects hidden/disabled/readonly/nontext fields, and falls back in document order', () => {
  const field = (type='text', extra={}) => ({isConnected:true,type,readOnly:false,
    closest:()=>null,matches:selector=>selector==='input' || selector===':disabled'&&Boolean(extra.disabled),getClientRects:()=>[{}],...extra});
  const first=field(), search=field('search'), macros=field('textarea',{matches:()=>false});
  let preferred={'#filter':search,'#latex-macros':macros};let fields=[first,search,macros];
  const doc={querySelector:selector=>preferred[selector],querySelectorAll:()=>fields};
  const view={getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})};
  assert.equal(inputTarget(doc,view),search);
  search.readOnly=true;assert.equal(inputTarget(doc,view),macros);
  preferred={'#paper-query':first,'#latex-macros':macros};assert.equal(inputTarget(doc,view),first,'visible author search takes priority over fallback editors');
  preferred={};assert.equal(inputTarget(doc,view),first);
  fields=[field('checkbox'),field('file'),field('text',{disabled:true}),field('text',{isConnected:false}),field('text',{readOnly:true}),field('text',{closest:()=>({})})];
  assert.equal(inputTarget(doc,view),undefined);
  fields=[field('text',{getClientRects:()=>[]}),first];assert.equal(inputTarget(doc,view),first);
});

test('gi uses the bounded g sequence, preserves value/caret, emits no edits, and leaves Tab native', async () => {
  const {doc,view}=animationSurface();let timer,focuses=0,selection,changed,enabled=true;
  const field={isConnected:true,type:'search',value:'日本 geometry',readOnly:false,closest:()=>null,
    matches:s=>s==='input'||s==='input,textarea',getClientRects:()=>[{}],contains:()=>false,
    focus:options=>{assert.deepEqual(options,{preventScroll:true});focuses++;doc.activeElement=field;},setSelectionRange:(...args)=>selection=args};
  doc.querySelector=()=>field;view.getComputedStyle=()=>({display:'block',visibility:'visible',opacity:'1'});
  view.setTimeout=fn=>{timer=fn;return 1;};view.clearTimeout=()=>{timer=null;};
  const dispose=bindVimMode({getPreferences:async()=>({vimMode:enabled}),subscribePreferences:fn=>{changed=fn;return()=>{};}},doc,view);
  await new Promise(resolve=>setImmediate(resolve));
  const press=(key,extra={})=>{const e={key,target:{},preventDefault(){this.defaultPrevented=true;},...extra};doc.dispatch('keydown',e);return e;};
  assert.equal(press('i').defaultPrevented,undefined);
  press('g');press('i');assert.equal(focuses,1);assert.deepEqual(selection,[field.value.length,field.value.length]);assert.equal(field.value,'日本 geometry');
  selection=[2,2];press('g');press('i');assert.equal(focuses,1);assert.deepEqual(selection,[2,2],'already-focused field retains caret');
  doc.activeElement=null;press('g');press('Escape');press('i');assert.equal(focuses,1);
  press('g');timer();press('i');assert.equal(focuses,1);
  press('g');press('x');press('i');assert.equal(focuses,1);
  for(const extra of [{isComposing:true},{keyCode:229},{ctrlKey:true},{altKey:true},{metaKey:true},{target:{closest:()=>field}}]) {press('g',extra);press('i',extra);}
  assert.equal(focuses,1);assert.equal(press('Tab').defaultPrevented,undefined);assert.equal(press('Tab',{shiftKey:true}).defaultPrevented,undefined);
  press('g');view.dispatch('scroll');press('i');assert.equal(focuses,2,'ordinary scroll events do not destroy a bounded g sequence');
  enabled=false;changed();await new Promise(resolve=>setImmediate(resolve));press('g');press('i');assert.equal(focuses,2);
  dispose();
});

test('IME Escape capture protects component cancellation without preventing native composition defaults', async () => {
  const {doc,view}=animationSurface();let enabled=true,changed,stops=0;
  const dispose=bindVimMode({getPreferences:async()=>({vimMode:enabled}),subscribePreferences:fn=>{changed=fn;return()=>{};}},doc,view);
  await new Promise(resolve=>setImmediate(resolve));
  const press=extra=>{const event={key:'Escape',target:{},stopPropagation(){stops++;},preventDefault(){assert.fail('native IME default must remain available');},...extra};doc.dispatch('keydown',event);};
  doc.dispatch('compositionstart');press({});doc.dispatch('compositionend');
  press({isComposing:true});press({keyCode:229});assert.equal(stops,3);
  press({isComposing:true,ctrlKey:true});assert.equal(stops,3,'modified shortcuts remain unclaimed');
  enabled=false;changed();await new Promise(resolve=>setImmediate(resolve));press({isComposing:true});assert.equal(stops,3);
  dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { requestArxiv } from '../extension/src/services/arxiv-client.js';
import { bindArxivRequests } from '../extension/src/background/arxiv-requests.js';
import { ARXIV_CHANNEL } from '../extension/src/services/arxiv-scheduler.js';

function event() {
  const listeners = new Set();
  return { listeners, addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: value => { for (const fn of [...listeners]) fn(value); } };
}
function fixture() {
  let disconnects = 0;
  const port = { onMessage: event(), onDisconnect: event(), postMessage: message => { port.sent = message; }, disconnect: () => { disconnects++; } };
  return { port, runtime: { connect: () => port }, disconnects: () => disconnects };
}
test('arXiv client forwards progress, completes text once and releases native port listeners', async () => {
  const f = fixture(), events = [];
  const result = requestArxiv('A', { onEvent: value => events.push(value.type) }, f.runtime);
  assert.deepEqual(f.port.sent, { query: 'A' });
  f.port.onMessage.emit({ type: 'waiting', until: 3000 });
  f.port.onMessage.emit({ type: 'chunk', text: 'first' });
  f.port.onMessage.emit({ type: 'chunk', text: 'tail' });
  f.port.onMessage.emit({ type: 'done' });
  assert.equal(await result, 'firsttail'); assert.deepEqual(events, ['waiting', 'chunk', 'chunk']);
  assert.equal(f.disconnects(), 1); assert.equal(f.port.onMessage.listeners.size, 0); assert.equal(f.port.onDisconnect.listeners.size, 0);
});
test('cancellation rejects once and ignores queued stale chunks/done events', async () => {
  const f = fixture(), controller = new AbortController(); let progress = 0;
  const failed = assert.rejects(requestArxiv('obsolete', { signal: controller.signal, onEvent: () => progress++ }, f.runtime), { name: 'AbortError' });
  const stale = [...f.port.onMessage.listeners][0];
  controller.abort(); stale({ type: 'chunk', text: 'old results' }); stale({ type: 'done' }); await failed;
  assert.equal(progress, 0); assert.equal(f.disconnects(), 1); assert.equal(f.port.onMessage.listeners.size, 0);
});
test('worker disconnect/error and synchronous send failure settle and clean up for recoverable retry', async () => {
  for (const kind of ['disconnect', 'error', 'send']) {
    const f = fixture();
    if (kind === 'send') f.port.postMessage = () => { throw new Error('send failed'); };
    const failed = assert.rejects(requestArxiv('A', {}, f.runtime), /interrupted|limited|send failed/);
    if (kind === 'disconnect') f.port.onDisconnect.emit();
    if (kind === 'error') f.port.onMessage.emit({ type: 'error', error: 'limited' });
    await failed; assert.equal(f.port.onMessage.listeners.size, 0); assert.equal(f.port.onDisconnect.listeners.size, 0);
  }
});
test('background arXiv ports accept only internal author/Search senders and constrain endpoint/query', async () => {
  const runtime = { id: 'extension', getURL: path => `chrome-extension://extension/${path}`, onConnect: event() };
  let url;
  bindArxivRequests(runtime, { request: async value => { url = value; } });
  const foreign = fixture(); Object.assign(foreign.port, { name: ARXIV_CHANNEL, sender: { id: 'extension', url: 'https://arxiv.org/abs/1' } });
  runtime.onConnect.emit(foreign.port); assert.equal(foreign.disconnects(), 1); assert.equal(url, undefined);
  const internal = fixture(); Object.assign(internal.port, { name: ARXIV_CHANNEL, sender: { id: 'extension', url: runtime.getURL('src/search/search.html') } });
  runtime.onConnect.emit(internal.port); internal.port.onMessage.emit({ query: 'author name' });
  await Promise.resolve(); assert.equal(new URL(url).origin, 'https://export.arxiv.org');
  assert.equal(new URL(url).searchParams.get('max_results'), '50');
});

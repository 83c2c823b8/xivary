import test from 'node:test';
import assert from 'node:assert/strict';
import { ArxivScheduler, retryAfter, ARXIV_INTERVAL_MS, ARXIV_REQUEST_MS, ARXIV_WAIT_MS } from '../extension/src/services/arxiv-scheduler.js';
import { progressiveAtom, buildArxivApiUrl } from '../extension/src/services/arxiv-paper-service.js';
import { LocalRepository } from '../extension/src/repository/local-repository.js';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture(fetchImpl, initial = { until: 0 }) {
  let time = Date.parse('2026-10-12T00:00:00Z'), id = 0, disk = initial;
  const timers = new Map(), starts = [];
  const setTimer = (fn, ms) => { const token = ++id; timers.set(token, { fn, at: time + ms }); return token; };
  const clearTimer = token => timers.delete(token);
  const options = { now: () => time, setTimer, clearTimer, random: () => 0.5,
    readState: async () => structuredClone(disk), writeState: async state => { disk = structuredClone(state); },
    fetchImpl: async (...args) => { starts.push({ url: args[0], at: time }); return fetchImpl(...args); } };
  const scheduler = new ArxivScheduler(options);
  const tick = async ms => {
    await flush(); const target = time + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
    }
    time = target; await flush();
  };
  return { scheduler, starts, tick, timers, options, disk: () => disk };
}
const ok = text => new Response(text || '<feed/>', { status: 200 });
const limited = value => new Response('Rate exceeded.', { status: 429, headers: value ? { 'Retry-After': value } : {} });

test('two author pages, field search and pagination share FIFO spacing with no parallel connections', async () => {
  let release;
  const f = fixture(() => new Promise(resolve => { release = () => resolve(ok()); }));
  const a = f.scheduler.request(buildArxivApiUrl('author A'));
  const b = f.scheduler.request(buildArxivApiUrl('author B'));
  const page = f.scheduler.request(buildArxivApiUrl('author A', 50, 50));
  const search = f.scheduler.request(buildArxivApiUrl('field search'));
  await flush(); assert.equal(f.starts.length, 1);
  await f.tick(5000); assert.equal(f.starts.length, 1, 'slow connection prevents overlapping even after interval');
  release(); await a; await flush(); assert.equal(f.starts.length, 2);
  release(); await b; await f.tick(2999); assert.equal(f.starts.length, 2);
  await f.tick(1); release(); await page;
  await f.tick(3000); release(); await search;
  assert.ok(f.starts.slice(1).every((entry, i) => entry.at - f.starts[i].at >= ARXIV_INTERVAL_MS));
  assert.equal(new URL(f.starts[2].url).searchParams.get('start'), '50');
  assert.equal(f.timers.size, 0);
});

test('Retry-After accepts seconds and HTTP date; malformed values use fallback', () => {
  const now = Date.parse('2026-10-12T00:00:00Z');
  assert.equal(retryAfter('12', now), now + 12000);
  assert.equal(retryAfter('Mon, 12 Oct 2026 00:00:09 GMT', now), now + 9000);
  for (const value of [null, '', 'invalid']) assert.equal(retryAfter(value, now), null);
});

for (const [name, header, delay] of [['seconds', '7', 7000], ['HTTP date', 'Mon, 12 Oct 2026 00:00:09 GMT', 9000], ['fallback jitter', null, 3375]]) {
  test(`429 ${name} applies global cooldown and retry yields fairly to second author`, async () => {
    let attempts = 0; const events = [];
    const f = fixture(() => ++attempts === 1 ? limited(header) : ok());
    const a = f.scheduler.request('A', { onEvent: event => events.push(event) });
    const b = f.scheduler.request('B');
    await flush(); assert.equal(f.starts.length, 1);
    await f.tick(delay - 1); assert.equal(f.starts.length, 1);
    await f.tick(1); await b;
    await f.tick(3000); await a;
    assert.deepEqual(f.starts.map(entry => entry.url), ['A', 'B', 'A']);
    assert.ok(events.some(event => event.retry)); assert.equal(f.timers.size, 0);
  });
}

test('429 retry exhaustion is bounded and retains cooldown; long Retry-After is never shortened to fit wait budget', async () => {
  const f = fixture(() => limited());
  const failed = assert.rejects(f.scheduler.request('A'), /retries exhausted/);
  await f.tick(30000); await failed;
  assert.equal(f.starts.length, 4); assert.equal(f.timers.size, 0);
  const long = fixture(() => limited('3600'));
  const exhausted = assert.rejects(long.scheduler.request('A'), /beyond the wait limit/);
  await flush(); await exhausted;
  assert.equal(long.starts.length, 1);
  assert.equal(long.disk().until - long.starts[0].at, 3600000);
  const restart = new ArxivScheduler(long.options);
  await assert.rejects(restart.request('B'), /beyond the wait limit/);
  assert.equal(long.starts.length, 1);
});

test('headerless 429 backoff grows across different authors rather than restarting for every query', async () => {
  let calls = 0;
  const f = fixture(() => ++calls <= 2 ? limited() : ok());
  const completed = Promise.all(['A', 'B', 'C'].map(url => f.scheduler.request(url)));
  await f.tick(17000); await completed;
  assert.deepEqual(f.starts.slice(0, 3).map(call => call.url), ['A', 'B', 'C']);
  assert.equal(f.starts[1].at - f.starts[0].at, 3375);
  assert.equal(f.starts[2].at - f.starts[1].at, 6750);
  assert.equal(f.timers.size, 0);
});

test('long permitted Retry-After updates waiting consumers every twenty seconds without early retry', async () => {
  let calls = 0; const updates = [];
  const f = fixture(() => ++calls === 1 ? limited('45') : ok());
  const result = f.scheduler.request('A', { onEvent: event => { if (event.type === 'waiting') updates.push(f.options.now()); } });
  await f.tick(44999); assert.equal(f.starts.length, 1);
  assert.ok(updates.includes(f.starts[0].at + 20000));
  assert.ok(updates.includes(f.starts[0].at + 40000));
  await f.tick(1); await result; assert.equal(f.starts.length, 2); assert.equal(f.timers.size, 0);
});

test('in-flight deduplication replays usable chunks; one cancellation does not abort other consumers', async () => {
  let push; const stream = new ReadableStream({ start(controller) { push = controller; } });
  const f = fixture(() => new Response(stream));
  const cancel = new AbortController(), seen = [];
  const first = assert.rejects(f.scheduler.request('A', { signal: cancel.signal }), { name: 'AbortError' });
  await flush(); push.enqueue(new TextEncoder().encode('first')); await flush();
  const second = f.scheduler.request('A', { onEvent: event => { if (event.type === 'chunk') seen.push(event.text); } });
  cancel.abort(); await first;
  push.enqueue(new TextEncoder().encode('second')); push.close();
  assert.equal(await second, 'firstsecond'); assert.deepEqual(seen, ['first', 'second']);
  assert.equal(f.starts.length, 1); assert.equal(f.timers.size, 0);
});

test('queued cancellation prevents obsolete fetches; wait limit and failed durable reservation fail closed', async () => {
  const f = fixture(() => ok(), { until: Date.parse('2026-10-12T00:00:10Z') });
  const controller = new AbortController();
  const cancelled = assert.rejects(f.scheduler.request('obsolete', { signal: controller.signal }), { name: 'AbortError' });
  await flush(); controller.abort(); await cancelled; await f.tick(10000);
  assert.equal(f.starts.length, 0); assert.equal(f.timers.size, 0);
  const broken = new ArxivScheduler({ ...f.options, writeState: async () => { throw new Error('disk failed'); } });
  await assert.rejects(broken.request('A'), /disk failed/); assert.equal(f.starts.length, 0);
});

test('restart retains a killed worker connection lease but never replays its queue', async () => {
  const f = fixture(() => ok(), { until: Date.parse('2026-10-12T00:00:28Z') });
  const result = f.scheduler.request('new consumer');
  await f.tick(ARXIV_REQUEST_MS + 2999); assert.equal(f.starts.length, 0);
  await f.tick(1); await result; assert.equal(f.starts.length, 1);
});

test('slow requests time out, and queued consumers never exceed the total wait budget', async () => {
  const slow = fixture((url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true })));
  const timedOut = assert.rejects(slow.scheduler.request('slow'), /interrupted/);
  await slow.tick(ARXIV_REQUEST_MS); await timedOut;
  assert.equal(slow.timers.size, 0);
  const busy = fixture(() => limited('30'));
  const failed = Promise.all(Array.from({ length: 5 }, (_, i) => assert.rejects(busy.scheduler.request(String(i)), /wait limit/)));
  await busy.tick(ARXIV_WAIT_MS); await failed;
  assert.equal(busy.timers.size, 0); assert.ok(busy.starts.length <= 4);
});

test('streaming emits first complete batch before tail, preserving order/dedup and tolerating split entries', () => {
  const batches = [];
  const parse = text => {
    if (!text.startsWith('<feed>') || !text.endsWith('</feed>')) throw new Error('not Atom');
    return [...new Set([...text.matchAll(/<entry>(\w+)<\/entry>/g)].map(match => match[1]))];
  };
  const append = progressiveAtom(papers => batches.push(papers), parse);
  append('<feed><entry>newest</ent'); assert.deepEqual(batches, []);
  append('ry><entry>older'); assert.deepEqual(batches, [['newest']]);
  append('</entry><entry>newest</entry></feed>');
  assert.deepEqual(batches, [['newest'], ['newest', 'older']]);
});

test('durable request deadline and partial interruption do not modify complete cache/library/preferences or enter backups', async () => {
  let disk;
  const repository = new LocalRepository({ read: async () => structuredClone(disk), write: async state => { disk = structuredClone(state); } });
  await repository.savePaper({ arxivId: '2401.00001', title: 'Keep', authors: ['Alex Kim'] });
  const before = structuredClone(disk);
  await repository.setArxivRequestState({ until: 12345 });
  assert.deepEqual({ ...disk, _arxivApi: undefined }, { ...before, _arxivApi: undefined });
  assert.deepEqual(await repository.getArxivRequestState(), { until: 12345 });
  for (const category of ['bookmarks', 'following']) assert.equal(JSON.stringify(await repository.exportCategory(category)).includes('_arxivApi'), false);
  const failed = new ArxivScheduler({ readState: () => repository.getArxivRequestState(), writeState: state => repository.setArxivRequestState(state),
    fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('interrupted')); } })) });
  await assert.rejects(failed.request('A'), /interrupted/);
  assert.deepEqual(disk.authorPaperCaches, before.authorPaperCaches);
});

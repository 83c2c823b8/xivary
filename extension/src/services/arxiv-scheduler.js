export const ARXIV_INTERVAL_MS = 3000;
export const ARXIV_WAIT_MS = 120000;
export const ARXIV_REQUEST_MS = 25000;
export const ARXIV_RETRIES = 3;
export const ARXIV_CHANNEL = 'xivary:arxiv:v1';

export function retryAfter(value, now) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const delay = Number(value) * 1000;
    return Number.isFinite(delay) ? now + delay : null;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(now, date) : null;
}

/** One FIFO, one connection, shared by all extension consumers in the worker.
 * Only a deadline/connection lease is durable; obsolete work is never replayed.
 */
export class ArxivScheduler {
  constructor({ fetchImpl = (...args) => fetch(...args), readState, writeState, now = Date.now,
    setTimer = (...args) => setTimeout(...args), clearTimer = timer => clearTimeout(timer), random = Math.random }) {
    Object.assign(this, { fetchImpl, readState, writeState, now, setTimer, clearTimer, random });
    this.jobs = new Map(); this.queue = []; this.running = false; this.until = 0; this.failures = 0;
    this.ready = Promise.resolve().then(readState).then(state => {
      if (state && (!Number.isFinite(state.until) || state.until < 0)) throw new Error('Invalid arXiv request deadline.');
      this.until = state?.until || 0;
    });
    this.ready.catch(() => {});
  }

  request(url, { signal, onEvent = () => {} } = {}) {
    if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    let job = this.jobs.get(url);
    if (!job) {
      job = { url, consumers: new Set(), attempts: 0, text: '', controller: null };
      this.jobs.set(url, job); this.queue.push(job);
    }
    return new Promise((resolve, reject) => {
      const consumer = { resolve, reject, onEvent, deadline: this.now() + ARXIV_WAIT_MS };
      const remove = error => {
        if (!job.consumers.delete(consumer)) return;
        consumer.cleanup(); reject(error);
        if (!job.consumers.size) {
          this.jobs.delete(url); job.controller?.abort();
          job.wake?.();
        }
      };
      consumer.cancel = remove;
      const abort = () => remove(new DOMException('Cancelled', 'AbortError'));
      const timeout = this.setTimer(() => remove(new Error('arXiv wait limit reached. Results may be incomplete; use Refresh to retry.')), ARXIV_WAIT_MS);
      consumer.cleanup = () => { this.clearTimer(timeout); signal?.removeEventListener('abort', abort); };
      signal?.addEventListener('abort', abort, { once: true });
      job.consumers.add(consumer);
      try {
        if (!job.text && !job.status) onEvent({ type: 'queued' });
        if (job.text) onEvent({ type: 'chunk', text: job.text });
        else if (job.status) onEvent(job.status);
      } catch (error) { remove(error); }
      void this.pump();
    });
  }

  emit(job, event) {
    if (event.type !== 'chunk') job.status = event;
    for (const consumer of [...job.consumers]) { try { consumer.onEvent(event); } catch (error) { consumer.cancel(error); } }
  }
  finish(job, error) {
    if (this.jobs.get(job.url) === job) this.jobs.delete(job.url);
    for (const consumer of job.consumers) {
      consumer.cleanup();
      if (error) consumer.reject(error); else consumer.resolve(job.text);
    }
    job.consumers.clear();
  }
  async persist(until) {
    this.until = until; // Retain known server cooldown even if its disk write fails.
    await this.writeState({ until }); // Fail closed: no request before local commit.
  }
  async wait(job, milliseconds) {
    await new Promise(resolve => {
      const timer = this.setTimer(done, milliseconds);
      function done() { job.wake = null; resolve(); }
      job.wake = () => { this.clearTimer(timer); done(); };
    });
  }
  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      await this.ready;
      while (this.queue.length) {
        const job = this.queue.shift();
        if (!job.consumers.size) continue;
        while (this.until > this.now() && job.consumers.size) {
          this.emit(job, { type: 'waiting', until: this.until, retry: job.attempts > 0 });
          for (const consumer of [...job.consumers]) if (this.until >= consumer.deadline) {
            job.consumers.delete(consumer); consumer.cleanup();
            consumer.reject(new Error('arXiv is rate limited beyond the wait limit. Results may be incomplete; use Refresh later.'));
          }
          // Waiting-status port messages also keep an ordinary MV3 idle timeout
          // from interrupting a permitted long Retry-After. No durable queue.
          if (job.consumers.size) await this.wait(job, Math.min(20000, this.until - this.now()));
        }
        if (!job.consumers.size) { this.finish(job); continue; }
        let started = this.now();
        // A killed worker may have held a connection. Its replacement waits for
        // this persisted request timeout + spacing, even without an old queue.
        const leaseUntil = started + ARXIV_REQUEST_MS + ARXIV_INTERVAL_MS;
        await this.persist(leaseUntil);
        if (!job.consumers.size) {
          await this.persist(Math.max(started + ARXIV_INTERVAL_MS, this.now()));
          this.finish(job); continue;
        }
        const remaining = leaseUntil - ARXIV_INTERVAL_MS - this.now();
        if (remaining <= 0) throw new Error('arXiv reservation timed out before the request could start. Use Refresh to retry.');
        started = this.now();
        job.controller = new AbortController();
        const timeout = this.setTimer(() => job.controller.abort(), remaining);
        let requeue = false;
        try {
          const response = await this.fetchImpl(job.url, { headers: { Accept: 'application/atom+xml' }, signal: job.controller.signal, redirect: 'error' });
          if (response.status === 429) {
            const cooldown = retryAfter(response.headers?.get('Retry-After'), this.now()) ??
              this.now() + Math.min(30000, 3000 * 2 ** this.failures) * (1 + this.random() * 0.25);
            this.failures = Math.min(4, this.failures + 1);
            job.attempts++;
            await response.body?.cancel().catch(() => {});
            await this.persist(Math.max(started + ARXIV_INTERVAL_MS, cooldown));
            for (const waiting of this.jobs.values()) this.emit(waiting, { type: 'waiting', until: this.until, retry: waiting === job || waiting.attempts > 0 });
            if (job.attempts > ARXIV_RETRIES) throw new Error('arXiv rate-limit retries exhausted. Results may be incomplete; use Refresh later.');
            this.emit(job, { type: 'waiting', until: this.until, retry: true });
            requeue = true;
          } else {
            if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`arXiv returned ${response.status}.`); }
            this.failures = 0;
            this.emit(job, { type: 'loading' });
            const reader = response.body?.getReader();
            if (reader) {
              const decoder = new TextDecoder();
              try {
                while (true) {
                  const { value, done } = await reader.read();
                  const text = decoder.decode(value, { stream: !done });
                  if (job.text.length + text.length > 2_000_000) throw new Error('arXiv response is too large.');
                  if (text) { job.text += text; this.emit(job, { type: 'chunk', text }); }
                  if (done) break;
                }
              } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
            } else {
              job.text = await response.text();
              if (job.text.length > 2_000_000) throw new Error('arXiv response is too large.');
              this.emit(job, { type: 'chunk', text: job.text });
            }
            await this.persist(Math.max(started + ARXIV_INTERVAL_MS, this.now()));
            this.finish(job);
          }
        } catch (error) {
          if (!requeue) {
            // Do not shorten a server cooldown on exhausted retries.
            if (job.attempts === 0) await this.persist(Math.max(started + ARXIV_INTERVAL_MS, this.now()));
            this.finish(job, error.name === 'AbortError' ? new Error('arXiv request interrupted. Results may be incomplete; use Refresh to retry.') : error);
          }
        } finally { this.clearTimer(timeout); job.controller = null; }
        if (requeue) this.queue.push(job); // Retries yield to already queued authors.
      }
    } catch (error) {
      for (const job of this.jobs.values()) this.finish(job, error);
      this.queue = [];
    } finally { this.running = false; }
  }
}

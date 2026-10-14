import { getBrowserApi } from '../platform/browser-api.js';
import { ARXIV_CHANNEL } from './arxiv-scheduler.js';

export function requestArxiv(query, { signal, onEvent = () => {}, start } = {}, runtime = getBrowserApi().runtime) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const port = runtime.connect({ name: ARXIV_CHANNEL });
    let text = '', settled = false;
    const finish = error => {
      if (settled) return;
      settled = true; signal?.removeEventListener('abort', abort);
      port.onMessage.removeListener(message); port.onDisconnect.removeListener(disconnected);
      try { port.disconnect(); } catch {}
      if (error) reject(error); else resolve(text);
    };
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    const disconnected = () => finish(new Error('arXiv connection interrupted. Use Refresh to retry.', { cause: runtime.lastError?.message }));
    const message = event => {
      if (settled) return;
      if (event.type === 'error') { finish(new Error(event.error)); return; }
      if (event.type === 'done') { finish(); return; }
      if (event.type === 'chunk') text += event.text;
      try { onEvent(event); } catch (error) { finish(error); }
    };
    signal?.addEventListener('abort', abort, { once: true });
    port.onMessage.addListener(message); port.onDisconnect.addListener(disconnected);
    try { port.postMessage(start === undefined ? { query } : { query, start }); } catch (error) { finish(error); }
  });
}

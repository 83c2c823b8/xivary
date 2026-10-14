import { ARXIV_CHANNEL } from '../services/arxiv-scheduler.js';
import { buildArxivApiUrl } from '../services/arxiv-paper-service.js';

export function bindArxivRequests(runtime, scheduler) {
  runtime.onConnect.addListener(port => {
    if (port.name !== ARXIV_CHANNEL) return;
    const allowed = port.sender?.id === runtime.id &&
      ['author/author.html', 'search/search.html', 'feed/feed.html'].some(path => port.sender?.url === runtime.getURL(`src/${path}`) || port.sender?.url?.startsWith(runtime.getURL(`src/${path}`) + '?'));
    if (!allowed) { port.disconnect(); return; }
    const controller = new AbortController();
    let started = false;
    const send = message => { if (!controller.signal.aborted) { try { port.postMessage(message); } catch { controller.abort(); } } };
    port.onDisconnect.addListener(() => controller.abort());
    port.onMessage.addListener(message => {
      if (started) return;
      started = true;
      const start = message?.start ?? 0;
      const feed = port.sender.url.split('?')[0] === runtime.getURL('src/feed/feed.html');
      if (typeof message?.query !== 'string' || !message.query.trim() || message.query.length > 4096
          || !Number.isSafeInteger(start) || start < 0 || start > 150 || start % 50 !== 0 || (!feed && start !== 0)) {
        send({ type: 'error', error: 'Invalid arXiv query.' }); return;
      }
      scheduler.request(buildArxivApiUrl(message.query, 50, start), { signal: controller.signal, onEvent: send }).then(
        () => send({ type: 'done' }), error => send({ type: 'error', error: error.message }),
      );
    });
  });
}

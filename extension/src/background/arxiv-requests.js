import { ARXIV_CHANNEL } from '../services/arxiv-scheduler.js';
import { buildArxivApiUrl } from '../services/arxiv-paper-service.js';

export function bindArxivRequests(runtime, scheduler) {
  runtime.onConnect.addListener(port => {
    if (port.name !== ARXIV_CHANNEL) return;
    const allowed = port.sender?.id === runtime.id &&
      ['author/author.html', 'search/search.html'].some(path => port.sender?.url === runtime.getURL(`src/${path}`) || port.sender?.url?.startsWith(runtime.getURL(`src/${path}`) + '?'));
    if (!allowed) { port.disconnect(); return; }
    const controller = new AbortController();
    let started = false;
    const send = message => { if (!controller.signal.aborted) { try { port.postMessage(message); } catch { controller.abort(); } } };
    port.onDisconnect.addListener(() => controller.abort());
    port.onMessage.addListener(message => {
      if (started) return;
      started = true;
      if (typeof message?.query !== 'string' || !message.query.trim() || message.query.length > 4096) {
        send({ type: 'error', error: 'Invalid arXiv query.' }); return;
      }
      scheduler.request(buildArxivApiUrl(message.query), { signal: controller.signal, onEvent: send }).then(
        () => send({ type: 'done' }), error => send({ type: 'error', error: error.message }),
      );
    });
  });
}

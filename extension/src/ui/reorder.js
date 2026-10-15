/** Handle-only pointer dragging; no HTML draggable rows or changed navigation. */
export function bindReorder(list, { move }) {
  let drag;
  const items = () => [...list.children].filter(node => node.dataset.reorderId);
  function clear() {
    if (!drag) return;
    const { handle, pointerId } = drag;
    for (const node of items()) node.classList.remove('drop-before', 'drop-after', 'reorder-dragging');
    drag = null;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    window.removeEventListener('keydown', cancelKey, true);
    window.removeEventListener('scroll', scrolled, true);
    window.removeEventListener('pointermove', handle.moving); window.removeEventListener('pointerup', handle.released); window.removeEventListener('pointercancel', clear);
  }
  function cancelKey(event) { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); clear(); } }
  function indicate() {
    if (!drag?.active) return;
    const candidates = items().filter(node => node.dataset.reorderId !== drag.id);
    for (const node of items()) node.classList.remove('drop-before', 'drop-after');
    const target = candidates.find(node => drag.y < node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2);
    drag.beforeId = target?.dataset.reorderId ?? null;
    if (target) target.classList.add('drop-before'); else candidates.at(-1)?.classList.add('drop-after');
  }
  function scrolled() { indicate(); }
  function handleFor(row, id, name) {
    let handle = row.querySelector('.reorder-handle');
    if (handle) return handle;
    handle = document.createElement('button'); handle.type = 'button'; handle.className = 'reorder-handle'; handle.dataset.reorderHandle = id;
    handle.setAttribute('aria-label', `Move ${name}`); handle.setAttribute('aria-description', 'Drag to move. Arrow Up or Down moves one position; Home or End moves to the first or last position.');
    handle.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Home End');
    handle.innerHTML = '<svg viewBox="0 0 18 24" aria-hidden="true"><circle cx="6" cy="6" r="1.4"/><circle cx="12" cy="6" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="6" cy="18" r="1.4"/><circle cx="12" cy="18" r="1.4"/></svg>';
    handle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
    handle.addEventListener('keydown', event => {
      if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const ids = items().map(node => node.dataset.reorderId), index = ids.indexOf(id);
      const destination = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : index + (event.key === 'ArrowUp' ? -1 : 1);
      if (destination < 0 || destination >= ids.length || destination === index) return;
      const remaining = ids.filter(value => value !== id);
      void move(id, remaining[destination] ?? null, name);
    });
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || handle.disabled) return;
      event.preventDefault(); event.stopPropagation(); clear(); handle.focus({ preventScroll: true });
      drag = { id, name, row: row.closest('[data-reorder-id]'), handle, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, active: false };
      handle.setPointerCapture(event.pointerId);
      window.addEventListener('pointermove', handle.moving); window.addEventListener('pointerup', handle.released); window.addEventListener('pointercancel', clear);
      window.addEventListener('keydown', cancelKey, true); window.addEventListener('scroll', scrolled, true);
    });
    handle.moving = event => {
      if (event.currentTarget === handle) event.stopPropagation();
      if (drag?.handle !== handle || event.pointerId !== drag.pointerId) return;
      drag.x = event.clientX; drag.y = event.clientY;
      if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 4) { drag.active = true; drag.row.classList.add('reorder-dragging'); }
      indicate();
      if (!drag.active) return;
      const pane = list.closest('.collection-sidebar'), bounds = pane?.getBoundingClientRect();
      if (pane && pane.scrollHeight > pane.clientHeight && event.clientY > bounds.bottom - 32) pane.scrollBy(0, 12);
      else if (pane && pane.scrollHeight > pane.clientHeight && event.clientY < bounds.top + 32) pane.scrollBy(0, -12);
      else if (event.clientY > innerHeight - 32) window.scrollBy(0, 12);
      else if (event.clientY < 32) window.scrollBy(0, -12);
    };
    handle.addEventListener('pointermove', handle.moving);
    handle.released = event => {
      if (event.currentTarget === handle) event.stopPropagation();
      if (drag?.handle !== handle || event.pointerId !== drag.pointerId) return;
      const request = drag, bounds = list.getBoundingClientRect();
      const valid = request.active && event.clientX >= bounds.left - 24 && event.clientX <= bounds.right + 24 && event.clientY >= bounds.top - 20 && event.clientY <= bounds.bottom + 20;
      clear(); if (valid) void move(request.id, request.beforeId, request.name);
    };
    handle.addEventListener('pointerup', handle.released);
    handle.addEventListener('pointercancel', clear); handle.addEventListener('lostpointercapture', clear);
    row.prepend(handle); return handle;
  }
  return { attach(row, id, name) { row.classList.add('reorderable'); handleFor(row, id, name); },
    cancel: clear, get dragging() { return Boolean(drag); },
    clear() { clear(); for (const node of items()) { node.querySelector('.reorder-handle')?.remove(); node.classList.remove('reorderable'); delete node.dataset.reorderId; } } };
}

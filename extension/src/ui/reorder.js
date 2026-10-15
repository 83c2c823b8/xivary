/** Handle-only pointer dragging; no HTML draggable rows or changed navigation. */
export function bindReorder(list, { move }) {
  let drag;
  const items = () => [...list.children].filter(node => node.dataset.reorderId);
  function inside(x, y) {
    const rows = items(), bounds = list.getBoundingClientRect();
    return rows.length > 0 && x >= bounds.left && x <= bounds.right
      && y >= rows[0].getBoundingClientRect().top && y <= rows.at(-1).getBoundingClientRect().bottom;
  }
  function clear({ keepFocus = false } = {}) {
    if (!drag) return;
    const { handle, pointerId } = drag;
    for (const node of items()) node.classList.remove('drop-before', 'drop-after', 'reorder-dragging');
    drag = null;
    // End pointer interaction without leaving focus-within/keyboard-looking focus.
    // Never blur another control, or blur a click that did not become a drag.
    if (!keepFocus && document.activeElement === handle) handle.blur();
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    window.removeEventListener('keydown', cancelKey, true); window.removeEventListener('blur', clear);
    window.removeEventListener('scroll', scrolled, true);
    window.removeEventListener('pointermove', handle.moving); window.removeEventListener('pointerup', handle.released); window.removeEventListener('pointercancel', clear);
  }
  function cancelKey(event) { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); clear(); } }
  function indicate() {
    if (!drag?.active) return;
    const candidates = items().filter(node => node.dataset.reorderId !== drag.id);
    for (const node of items()) node.classList.remove('drop-before', 'drop-after');
    if (!inside(drag.x, drag.y)) return;
    const target = candidates.find(node => drag.y < node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2);
    drag.beforeId = target?.dataset.reorderId ?? null;
    if (target) target.classList.add('drop-before'); else candidates.at(-1)?.classList.add('drop-after');
  }
  function scrolled() { indicate(); }
  async function commit(id, beforeId, name, keyboardHandle) {
    // Saves can disable buttons and replace rows. Restore focus only for keyboard
    // moves, and only while the user has not focused something else during I/O.
    let focusMoved = false;
    const changedFocus = event => { if (event.target !== keyboardHandle && event.target !== document.body) focusMoved = true; };
    if (keyboardHandle) window.addEventListener('focusin', changedFocus);
    try { await move(id, beforeId, name); }
    finally {
      if (keyboardHandle) {
        window.removeEventListener('focusin', changedFocus);
        if (!focusMoved && (document.activeElement === keyboardHandle || document.activeElement === document.body)) {
          const row = items().find(node => node.dataset.reorderId === id);
          const handle = row?.querySelector('.reorder-handle');
          if (handle && !handle.disabled) handle.focus({ preventScroll: true });
        }
      }
    }
  }
  function handleFor(row, id, name) {
    let handle = row.querySelector('.reorder-handle');
    if (handle) return handle;
    handle = document.createElement('button'); handle.type = 'button'; handle.className = 'reorder-handle'; handle.dataset.reorderHandle = id;
    handle.setAttribute('aria-label', `Move ${name}`); handle.setAttribute('aria-description', 'Drag to move. Arrow Up or Down moves one position; Home or End moves to the first or last position.');
    handle.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Home End');
    handle.innerHTML = '<svg viewBox="0 0 18 24" aria-hidden="true"><circle cx="6" cy="6" r="1.4"/><circle cx="12" cy="6" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="6" cy="18" r="1.4"/><circle cx="12" cy="18" r="1.4"/></svg>';
    handle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
    handle.addEventListener('keydown', event => {
      if (handle.disabled) return;
      if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const ids = items().map(node => node.dataset.reorderId), index = ids.indexOf(id);
      const destination = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : index + (event.key === 'ArrowUp' ? -1 : 1);
      if (destination < 0 || destination >= ids.length || destination === index) return;
      const remaining = ids.filter(value => value !== id);
      void commit(id, remaining[destination] ?? null, handle.reorderName, handle);
    });
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || handle.disabled) return;
      // Suppress native text/image dragging while keeping click-to-keyboard access.
      event.preventDefault(); event.stopPropagation(); clear(); handle.focus({ preventScroll: true });
      drag = { id, name: handle.reorderName, row: row.closest('[data-reorder-id]'), handle, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, active: false };
      handle.setPointerCapture(event.pointerId);
      window.addEventListener('pointermove', handle.moving); window.addEventListener('pointerup', handle.released); window.addEventListener('pointercancel', clear);
      window.addEventListener('keydown', cancelKey, true); window.addEventListener('blur', clear); window.addEventListener('scroll', scrolled, true);
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
      drag.x = event.clientX; drag.y = event.clientY; indicate();
      const request = drag;
      const valid = request.active && inside(event.clientX, event.clientY);
      clear({ keepFocus: !request.active }); if (valid) void commit(request.id, request.beforeId, request.name);
    };
    handle.addEventListener('pointerup', handle.released);
    handle.addEventListener('pointercancel', clear); handle.addEventListener('lostpointercapture', clear);
    row.prepend(handle); return handle;
  }
  function detach(row) {
    const handle = row.querySelector('.reorder-handle');
    if (drag?.handle === handle) clear();
    handle?.remove(); row.classList.remove('reorderable'); delete row.dataset.reorderId;
  }
  return { attach(row, id, name, { disabled = false, disabledReason = '' } = {}) {
      row.classList.add('reorderable'); const handle = handleFor(row, id, name);
      handle.reorderName = name; handle.setAttribute('aria-label', `Move ${name}`);
      handle.disabled = disabled; handle.dataset.reorderUnavailable = String(disabled);
      const instructions = 'Drag to move. Arrow Up or Down moves one position; Home or End moves to the first or last position.';
      handle.title = disabled ? disabledReason : instructions;
      handle.setAttribute('aria-description', handle.title);
      return handle;
    }, detach,
    cancel: clear, get dragging() { return Boolean(drag); } };
}

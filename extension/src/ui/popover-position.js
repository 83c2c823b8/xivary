const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));

export function pickerPosition({ anchor, width, height, viewportWidth, viewportHeight, margin = 8, gap = 7 }) {
  const below = Math.max(0, viewportHeight - margin - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - margin);
  const side = height <= below ? "below" : height <= above ? "above" : below >= above ? "below" : "above";
  const maxHeight = Math.min(height, side === "below" ? below : above, Math.max(0, viewportHeight - margin * 2));
  const preferredLeft = (anchor.left + anchor.right) / 2 > viewportWidth / 2 ? anchor.right - width : anchor.left;
  return {
    left: clamp(preferredLeft, margin, viewportWidth - margin - width),
    top: clamp(side === "below" ? anchor.bottom + gap : anchor.top - gap - maxHeight, margin, viewportHeight - margin - maxHeight),
    maxHeight, side,
  };
}

export function pointerPosition({ x, y, width, height, viewportWidth, viewportHeight, margin = 8 }) {
  return { left: clamp(x, margin, viewportWidth - margin - width), top: clamp(y, margin, viewportHeight - margin - height) };
}

/** One active picker: coalesce geometry work and release all observers on close. */
export function anchorPicker(panel, anchor, close) {
  let frame = 0, stopped = false;
  function update() {
    frame = 0;
    if (stopped) return;
    if (!anchor.isConnected) { close(); return; }
    // client dimensions exclude scrollbars, unlike innerWidth/innerHeight.
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    panel.style.maxWidth = `${Math.max(0, viewportWidth - 16)}px`;
    const bounds = panel.getBoundingClientRect();
    const position = pickerPosition({ anchor: anchor.getBoundingClientRect(), width: bounds.width,
      height: Math.min(360, panel.scrollHeight + bounds.height - panel.clientHeight),
      viewportWidth, viewportHeight });
    panel.style.left = `${position.left}px`;
    panel.style.top = `${position.top}px`;
    panel.style.maxHeight = `${position.maxHeight}px`;
    panel.dataset.placement = position.side;
  }
  const schedule = () => { if (!stopped && !frame) frame = requestAnimationFrame(update); };
  const resize = new ResizeObserver(schedule);
  resize.observe(panel); resize.observe(anchor); resize.observe(document.body);
  // Coalesce layout/content changes; ignore our own panel attribute writes.
  const mutation = new MutationObserver(records => {
    if (records.some(record => record.type !== "attributes" || !panel.contains(record.target))) schedule();
  });
  mutation.observe(document.body, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ["style", "class", "hidden"] });
  window.addEventListener("resize", schedule);
  document.addEventListener("scroll", schedule, true);
  update();
  return () => {
    stopped = true; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect();
    window.removeEventListener("resize", schedule); document.removeEventListener("scroll", schedule, true);
  };
}

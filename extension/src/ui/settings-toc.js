/** Last heading above the reading line, with a bottom-of-document fallback. */
export function currentSection(tops, offset, atBottom = false) {
  if (!tops.length) return -1;
  if (atBottom) return tops.length - 1;
  let index = 0;
  for (let i = 0; i < tops.length; i++) if (tops[i] <= offset + 1) index = i;
  return index;
}

/** A table of contents, never a router: every control stays mounted. */
export function bindSettingsToc(doc = document, view = window) {
  const nav = doc.querySelector('.settings-toc');
  const sections = [...doc.querySelectorAll('[data-settings-section]')];
  if (!nav || !sections.length) return () => {};
  const links = [...nav.querySelectorAll('a[href]')];
  let frame = null, disposed = false, active = -1;
  const offset = () => view.matchMedia('(max-width: 700px)').matches ? nav.getBoundingClientRect().height + 12 : 16;
  function update() {
    frame = null;
    const gap = offset(), root = doc.scrollingElement;
    doc.documentElement.style.setProperty('--settings-scroll-offset', `${gap}px`);
    const next = currentSection(sections.map(section => section.getBoundingClientRect().top), gap,
      root.scrollTop > 0 && root.scrollTop + view.innerHeight >= root.scrollHeight - 1);
    if (next === active) return;
    active = next;
    links.forEach(link => {
      if (link.hash.slice(1) === sections[active].dataset.settingsSection) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  const schedule = () => { if (frame === null) frame = view.requestAnimationFrame(update); };
  function navigate(fragment, smooth = false) {
    const section = sections.find(section => section.dataset.settingsSection === fragment);
    if (!section) return;
    // CSS scroll-margin also protects native fragments; explicit positioning
    // handles #latex-macros, whose existing ID belongs to the textarea.
    const top = section.getBoundingClientRect().top + doc.scrollingElement.scrollTop - offset();
    view.scrollTo({ top: Math.max(0, top), behavior: smooth && !view.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
    schedule();
  }
  function click(event) {
    const link = event.target.closest?.('a[href]');
    if (!link || !nav.contains(link) || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    // No pushState/replaceState: scrolling and scroll-spy never rewrite history.
    navigate(link.hash.slice(1), true);
  }
  const fragment = () => navigate(view.location.hash.slice(1));
  nav.addEventListener('click', click);
  view.addEventListener('scroll', schedule, { passive: true });
  view.addEventListener('resize', schedule);
  view.addEventListener('hashchange', fragment);
  const observer = new view.ResizeObserver(schedule);
  observer.observe(nav); sections.forEach(section => observer.observe(section));
  update();
  // Fonts and the browser's initial fragment scroll can settle after modules.
  Promise.resolve(doc.fonts?.ready).then(() => {
    if (!disposed) { fragment(); schedule(); }
  });
  function dispose(event) {
    if (event?.persisted) return;
    if (disposed) return;
    disposed = true;
    if (frame !== null) view.cancelAnimationFrame(frame);
    observer.disconnect();
    nav.removeEventListener('click', click);
    view.removeEventListener('scroll', schedule);
    view.removeEventListener('resize', schedule);
    view.removeEventListener('hashchange', fragment);
    view.removeEventListener('pagehide', dispose);
  }
  view.addEventListener('pagehide', dispose);
  return dispose;
}

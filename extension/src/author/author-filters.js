import { publicationTimeFilter } from '../ui/publication-time-filter.js';

/** Ephemeral view state only; repository/cache refreshes do not reset filters. */
export function authorFilters(changed) {
  const get = id => document.getElementById(id);
  const search = get('paper-query'), toggle = get('show-filters'), panel = get('filters');
  const time = publicationTimeFilter(changed);
  function searchState() {
    const filtered = Boolean(search.value.trim());
    toggle.classList.toggle('active-filter', filtered);
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    toggle.title = filtered ? 'Search papers (filter active)' : 'Search papers';
    toggle.setAttribute('aria-label', toggle.title);
  }
  function openSearch() { panel.hidden = false; searchState(); search.focus(); }
  function closeSearch(restore = false) { panel.hidden = true; searchState(); if (restore) toggle.focus(); }
  toggle.addEventListener('click', () => panel.hidden ? openSearch() : closeSearch());
  search.addEventListener('input', () => { searchState(); changed(); });
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch(true); }
  });
  // Dismiss search after activation: hiding it during pointerdown can move the
  // time trigger before pointerup and lose the intended click.
  document.addEventListener('click', event => {
    if (!panel.hidden && !search.value.trim() && !panel.contains(event.target) && !toggle.contains(event.target)) closeSearch();
  });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !time.isOpen() &&
      !event.target.closest('input,textarea,select,[contenteditable=true],dialog')) {
      event.preventDefault(); openSearch();
    }
  });
  return { values: () => ({ ...time.values(), query: search.value }) };
}

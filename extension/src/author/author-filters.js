import { anchorPicker } from '../ui/popover-position.js';
import { validateYearRange } from './filter-papers.js';

const options = [['any', 'Any time'], ['year', 'Past year'], ['three-years', 'Past 3 years'], ['custom', 'Custom…']];

/** Ephemeral view state only; repository/cache refreshes do not reset filters. */
export function authorFilters(changed) {
  const get = id => document.getElementById(id);
  const search = get('paper-query'), toggle = get('show-filters'), panel = get('filters');
  const trigger = get('date-range'), form = get('custom-years'), feedback = get('year-feedback');
  let active = { range: 'any', from: '', to: '' }, validYears = { from: '', to: '' }, menu, stopPositioning;
  const label = range => options.find(option => option[0] === range)[1];
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
  document.addEventListener('pointerdown', event => {
    if (menu && !menu.contains(event.target) && !trigger.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !menu &&
      !event.target.closest('input,textarea,select,[contenteditable=true],dialog')) {
      event.preventDefault(); openSearch();
    }
  });
  function closeMenu(restore = false) {
    if (!menu) return;
    stopPositioning?.(); menu.remove(); menu = undefined;
    trigger.setAttribute('aria-expanded', 'false');
    if (restore) trigger.focus();
  }
  function select(range) {
    closeMenu(true);
    form.hidden = range !== 'custom';
    for (const id of ['year-from', 'year-to']) get(id).removeAttribute('aria-invalid');
    if (range === 'custom') {
      get('year-from').value = validYears.from; get('year-to').value = validYears.to;
      feedback.textContent = active.range === 'custom' ? '' : `Apply years to replace ${label(active.range)}.`;
      get('year-from').focus();
    } else {
      active = { range, from: '', to: '' }; feedback.textContent = ''; update(); changed();
    }
  }
  function openMenu(direction = 0) {
    menu = document.createElement('div'); menu.className = 'time-menu'; menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Publication time');
    const buttons = options.map(([value, text]) => {
      const button = document.createElement('button'); button.type = 'button'; button.tabIndex = -1;
      button.setAttribute('role', 'menuitemradio'); button.setAttribute('aria-checked', String(value === active.range));
      button.dataset.range = value;
      const tick = document.createElement('span'); tick.textContent = value === active.range ? '✓' : ''; tick.setAttribute('aria-hidden', 'true');
      button.append(tick, document.createTextNode(text)); button.addEventListener('click', () => select(value));
      menu.append(button); return button;
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
      else if (event.key === 'Tab') closeMenu(true);
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const index = buttons.indexOf(document.activeElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
      }
    });
    document.body.append(menu); trigger.setAttribute('aria-expanded', 'true');
    stopPositioning = anchorPicker(menu, trigger, closeMenu);
    buttons[direction === -1 ? buttons.length - 1 : options.findIndex(option => option[0] === active.range)].focus();
  }
  trigger.addEventListener('click', () => menu ? closeMenu() : openMenu());
  trigger.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); if (!menu) openMenu(event.key === 'ArrowUp' ? -1 : 0); }
  });
  function update() {
    const text = active.range === 'custom' ? `${active.from || '…'}–${active.to || '…'}` : label(active.range);
    get('range-label').textContent = text;
    trigger.setAttribute('aria-label', `Publication time: ${text}`);
  }
  form.addEventListener('submit', event => {
    event.preventDefault(); const from = get('year-from').value.trim(), to = get('year-to').value.trim();
    const error = validateYearRange(from, to);
    feedback.textContent = error;
    for (const id of ['year-from', 'year-to']) get(id).setAttribute('aria-invalid', String(Boolean(error)));
    if (error) return;
    validYears = { from, to };
    active = { range: from || to ? 'custom' : 'any', from, to }; update(); changed();
  });
  get('clear-years').addEventListener('click', () => {
    get('year-from').value = get('year-to').value = ''; feedback.textContent = '';
    get('year-from').removeAttribute('aria-invalid'); get('year-to').removeAttribute('aria-invalid');
    validYears = { from: '', to: '' };
    active = { range: 'any', from: '', to: '' }; form.hidden = true; update(); changed(); trigger.focus();
  });
  update();
  return { values: () => ({ ...active, query: search.value }) };
}

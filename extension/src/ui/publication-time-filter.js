import { anchorPicker } from './popover-position.js';
import { validateYearRange } from '../domain/publication-date.js';

const options = [['any', 'Any time'], ['year', 'Past year'], ['three-years', 'Past 3 years'], ['custom', 'Custom…']];

/** Page-local applied values and drafts; no repository or persistence. */
export function publicationTimeFilter(changed) {
  const get = id => document.getElementById(id);
  const trigger = get('date-range'), form = get('custom-years'), feedback = get('year-feedback');
  let active = { range: 'any', from: '', to: '' }, validYears = { from: '', to: '' }, menu, stopPositioning;
  const label = range => options.find(option => option[0] === range)[1];
  document.addEventListener('pointerdown', event => {
    if (menu && !menu.contains(event.target) && !trigger.contains(event.target)) closeMenu();
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
  return { values: () => ({ ...active }), isOpen: () => Boolean(menu) };
}

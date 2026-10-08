// Presentation only: each page keeps its existing selection and repository operations.
const icons = {
  folder: '<path d="M3 7V5h6l2 2h10v13H3Z"/>',
  papers: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
  authors: '<circle cx="10" cy="8" r="4"/><path d="M3 21v-2a7 7 0 0 1 14 0v2M17 4a4 4 0 0 1 0 8m3 9v-2a7 7 0 0 0-2-5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  rename: '<path d="m4 16-.75 4.75L8 20l10.4-10.4a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m14.5 7.5 3 3"/>',
  delete: '<path d="M4 7h16M9 3h6l1 4H8l1-4Zm-3 4 1 14h10l1-14M10 11v6m4-6v6"/>',
};
let activeMenu;

function icon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.dataset.icon = kind;
  svg.innerHTML = icons[kind]; // Static, locally defined SVG only.
  return svg;
}

export function closeCollectionMenu() { activeMenu?.(); }

export function collectionSidebarRow(entry, { selected, aggregateIcon, select, rename, remove }) {
  const row = document.createElement('div'); row.className = 'collection-row';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'collection-link';
  button.dataset.collectionId = entry.id;
  if (entry.id === selected) { button.setAttribute('aria-current', 'page'); row.classList.add('selected'); }
  const name = document.createElement('span'); name.className = 'collection-name';
  const label = document.createElement('span'); label.className = 'collection-label'; label.textContent = entry.name;
  name.append(icon(entry.id ? 'folder' : aggregateIcon), label);
  const count = document.createElement('span'); count.className = 'collection-count'; count.textContent = entry.count;
  button.append(name, count);
  button.title = entry.name;
  button.addEventListener('click', () => { closeCollectionMenu(); select(); });
  row.append(button);
  if (entry.id) {
    const actions = document.createElement('div'); actions.className = 'collection-actions';
    const more = document.createElement('button'); more.type = 'button'; more.className = 'icon-button collection-menu-trigger';
    more.dataset.action = 'menu'; more.append(icon('more'));
    more.setAttribute('aria-label', `Manage ${entry.name}`); more.title = `Manage ${entry.name}`;
    more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', () => {
      if (more.getAttribute('aria-expanded') === 'true') closeCollectionMenu();
      else openMenu(more, entry, rename, remove);
    });
    more.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); openMenu(more, entry, rename, remove, event.key === 'ArrowUp');
      }
    });
    actions.append(more); row.append(actions);
  }
  return row;
}

function openMenu(anchor, entry, rename, remove, last = false) {
  closeCollectionMenu();
  const menu = document.createElement('div'); menu.className = 'collection-menu'; menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', `Manage ${entry.name}`);
  let closed = false;
  function close(restore = false) {
    if (closed) return;
    closed = true; menu.remove(); anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true);
    if (activeMenu === dismiss) activeMenu = undefined;
    if (restore && anchor.isConnected && !anchor.disabled) anchor.focus();
  }
  const dismiss = () => close();
  function outside(event) { if (!menu.contains(event.target) && !anchor.contains(event.target)) close(); }
  const items = [['rename', 'Rename', rename], ['delete', 'Delete collection', remove]].map(([action, text, operation]) => {
    const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'menuitem'); item.tabIndex = -1;
    item.dataset.action = action;
    const label = document.createElement('span'); label.textContent = text;
    item.append(icon(action), label);
    item.addEventListener('click', () => { if (closed) return; close(true); operation(); });
    menu.append(item); return item;
  });
  menu.addEventListener('keydown', event => {
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') { close(true); } // Native Tab continues from the trigger.
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }
  });
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.right - bounds.width, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - bounds.height - 8))}px`;
  anchor.setAttribute('aria-expanded', 'true');
  activeMenu = dismiss;
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', dismiss); window.addEventListener('scroll', dismiss, true);
  items[last ? items.length - 1 : 0].focus();
}

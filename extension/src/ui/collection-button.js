/** Compact presentation for the existing collection picker; no persistence. */
export function setCollectionButton(button, name, { iconOnly = false } = {}) {
  button.classList.add('collection-trigger');
  button.classList.toggle('collection-trigger-icon', iconOnly);
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5h7l2 2h9v13H3Z"/></svg>' + (iconOnly ? '' : '<span>Collections</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>');
  button.setAttribute('aria-label', `${iconOnly ? "Manage collections" : "Collections"} for ${name}`);
  if (iconOnly) button.title = 'Manage collections';
  button.setAttribute('aria-haspopup', 'dialog');
  if (!button.hasAttribute('aria-expanded')) button.setAttribute('aria-expanded', 'false');
}

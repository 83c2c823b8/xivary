/** Compact presentation for the existing collection picker; no persistence. */
export function setCollectionButton(button, name) {
  button.classList.add('collection-trigger');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5h7l2 2h9v13H3Z"/></svg><span>Collections</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
  button.setAttribute('aria-label', `Collections for ${name}`);
  button.setAttribute('aria-haspopup', 'dialog');
  if (!button.hasAttribute('aria-expanded')) button.setAttribute('aria-expanded', 'false');
}

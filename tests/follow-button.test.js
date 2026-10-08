import test from 'node:test';
import assert from 'node:assert/strict';
import { setFollowButton } from '../extension/src/ui/follow-button.js';

function node() {
  const attributes = new Map(), classes = new Set();
  return { children: [], classList: { add: value => classes.add(value), contains: value => classes.has(value) },
    setAttribute: (key, value) => attributes.set(key, value), getAttribute: key => attributes.get(key),
    hasAttribute: key => attributes.has(key), removeAttribute: key => attributes.delete(key),
    replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); } };
}
function withDocument(operation) {
  const original = globalThis.document;
  globalThis.document = { createElement: node, createElementNS: node };
  try { operation(); } finally { globalThis.document = original; }
}

test('shared Follow presentation has consistent icons, state and accessible action without accumulating children', () => withDocument(() => {
  const button = node();
  for (const followed of [false, true, true, false]) {
    setFollowButton(button, followed, 'Renée Smith');
    assert.equal(button.classList.contains('xivary-follow-button'), true);
    assert.equal(button.children.length, 2);
    assert.equal(button.children[0].getAttribute('aria-hidden'), 'true');
    assert.match(button.children[0].innerHTML, followed ? /3\.1/ : /M8 3v10/);
    assert.equal(button.children[1].textContent, followed ? 'Following' : 'Follow');
    assert.equal(button.getAttribute('aria-pressed'), String(followed));
    assert.equal(button.getAttribute('aria-label'), `${followed ? 'Unfollow' : 'Follow'}: Renée Smith`);
    assert.equal(button.title, `${followed ? 'Unfollow' : 'Follow'} Renée Smith`);
    assert.equal(button.hasAttribute('aria-haspopup'), false);
  }
}));

test('shared presentation preserves opt-in arXiv picker semantics and clears them on unfollow', () => withDocument(() => {
  const button = node();
  setFollowButton(button, true, 'Alex Kim', true);
  assert.equal(button.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.getAttribute('aria-label'), 'Organize collections for: Alex Kim');
  button.setAttribute('aria-expanded', 'true');
  setFollowButton(button, true, 'Alex Kim', true);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  setFollowButton(button, false, 'Alex Kim', true);
  assert.equal(button.hasAttribute('aria-haspopup'), false);
  assert.equal(button.hasAttribute('aria-expanded'), false);
}));

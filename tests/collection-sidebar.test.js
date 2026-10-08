import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionSidebarRow } from '../extension/src/ui/collection-sidebar.js';

function node() {
  const attributes = new Map(), listeners = new Map(), classes = new Set();
  return { children: [], dataset: {}, classList: { add: value => classes.add(value), contains: value => classes.has(value) },
    append(...children) { this.children.push(...children); },
    setAttribute: (key, value) => attributes.set(key, value), getAttribute: key => attributes.get(key),
    addEventListener: (key, value) => listeners.set(key, value), click: () => listeners.get('click')?.() };
}
function documentFixture(operation) {
  const before = globalThis.document;
  globalThis.document = { createElement: node, createElementNS: node };
  try { operation(); } finally { globalThis.document = before; }
}
test('aggregate sidebar rows use distinct icons and selection without collection management', () => documentFixture(() => {
  for (const [name, kind] of [['All Saved','papers'],['All Following','authors']]) {
    let selections = 0;
    const row = collectionSidebarRow({id:'',name,count:12},{selected:'',aggregateIcon:kind,select:()=>selections++});
    assert.equal(row.classList.contains('selected'),true);
    assert.equal(row.children.length,1);
    const link = row.children[0];
    assert.equal(link.getAttribute('aria-current'),'page');
    assert.equal(link.children[0].children[0].dataset.icon,kind);
    assert.equal(link.children[0].children[1].textContent,name);
    assert.equal(link.children[1].textContent,12);
    link.click(); assert.equal(selections,1);
  }
}));
test('real collection rows keep their IDs, safe names, count and discoverable menu separate from selection', () => documentFixture(() => {
  let selections = 0;
  const name = '<img src=x> Long collection';
  const row = collectionSidebarRow({id:'collection:existing',name,count:12345},{selected:'',aggregateIcon:'papers',select:()=>selections++});
  const [link, actions] = row.children;
  assert.equal(link.dataset.collectionId,'collection:existing');
  assert.equal(link.children[0].children[0].dataset.icon,'folder');
  assert.equal(link.children[0].children[1].textContent,name);
  assert.equal(link.children[1].textContent,12345);
  const more = actions.children[0];
  assert.equal(more.getAttribute('aria-label'),`Manage ${name}`);
  assert.equal(more.getAttribute('aria-haspopup'),'menu');
  assert.equal(more.getAttribute('aria-expanded'),'false');
  assert.equal(more.children[0].getAttribute('aria-hidden'),'true');
  assert.equal(more.children[0].dataset.icon,'more');
  assert.equal(selections,0);
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionSidebarRow } from '../extension/src/ui/collection-sidebar.js';

function node() {
  const attributes = new Map(), listeners = new Map(), classes = new Set();
  return { children: [], dataset: {}, classList: { add: value => classes.add(value), contains: value => classes.has(value) },
    append(...children) { this.children.push(...children); },
    setAttribute: (key, value) => attributes.set(key, value), getAttribute: key => attributes.get(key),
    addEventListener: (key, value) => listeners.set(key, value), click: () => listeners.get('click')?.(), dispatch: (key, event) => listeners.get(key)?.(event) };
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
test('real collection rows expose count and file-manager rename without permanent management controls', () => documentFixture(() => {
  let selections = 0, renames = 0;
  const name = '<img src=x> Long collection';
  const row = collectionSidebarRow({id:'collection:existing',name,count:12345},{selected:'',aggregateIcon:'papers',select:()=>selections++,rename:()=>renames++});
  assert.equal(row.children.length,1);
  const link = row.children[0];
  assert.equal(link.dataset.collectionId,'collection:existing');
  assert.equal(link.children[0].children[0].dataset.icon,'folder');
  assert.equal(link.children[0].children[1].textContent,name);
  assert.equal(link.children[1].textContent,12345);
  assert.equal(link.getAttribute('aria-haspopup'),'menu');
  assert.equal(link.getAttribute('aria-keyshortcuts'),'F2 Shift+F10');
  link.click(); assert.equal(selections,1);
  const event={key:'F2',target:link,preventDefault(){}};
  link.dispatch('keydown',event); assert.equal(renames,1);
  link.dispatch('keydown',{...event,target:{}}); assert.equal(renames,1,'typing elsewhere does not rename');
  link.dispatch('dblclick',event); assert.equal(renames,2);
}));

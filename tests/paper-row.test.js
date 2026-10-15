import test from 'node:test';
import assert from 'node:assert/strict';
import { arxivIdText, paperMetadata, paperRow } from '../extension/src/ui/paper-row.js';

test('display IDs use canonical modern/legacy identities, without versions, URLs or duplicate prefixes', () => {
  for (const [input, expected] of [
    ['2610.12279', 'arXiv:2610.12279'], ['2401.01234v12', 'arXiv:2401.01234'],
    [' arXiv:2401.01234v2 ', 'arXiv:2401.01234'], ['0704.0001', 'arXiv:0704.0001'],
    ['math/0601001v3', 'arXiv:math/0601001'],
    ['https://arxiv.org/abs/math/0601001v4?context=math', 'arXiv:math/0601001'],
    ['https://arxiv.org/pdf/2610.12279v2.pdf', 'arXiv:2610.12279'],
  ]) assert.equal(arxivIdText(input), expected);
  for (const input of [undefined, null, '', 123, {}, 'unknown', '2401.1', '2401.01234v0', 'arXiv:arXiv:2610.12279', 'https://example.com/abs/2610.12279', 'javascript:alert(1)']) assert.equal(arxivIdText(input), '');
});

// Lightweight DOM harness verifies the shared row's semantic structure/actions;
// installed browser coverage below exercises actual DOM, selection and geometry.
function node(tagName) {
  const attributes = new Map(), listeners = new Map();
  return { tagName: tagName.toUpperCase(), children: [], dataset: {}, className: '',
    set textContent(value) { this.children = [String(value)]; },
    get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); },
    append(...children) { this.children.push(...children); },
    setAttribute: (key, value) => attributes.set(key, String(value)), getAttribute: key => attributes.get(key),
    hasAttribute: key => attributes.has(key), removeAttribute: key => attributes.delete(key),
    addEventListener: (key, fn) => listeners.set(key, fn), listeners,
  };
}
function withDocument(operation) {
  const original = globalThis.document; globalThis.document = { createElement: node };
  try { operation(); } finally { globalThis.document = original; }
}
const input = { arxivId: 'arXiv:2610.12279v2', publishedAt: '2026-10-14T00:30:00Z',
  title: 'A research paper', authors: ['A. Author', 'B. Author'], categories: ['math.SG'],
  absUrl: 'https://arxiv.org/abs/2610.12279', pdfUrl: 'https://arxiv.org/pdf/2610.12279' };

test('ID shares the existing date/category paragraph, is ordinary unfocusable text, and does not mutate metadata', () => withDocument(() => {
  const before = structuredClone(input);
  const metadata = paperMetadata(input, { datePrefix: 'Submitted ', dateTimeZone: 'UTC' });
  assert.equal(metadata.tagName, 'P'); assert.equal(metadata.className, 'metadata');
  const spans = metadata.children.filter(child => typeof child !== 'string');
  assert.equal(spans.length, 1); const identifier = spans[0];
  assert.equal(identifier.tagName, 'SPAN'); assert.equal(identifier.textContent, 'arXiv:2610.12279');
  for (const attribute of ['href', 'tabindex', 'role', 'contenteditable']) assert.equal(identifier.hasAttribute(attribute), false);
  assert.equal(identifier.listeners.size, 0);
  assert.match(metadata.textContent, /^Submitted .* · arXiv:2610\.12279 · math\.SG$/);
  assert.deepEqual(input, before);
  assert.equal(paperMetadata({ ...input, publishedAt: null, categories: [] }).textContent, 'arXiv:2610.12279');
  assert.equal(paperMetadata({ ...input, arxivId: undefined, publishedAt: null }).textContent, 'math.SG');
}));

test('shared rows retain title/PDF links, bookmark action, author text and two metadata lines', () => withDocument(() => {
  let activated;
  const row = paperRow(input, { showAbstract: false, saved: true, onToggle: button => activated = button });
  const [heading, authors, metadata, actions] = row.children;
  assert.equal(row.children.length, 4); assert.equal(heading.children[0].href, input.absUrl);
  assert.equal(heading.children[0].hasAttribute('target'), false);
  assert.equal(authors.textContent, 'A. Author, B. Author');
  assert.equal(metadata.textContent.match(/arXiv:/g).length, 1);
  assert.equal(actions.children[0].href, input.pdfUrl);
  const button = actions.children[1]; assert.equal(button.getAttribute('aria-pressed'), 'true');
  button.listeners.get('click')(); assert.equal(activated, button);
  const offline = paperRow(input, { showAbstract: false, offlineLinks: 'read.html?id=2610.12279' });
  assert.equal(offline.children[0].children[0].href, 'read.html?id=2610.12279');
  assert.equal(offline.children.at(-1).children[0].href, 'read.html?id=2610.12279');
  assert.equal(offline.children[2].textContent.match(/arXiv:/g).length, 1);
}));

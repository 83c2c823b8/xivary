import test from 'node:test';
import assert from 'node:assert/strict';
import { contentConnection, isInvalidatedContext, RECONNECT_HINT } from '../extension/src/content/extension-context.js';
import { RepositoryClient } from '../extension/src/repository/repository-client.js';
import { setCollectionButton } from '../extension/src/ui/collection-button.js';

test('invalidated content connection stops runtime calls and reports recovery once, including synchronous failure', async () => {
  let calls = 0, unavailable = 0;
  const connection = contentConnection({sendMessage() { calls++; throw new Error('Extension context invalidated.'); }}, () => unavailable++);
  const repository = new RepositoryClient(connection);
  assert.equal(repository.available, true);
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (let i = 0; i < 3; i++) await assert.rejects(connection.sendMessage({}), {message: RECONNECT_HINT});
    assert.equal(connection.available, false);
    assert.equal(repository.available, false);
    await assert.rejects(repository.getPreferences(), {message: RECONNECT_HINT});
    assert.equal(calls, 1);
    assert.equal(unavailable, 1);
  } finally { console.warn = warn; }
});

test('recoverable runtime errors remain diagnostic and allow another request', async () => {
  let calls = 0;
  const error = new Error('Storage quota exceeded');
  const connection = contentConnection({async sendMessage() { if (++calls === 1) throw error; return {ok:true}; }}, () => assert.fail());
  await assert.rejects(connection.sendMessage({}), error);
  assert.equal(connection.available, true);
  assert.deepEqual(await connection.sendMessage({}), {ok:true});
  assert.equal(isInvalidatedContext(error), false);
  assert.equal(isInvalidatedContext(null), false);
});

test('Following icon-only collection trigger preserves picker semantics without injecting author text', () => {
  const attributes = new Map(), classes = new Set();
  const button = {classList: {add: key => classes.add(key), toggle: (key, value) => value ? classes.add(key) : classes.delete(key)},
    setAttribute: (key,value) => attributes.set(key,value), hasAttribute: key => attributes.has(key)};
  setCollectionButton(button, 'Renée <Smith>', {iconOnly:true});
  assert.equal(classes.has('collection-trigger-icon'), true);
  assert.equal((button.innerHTML.match(/<svg/g) || []).length, 1);
  assert.equal(button.innerHTML.includes('<span>'), false);
  assert.equal(button.innerHTML.includes('Smith'), false);
  assert.equal(attributes.get('aria-label'), 'Manage collections for Renée <Smith>');
  assert.equal(attributes.get('aria-haspopup'), 'dialog');
  assert.equal(button.title, 'Manage collections');
  attributes.set('aria-expanded','true');
  setCollectionButton(button, 'Renée Smith');
  assert.equal((button.innerHTML.match(/<svg/g) || []).length, 2);
  assert.equal(attributes.get('aria-expanded'), 'true');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { bindCollectionRenameOutside } from '../extension/src/ui/collection-rename.js';

test('outside rename cancellation never consumes activation and ignores inside, busy and inactive forms', () => {
  let listener, active = true, busy = false, cancellations = 0;
  const inside = {}, outside = {};
  const form = {contains: target => target === inside};
  bindCollectionRenameOutside({
    document: {addEventListener: (type, callback, capture) => { assert.equal(type,'pointerdown'); assert.equal(capture,true); listener = callback; }},
    getForm: () => active ? form : null, isBusy: () => busy, cancel: () => cancellations++,
  });
  const event = target => ({target, preventDefault: () => assert.fail('outside activation must continue'), stopPropagation: () => assert.fail('outside activation must continue')});
  listener(event(inside)); assert.equal(cancellations,0);
  busy = true; listener(event(outside)); assert.equal(cancellations,0);
  busy = false; listener(event(outside)); assert.equal(cancellations,1);
  active = false; listener(event(outside)); assert.equal(cancellations,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissalTimer } from '../extension/src/ui/undo.js';

function fixture() {
  let time = 0, serial = 0, dismissals = 0;
  const timers = new Map();
  const notice = dismissalTimer(() => dismissals++, { now: () => time,
    setTimer: (fn, ms) => { const id = ++serial; timers.set(id, { fn, at: time + ms }); return id; },
    clearTimer: id => timers.delete(id),
  });
  const tick = ms => {
    const end = time + ms;
    for (const [id, timer] of [...timers]) if (timer.at <= end) { time = timer.at; timers.delete(id); timer.fn(); }
    time = end;
  };
  return { notice, tick, timers, dismissals: () => dismissals };
}
test('Undo notice dismisses exactly at three seconds and stop releases its timer', () => {
  const f = fixture(); f.tick(2999); assert.equal(f.dismissals(), 0);
  f.tick(1); assert.equal(f.dismissals(), 1); assert.equal(f.timers.size, 0);
  f.notice.resume('hover'); f.tick(3000); assert.equal(f.dismissals(), 1);
  const stopped = fixture(); stopped.notice.stop(); stopped.tick(10000);
  assert.equal(stopped.dismissals(), 0); assert.equal(stopped.timers.size, 0);
});
test('hover pauses remaining visible time and leaving resumes without resetting it', () => {
  const f = fixture(); f.tick(1100); f.notice.pause('hover'); f.tick(5000);
  assert.equal(f.dismissals(), 0); assert.equal(f.timers.size, 0);
  f.notice.resume('hover'); f.tick(1899); assert.equal(f.dismissals(), 0);
  f.tick(1); assert.equal(f.dismissals(), 1);
});
test('keyboard focus and pending Undo prevent dismissal independently of hover', () => {
  const f = fixture(); f.tick(500); f.notice.pause('focus'); f.notice.pause('hover'); f.notice.pause('busy');
  f.notice.resume('hover'); f.tick(5000); assert.equal(f.dismissals(), 0);
  f.notice.resume('focus'); f.tick(5000); assert.equal(f.dismissals(), 0);
  f.notice.resume('busy'); f.tick(2499); assert.equal(f.dismissals(), 0);
  f.tick(1); assert.equal(f.dismissals(), 1);
});

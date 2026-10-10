import test from "node:test";
import assert from "node:assert/strict";

// Specification counterexamples, NOT a shipped synchronization implementation.
// An actual authority would supply this sequence; Chrome Sync supplies no such log.
function applyAuthorityLog(log) {
  const applied = new Set(), live = new Set();
  for (const op of log) {
    if (applied.has(op.id)) continue;
    applied.add(op.id);
    if (op.action === "add") live.add(op.entity);
    else live.delete(op.entity);
  }
  return [...live].sort();
}
const add = { id: "a:1", entity: "X", action: "add" };
const remove = { id: "b:1", entity: "X", action: "remove" };

test("individual authority-ordered operations retain independent additions and deduplicate retries", () => {
  const y = { id: "b:2", entity: "Y", action: "add" };
  assert.deepEqual(applyAuthorityLog([add, y, add, y]), ["X", "Y"]);
  assert.deepEqual(applyAuthorityLog([add, remove, add]), [], "retrying an old operation must not re-add");
  assert.deepEqual(applyAuthorityLog([remove, add]), ["X"]);
});

test("identical stored operation sets cannot reveal strict authority acceptance order", () => {
  const first = [add, remove], second = [remove, add];
  const storedKeys = log => Object.fromEntries([...log].sort((a, b) => a.id.localeCompare(b.id)).map(op => [op.id, op]));
  assert.deepEqual(storedKeys(first), storedKeys(second), "Chrome's final operation-key map can be identical");
  assert.notDeepEqual(applyAuthorityLog(first), applyAuthorityLog(second), "required final states differ");
  // A fixed ID/revision order necessarily disagrees with at least one history.
  const deterministic = log => applyAuthorityLog([...log].sort((a, b) => a.id.localeCompare(b.id)));
  assert.deepEqual(deterministic(first), deterministic(second));
});

test("reordered notifications cannot substitute for an authority log", () => {
  assert.deepEqual(applyAuthorityLog([add, remove]), []);
  assert.deepEqual(applyAuthorityLog([remove, add]), ["X"]);
});

test("shared snapshot and shard replacement can lose independent changes", () => {
  const deviceA = { sharedShard: [add] }, deviceB = { sharedShard: [{ id: "b:2", entity: "Y", action: "add" }] };
  const authority = { ...deviceA, ...deviceB };
  assert.deepEqual(applyAuthorityLog(authority.sharedShard), ["Y"]);
  assert.deepEqual(applyAuthorityLog([...deviceA.sharedShard, ...deviceB.sharedShard]), ["X", "Y"]);
});

test("partial publication cannot be treated as a complete snapshot or deletion", () => {
  const manifest = { parts: ["metadata", "membership"] };
  const available = { metadata: [add] };
  assert.equal(manifest.parts.every(key => Object.hasOwn(available, key)), false);
  assert.equal(Object.hasOwn(available, "membership"), false, "missing dependency is not empty membership intent");
});

test("forgetting deletion/deduplication history allows stale offline operations to resurrect data", () => {
  assert.deepEqual(applyAuthorityLog([add, remove, add]), []);
  assert.deepEqual(applyAuthorityLog([add]), ["X"], "after dropping the old removal and applied-ID fence, stale add looks new");
  const refollow = { ...add, id: "a:2" };
  assert.deepEqual(applyAuthorityLog([add, remove, refollow]), ["X"], "a deliberate new operation differs from retry");
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ChromiumTestSession } from "./chromium-test-session.mjs";
import { capacityFixture, compactSnapshot, usage } from "./fixtures/sync-capacity.mjs";
import { assertQuota, isPreferenceKey } from "../extension/src/repository/sync-model.js";

// Native quota checks in a NEW disposable installed-extension profile. Never
// touches normal profiles. Test-only keys are removed; product data is unchanged.
const profile = await mkdtemp(join(tmpdir(), "xivary-capacity-audit-"));
const browser = new ChromiumTestSession(profile);
try {
  const { id } = await browser.send("Extensions.loadUnpacked", { path: fileURLToPath(new URL("../extension", import.meta.url)) });
  const { sessionId } = await browser.page(`chrome-extension://${id}/src/settings/settings.html`);
  const evaluate = expression => browser.evaluate(sessionId, expression);
  await browser.until(sessionId, "document.querySelector('#open-arxiv-new-tab') && !document.querySelector('#open-arxiv-new-tab').disabled");
  await browser.until(sessionId, "chrome.storage.sync.get(null).then(values=>Object.keys(values).filter(key=>key.startsWith('xivary.sync:')).length===4)");
  const version = await browser.send("Browser.getVersion");
  const initial = await evaluate("chrome.storage.sync.get(null)");
  const results = [];
  for (const papers of [300, 500, 1000]) {
    const state = capacityFixture(papers);
    const compact = Object.fromEntries(Object.entries(compactSnapshot(state)).filter(([key]) => !isPreferenceKey(key)));
    // Normal product preflight, including existing provider data, before writing.
    assertQuota({ ...await evaluate("chrome.storage.sync.get(null)"), ...compact });
    await evaluate(`chrome.storage.sync.set(${JSON.stringify(compact)})`);
    const native = await evaluate(`chrome.storage.sync.getBytesInUse(${JSON.stringify(Object.keys(compact))})`);
    assert.equal(native, usage(compact).bytes);
    const local = { xivaryCapacityAudit: state };
    await evaluate(`chrome.storage.local.set(${JSON.stringify(local)})`);
    const localBytes = await evaluate("chrome.storage.local.getBytesInUse('xivaryCapacityAudit')");
    assert.equal(localBytes, usage(local).bytes);
    results.push({ papers, localBytes, snapshotBytes: native, snapshotItems: Object.keys(compact).length });
    await evaluate(`chrome.storage.sync.remove(${JSON.stringify(Object.keys(compact))})`);
  }
  const unicode = { "xivary.audit:clé": { text: '李明\n"\\😀' } };
  await evaluate(`chrome.storage.sync.set(${JSON.stringify(unicode)})`);
  assert.equal(await evaluate(`chrome.storage.sync.getBytesInUse(${JSON.stringify(Object.keys(unicode))})`), usage(unicode).bytes);
  await evaluate(`chrome.storage.sync.remove(${JSON.stringify(Object.keys(unicode))})`);

  // Deliberate native-provider rejection tests bypass preflight ONLY in this
  // disposable harness. Product code must never knowingly attempt these writes.
  const rejected = async values => {
    const before = await evaluate("chrome.storage.sync.get(null)");
    const error = await evaluate(`chrome.storage.sync.set(${JSON.stringify(values)}).then(()=>null,error=>error.message)`);
    assert.ok(error, "Chrome must reject the intentionally impossible fixture");
    assert.deepEqual(await evaluate("chrome.storage.sync.get(null)"), before);
    return error;
  };
  const perItem = await rejected({ "xivary.audit:oversize": "x".repeat(8192) });
  const near = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`xivary.audit:near-${i}`, "x".repeat(7000)]));
  assertQuota({ ...initial, ...near });
  await evaluate(`chrome.storage.sync.set(${JSON.stringify(near)})`);
  const nearBytes = await evaluate("chrome.storage.sync.getBytesInUse(null)");
  assert.ok(nearBytes > .9 * 102400 && nearBytes <= 102400);
  const total = await rejected({ "xivary.audit:extra": "x".repeat(7000) });
  await evaluate(`chrome.storage.sync.remove(${JSON.stringify(Object.keys(near))})`);
  const count = await rejected(Object.fromEntries(Array.from({ length: 513 }, (_, i) => [`xivary.audit:count-${i}`, false])));
  assert.deepEqual(await evaluate("chrome.storage.sync.get(null)"), initial);
  await evaluate("chrome.storage.local.remove('xivaryCapacityAudit')");
  console.log(JSON.stringify({ browser: version.product, measurements: results, nearBytes, nativeRejections: { perItem, total, count },
    warning: "Capacity verified, not a library sync implementation or account/arrival-order verification." }, null, 2));
} finally {
  await browser.close();
  await rm(profile, { recursive: true, force: true });
}

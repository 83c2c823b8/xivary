import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ChromiumTestSession, waitFor } from "./chromium-test-session.mjs";

// Optional network verification. Unlike the fixture suites, these pages and
// author queries are fetched from real arXiv; no response interception is used.
const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(join(tmpdir(), "xivary-live-arxiv-"));
const chrome = new ChromiumTestSession(profile);
const feeds = [];
try {
  const { id } = await chrome.send("Extensions.loadUnpacked", { path: join(root, "extension") });
  const authorPrefix = `chrome-extension://${id}/src/author/author.html`;
  async function createdTarget(activate, prefix) {
    const previous = new Set((await chrome.send("Target.getTargets")).targetInfos.map(target => target.targetId));
    await activate();
    return waitFor(async () => (await chrome.send("Target.getTargets")).targetInfos.find(target => !previous.has(target.targetId) && target.url.startsWith(prefix)), "native navigation target");
  }
  async function openAuthor(page, index, keyboard = false) {
    const selector = `[data-live-author="${index}"]`;
    const name = await chrome.evaluate(page.sessionId, `document.querySelector(${JSON.stringify(selector)}).textContent`);
    const target = await createdTarget(async () => {
      if (!keyboard) return chrome.click(page.sessionId, selector);
      await chrome.evaluate(page.sessionId, `document.querySelector(${JSON.stringify(selector)}).focus()`);
      for (const type of ["keyDown", "keyUp"]) await chrome.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, page.sessionId);
    }, authorPrefix);
    assert.equal(new URL(target.url).searchParams.get("name"), name);
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    await chrome.send("Runtime.enable", {}, sessionId);
    await chrome.until(sessionId, `document.querySelector('#name')?.textContent === ${JSON.stringify(name)}`);
    assert.ok(await chrome.evaluate(sessionId, "document.querySelector('#identity').textContent.includes('namesakes')"));
    assert.deepEqual(await chrome.evaluate(sessionId, "import('../repository/repository-client.js').then(({RepositoryClient})=>new RepositoryClient().listFollowing())"), []);
    await chrome.until(sessionId, "!document.querySelector('#refresh').disabled", 30000);
    const result = await chrome.evaluate(sessionId, "({rows:document.querySelectorAll('.paper-row').length,status:document.querySelector('#status').textContent})");
    feeds.push({ name, ...result });
    await chrome.send("Target.closeTarget", { targetId: target.targetId });
    console.log(`Live author PASS: ${name}, ${keyboard ? 'Enter' : 'ordinary click'}, name route, namesake disclosure, no follow; feed ${JSON.stringify(result)}`);
  }
  for (const [arxivId, count] of [["math/0307245", 1], ["2512.03554", 2], ["1706.03762", 8]]) {
    const page = await chrome.page(`https://arxiv.org/abs/${arxivId}`);
    await chrome.until(page.sessionId, `document.querySelectorAll('.authors .arxiv-library-button').length === ${count} && !document.querySelector('.arxiv-library-bookmark').disabled`, 30000);
    const links = await chrome.evaluate(page.sessionId, "[...document.querySelectorAll('.authors a[href]')].map((link,index)=>{link.dataset.liveAuthor=index; return {name:link.textContent,href:link.href};})");
    assert.equal(links.length, count);
    for (const link of links) {
      const destination = new URL(link.href);
      assert.equal(destination.origin, "https://arxiv.org");
      assert.equal(destination.searchParams.get("searchtype"), "author");
      assert.ok(destination.searchParams.get("query"));
    }
    console.log(`Live DOM: ${arxivId} ${JSON.stringify(links)}`);
    await openAuthor(page, 0);
    if (count > 1) await openAuthor(page, count - 1, true);
    for (const activation of [{ modifiers: 2 }, { button: "middle" }]) {
      const target = await createdTarget(() => chrome.click(page.sessionId, '[data-live-author="0"]', activation), "https://arxiv.org/search/");
      assert.equal(target.url, links[0].href);
      await chrome.send("Target.closeTarget", { targetId: target.targetId });
    }
    assert.deepEqual(await chrome.evaluate(page.sessionId, "[...document.querySelectorAll('.authors a[href]')].map(a=>({name:a.textContent,href:a.href}))"), links);
    // The real abstract's subject-browse link must navigate arXiv in-place.
    const browseHref = await chrome.evaluate(page.sessionId, "document.querySelector('.browse a[href]').href");
    assert.ok(browseHref.startsWith("https://arxiv.org/"));
    await chrome.click(page.sessionId, ".browse a[href]");
    await chrome.until(page.sessionId, `location.href === ${JSON.stringify(browseHref)}`);
    await chrome.send("Target.closeTarget", { targetId: page.targetId });
  }
  if (feeds.some(feed => feed.status)) {
    console.log("LIVE ARXIV NAVIGATION PASS; LIVE PAPER RETRIEVAL NOT VERIFIED for failed queries (external API response above)");
  } else {
    assert.ok(feeds.every(feed => feed.rows > 0));
    console.log("LIVE ARXIV PASS: three real abstract pages, full names/archive queries, independent authors, primary/Enter/native Ctrl/middle and unrelated navigation; live name-matched paper rows");
  }
} finally {
  await chrome.close();
  await rm(profile, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChromiumTestSession, waitFor } from "./chromium-test-session.mjs";

export async function polishSmoke() {
  const profile = await mkdtemp(join(tmpdir(), "xivary-polish-"));
  const chrome = new ChromiumTestSession(profile);
  const root = new URL("../", import.meta.url);
  const abstract = await readFile(new URL("tests/fixtures/arxiv-abstract.html", root), "utf8");
  const search = await readFile(new URL("tests/fixtures/arxiv-search.html", root), "utf8");
  const emptyFeed = '<feed xmlns="http://www.w3.org/2005/Atom"></feed>';
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/2401.00001</id><title>Polish paper</title><summary>Preserve this abstract.</summary><published>2026-10-01T00:00:00Z</published><author><name>Alex Kim</name></author><category term="math.AG"/></entry></feed>';
  let hold = true, pending = [], response = atom, requests = 0;
  const errors = [];
  async function fulfill(session, params, body) {
    await chrome.send("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: params.request.url.includes("export.arxiv.org") ? "application/atom+xml" : "text/html" }],
      body: Buffer.from(body).toString("base64") }, session);
  }
  chrome.listeners.push(message => {
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params);
    if (message.method !== "Fetch.requestPaused") return;
    const params = message.params, session = message.sessionId;
    if (params.request.url.includes("export.arxiv.org")) {
      requests++;
      if (hold) { pending.push([session, params]); return; }
      void fulfill(session, params, response).catch(error => errors.push(error.message));
    } else void fulfill(session, params, params.resourceType === "Document" ? params.request.url.includes("/search/") ? search : abstract : "").catch(error => errors.push(error.message));
  });
  try {
    const { id } = await chrome.send("Extensions.loadUnpacked", { path: new URL("extension", root).pathname });
    const url = path => `chrome-extension://${id}/src/${path}`;
    const page = async destination => { const result = await chrome.page(); await chrome.send("Fetch.enable", { patterns: [{ urlPattern: "https://*" }] }, result.sessionId); await chrome.send("Page.navigate", { url: destination }, result.sessionId); return result.sessionId; };
    const rpc = (session, operation) => chrome.evaluate(session, `(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');return ${operation.replaceAll("repo.", "new RepositoryClient().")}})()`);
    const author = await page(url("author/author.html?name=Alex%20Kim"));
    await chrome.until(author, "document.querySelector('#name').textContent==='Alex Kim' && !document.querySelector('#follow-author').disabled");
    await waitFor(() => pending.length > 0, "first API request paused");
    await chrome.evaluate(author, "window.dispatchEvent(new Event('focus'));document.querySelector('#refresh').click()");
    await chrome.until(author, "document.querySelector('#status').textContent.includes('Loading')");
    assert.equal(await chrome.evaluate(author, "document.querySelector('#empty').hidden"), true);
    assert.equal(requests, 1, "focus/refresh do not duplicate the in-flight request");
    hold = false; for (const [session, params] of pending.splice(0)) await fulfill(session, params, atom);
    await chrome.until(author, "document.querySelectorAll('.paper-row').length===1 && !document.querySelector('#refresh').disabled");
    assert.deepEqual(await rpc(author, "repo.listFollowing()"), []);
    await chrome.evaluate(author, "document.querySelector('#follow-author').click();document.querySelector('#follow-author').click()");
    await chrome.until(author, "document.querySelector('#follow-author').textContent==='Unfollow' && !document.querySelector('#follow-author').disabled");
    assert.equal((await rpc(author, "repo.listFollowing()")).length, 1);
    const original = await rpc(author, "repo.getAuthorLibrary()");
    await chrome.click(author, "#follow-author");
    await chrome.until(author, "document.querySelector('#follow-author').textContent==='Follow' && document.querySelector('.xivary-undo button')");
    // One simulated rejected RPC verifies the toast's retry path; Node tests
    // separately exercise actual repository write failure and durable state.
    await chrome.evaluate(author, `(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      let failed = false;
      chrome.runtime.sendMessage = message => {
        if (message.method === 'undoRemoval' && !failed) {
          failed = true; return Promise.resolve({ok:false,error:'Temporary storage failure'});
        }
        return original(message);
      };
    })()`);
    await chrome.click(author, ".xivary-undo button");
    await chrome.until(author, "document.querySelector('.xivary-undo').textContent.includes('Temporary storage failure') && !document.querySelector('.xivary-undo button').disabled");
    assert.deepEqual(await rpc(author, "repo.listFollowing()"), []);
    await chrome.click(author, ".xivary-undo button");
    await chrome.until(author, "document.querySelector('#follow-author').textContent==='Unfollow' && !document.querySelector('.xivary-undo')");
    assert.deepEqual((await rpc(author, "repo.getAuthorLibrary()")).memberships, original.memberships);
    await chrome.send("Page.reload", {}, author);
    await chrome.until(author, "document.querySelector('#follow-author').textContent==='Unfollow'");
    // Unexpected HTTP-200 HTML is an error, never a genuine empty feed/cache.
    response = '<html><body>Temporarily unavailable</body></html>';
    await chrome.click(author, "#refresh");
    await chrome.until(author, "document.querySelector('#status').textContent.includes('unexpected response')");
    assert.equal(await chrome.evaluate(author, "document.querySelector('#empty').hidden && document.querySelectorAll('.paper-row').length===1"), true);
    assert.equal((await rpc(author, "repo.getAuthorPaperCache('arxiv-author:name:v1:alex%20kim')")).papers.length, 1);
    response = emptyFeed; await chrome.click(author, "#refresh");
    await chrome.until(author, "!document.querySelector('#empty').hidden && !document.querySelector('#status').textContent");
    response = atom;
    // Both Collection sidebars: keyboard, outside click, empty name, duplicate submission and confirmation.
    const settings = await page(url("settings/settings.html"));
    await chrome.until(settings, "document.readyState==='complete' && document.querySelector('#open-author-new-tab').checked && !document.querySelector('#open-author-new-tab').disabled");
    assert.equal(await chrome.evaluate(settings, "document.querySelector('#open-author-new-tab').checked"), true);
    await chrome.click(settings, "#organize-author-collections + .toggle");
    await chrome.until(settings, "document.querySelector('#organize-author-collections').checked && !document.querySelector('#organize-author-collections').disabled");
    const library = await page(url("library/library.html"));
    const following = await page(url("authors/authors.html"));
    for (const [session, category] of [[library, "Paper"], [following, "Author"]]) {
      await chrome.until(session, "document.querySelector('#show-create') && !document.querySelector('#show-create').disabled");
      const snapshot = () => rpc(session, `repo.get${category}Library()`);
      const before = await snapshot();
      await chrome.click(session, "#show-create");
      assert.equal(await chrome.evaluate(session, "document.activeElement.id==='collection-name'"), true);
      await chrome.evaluate(session, "document.querySelector('#collection-name').value='cancel typed name'");
      await chrome.click(session, "h1");
      assert.equal(await chrome.evaluate(session, "document.querySelector('#create-form').hidden"), true);
      await chrome.click(session, "#show-create");
      await chrome.evaluate(session, "document.querySelector('#collection-name').value='  '");
      await chrome.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13 }, session);
      await chrome.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 }, session);
      assert.equal(await chrome.evaluate(session, "document.querySelector('#create-form').hidden"), true);
      assert.deepEqual((await snapshot()).collections, before.collections);
      await chrome.click(session, "#show-create");
      await chrome.evaluate(session, "document.querySelector('#collection-name').value='Polish collection';document.querySelector('#create-form').requestSubmit();document.querySelector('#create-form').requestSubmit()");
      await chrome.until(session, "document.querySelector('#create-form').hidden && !document.querySelector('#show-create').disabled");
      const created = (await snapshot()).collections.filter(item => item.name === "Polish collection"); assert.equal(created.length, 1);
      const action = `[data-collection-id=${JSON.stringify(created[0].id)}] + .collection-actions [data-action=delete]`;
      await chrome.click(session, action); await chrome.click(session, ".collection-delete-dialog button");
      assert.deepEqual((await snapshot()).collections.length, before.collections.length + 1);
      await chrome.click(session, action);
      await chrome.evaluate(session, "document.querySelector('[data-confirm-id]').click();document.querySelector('[data-confirm-id]').click()");
      await chrome.until(session, "!document.querySelector('.collection-delete-dialog')");
      assert.deepEqual((await snapshot()).collections, before.collections);
    }
    // Paper picker removal and Undo retain full canonical metadata/memberships.
    await chrome.send("Page.navigate", { url: url("author/author.html?name=Alex%20Kim") }, author);
    await chrome.until(author, "document.querySelector('#name').textContent==='Alex Kim' && !document.querySelector('#refresh').disabled");
    await chrome.click(author, "#refresh");
    await chrome.until(author, "document.querySelector('.paper-row') && !document.querySelector('#refresh').disabled");
    await chrome.click(author, ".bookmark");
    await chrome.until(author, "document.querySelector('.bookmark').getAttribute('aria-pressed')==='true'");
    const savedBefore = await rpc(author, "repo.getPaperLibrary()");
    await chrome.click(author, ".bookmark");
    await chrome.until(author, "document.querySelector('.arxiv-collection-picker input[type=checkbox]:checked')");
    await chrome.click(author, ".arxiv-collection-picker input[type=checkbox]:checked");
    await chrome.until(author, "document.querySelector('.xivary-undo button') && document.querySelector('.bookmark').getAttribute('aria-pressed')==='false'");
    await chrome.click(author, ".xivary-undo button");
    await chrome.until(author, "!document.querySelector('.xivary-undo') && document.querySelector('.bookmark').getAttribute('aria-pressed')==='true'");
    const restored = await rpc(author, "repo.getPaperLibrary()");
    assert.deepEqual(restored.papers, savedBefore.papers); assert.deepEqual(restored.memberships, savedBefore.memberships);
    // Expiration is observed in native UI, not by fast-forwarding a browser timer.
    await chrome.evaluate(author, "document.querySelector('.collection-picker-heading button')?.click()");
    await chrome.click(author, "#follow-author");
    await chrome.until(author, "document.querySelector('.xivary-undo')");
    await chrome.until(author, "!document.querySelector('.xivary-undo')", 10000);
    assert.deepEqual(await rpc(author, "repo.listFollowing()"), []);
    // Default creates a native extension tab; unchanged underlying link survives Ctrl/middle.
    const abstractPage = await page("https://arxiv.org/abs/2401.00001");
    await chrome.until(abstractPage, "document.querySelector('.arxiv-library-bookmark') && !document.querySelector('.arxiv-library-bookmark').disabled");
    async function newTarget(action) {
      const before = new Set((await chrome.send("Target.getTargets")).targetInfos.map(item => item.targetId)); await action();
      return waitFor(async () => (await chrome.send("Target.getTargets")).targetInfos.find(item => item.type === "page" && !before.has(item.targetId)), "native new target");
    }
    const opened = await newTarget(() => chrome.click(abstractPage, ".authors a"));
    assert.equal(new URL(opened.url).searchParams.get("name"), "Alex Kim"); await chrome.send("Target.closeTarget", { targetId: opened.targetId });
    await chrome.click(settings, "#open-author-new-tab + .toggle");
    await chrome.until(settings, "!document.querySelector('#open-author-new-tab').checked && !document.querySelector('#open-author-new-tab').disabled");
    await chrome.click(abstractPage, ".authors a");
    await chrome.until(abstractPage, "location.protocol==='chrome-extension:' && document.querySelector('#name')?.textContent==='Alex Kim'");
    const searchPage = await page("https://arxiv.org/search/?query=Yuya+Nakamura&searchtype=author");
    await chrome.until(searchPage, "document.querySelectorAll('p.authors a').length>3");
    const nameSelector = "li.arxiv-result:nth-child(2) p.authors a";
    const href = await chrome.evaluate(searchPage, `document.querySelector(${JSON.stringify(nameSelector)}).href`);
    for (const options of [{ modifiers: 2 }, { button: "middle" }]) {
      const target = await newTarget(() => chrome.click(searchPage, nameSelector, options));
      assert.equal(target.url, href); await chrome.send("Target.closeTarget", { targetId: target.targetId });
    }
    // Dynamically added result: delegated recognition needs neither listener copies nor observers.
    await chrome.evaluate(searchPage, "document.querySelector('ol').append(document.querySelectorAll('li.arxiv-result')[1].cloneNode(true));document.querySelector('li.arxiv-result:last-child p.authors a').focus()");
    await chrome.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13 }, searchPage);
    await chrome.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 }, searchPage);
    await chrome.until(searchPage, "location.protocol==='chrome-extension:' && document.querySelector('#name')?.textContent==='Yuya Nakamura'");
    assert.deepEqual(errors, []);
    console.log("POLISH SMOKE PASS: author Follow/Unfollow/Undo/reload, delayed/invalid/empty API states, both Collection forms/dialogs, paper metadata Undo and eight-second expiry, default new-tab/current-tab, real search fixture/dynamic authors, native Ctrl/middle/Enter");
  } finally { await chrome.close(); await rm(profile, { recursive: true, force: true }); }
}
if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) await polishSmoke();

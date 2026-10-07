import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { authorFromAbstractLink, shouldOpenAuthorInXivary } from "../extension/src/content/author-link.js";
import { authorResultsUrl, resolveAuthorRoute } from "../extension/src/author/author-route.js";
import { stableAuthorKey } from "../extension/src/domain/author.js";
import { buildAuthorQuery } from "../extension/src/services/arxiv-paper-service.js";
import { AUTHOR_NAVIGATION_CHANNEL, createAuthorNavigationHandler } from "../extension/src/background/author-navigation.js";

function link(name, href, authorContainer = true) {
  return {
    textContent: name,
    matches: selector => selector === ".authors a[href]" && authorContainer,
    getAttribute: key => key === "href" ? href : null,
  };
}

test("real abstract fixtures expose independent author-search links", async () => {
  const files = ["arxiv-nakago-takahashi.html", "arxiv-abstract.html"];
  for (const file of files) {
    const html = await readFile(new URL(`./fixtures/${file}`, import.meta.url), "utf8");
    const authorLine = html.match(/<div class="authors">([\s\S]*?)<\/div>/)[1];
    const anchors = [...authorLine.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
    assert.equal(anchors.length, 2);
    const references = anchors.map(([, href, name]) => authorFromAbstractLink(link(name, href.replaceAll("&amp;", "&")), "https://arxiv.org/abs/2512.03554"));
    if (file.includes("nakago")) {
      assert.deepEqual(references.map(item => item.name), ["Atsuki Nakago", "Atsushi Takahashi"]);
      assert.notEqual(references[0].authorId, references[1].authorId);
    } else assert.deepEqual(references.map(item => item.name), ["Alex Kim", "Renée Smith"]);
  }
});

test("recognition is narrow, validates input, and preserves Unicode names", () => {
  const page = "https://arxiv.org/abs/2512.03554";
  const reference = authorFromAbstractLink(link(" Renée  O’Neill ", "/search/math?searchtype=author&query=O%27Neill%2C+R"), page);
  assert.equal(reference.name, "Renée O’Neill");
  assert.equal(reference.authorId, stableAuthorKey("Renée O’Neill"));
  for (const item of [
    link("Name", "/pdf/2512.03554"),
    link("Name", "/search/?query=Name&searchtype=all"),
    link("Name", "https://evil.example/search/?searchtype=author&query=Name"),
    link("Name", "/search/?searchtype=author"),
    link("Name", "/search/?searchtype=author&query=Name", false),
    link("\u0001Name", "/search/?searchtype=author&query=Name"),
  ]) assert.equal(authorFromAbstractLink(item, page), null);
  assert.equal(authorFromAbstractLink(link("Name", "/search/?query=Name&searchtype=author"), "https://arxiv.org/list/math.AG/recent"), null);
});

test("only unmodified primary click is intercepted; keyboard anchor click qualifies", () => {
  const event = { type: "click", button: 0, defaultPrevented: false, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
  assert.equal(shouldOpenAuthorInXivary(event), true);
  for (const key of ["ctrlKey", "metaKey", "shiftKey", "altKey", "defaultPrevented"]) assert.equal(shouldOpenAuthorInXivary({ ...event, [key]: true }), false);
  assert.equal(shouldOpenAuthorInXivary({ ...event, button: 1 }), false);
  assert.equal(shouldOpenAuthorInXivary({ ...event, type: "auxclick" }), false);
  assert.equal(shouldOpenAuthorInXivary({ ...event, button: 0, detail: 0 }), true);
});

test("direct author route reuses name key, query and followed record without following", () => {
  const runtime = { getURL: path => `chrome-extension://test/${path}` };
  const url = authorResultsUrl("Alex Kim", runtime);
  assert.equal(new URL(url).pathname, "/src/author/author.html");
  const empty = { authors: [] };
  const external = resolveAuthorRoute(new URL(url).search, empty);
  assert.equal(external.author.id, stableAuthorKey("Alex Kim"));
  assert.equal(buildAuthorQuery(external.author), 'au:"Alex Kim"');
  assert.deepEqual(empty.authors, []);
  const followed = { id: stableAuthorKey("Alex Kim"), displayName: "Alex Kim" };
  assert.equal(resolveAuthorRoute(`?authorId=${encodeURIComponent(followed.id)}`, { authors: [followed] }).author, followed);
  assert.equal(resolveAuthorRoute(new URL(url).search, { authors: [followed] }).author, followed);
  assert.throws(() => resolveAuthorRoute("?name=%00", empty));
  assert.throws(() => resolveAuthorRoute("?authorId=missing", empty));
});

test("both primary library pages link accessibly to the one Settings page", async () => {
  for (const page of ["library/library.html", "authors/authors.html"]) {
    const html = await readFile(new URL(`../extension/src/${page}`, import.meta.url), "utf8");
    assert.match(html, /class="settings-link" href="\.\.\/settings\/settings\.html" aria-label="Settings" title="Settings"/);
    assert.equal((html.match(/class="settings-link"/g) ?? []).length, 1);
  }
});

test("background opens the existing author page and rejects invalid navigation", async () => {
  const opened = [];
  const api = { runtime: { id: "extension-test", getURL: path => `chrome-extension://extension-test/${path}` }, tabs: { create: async value => { opened.push(value); } } };
  const handler = createAuthorNavigationHandler(api);
  const sender = { id: "extension-test", url: "https://arxiv.org/abs/2512.03554" };
  const request = (message, from = sender) => new Promise(resolve => {
    const active = handler(message, from, resolve);
    if (!active && message.channel !== AUTHOR_NAVIGATION_CHANNEL) resolve(null);
  });
  assert.deepEqual(await request({ channel: AUTHOR_NAVIGATION_CHANNEL, name: "Alex Kim" }), { ok: true });
  assert.equal(opened.length, 1);
  assert.equal(new URL(opened[0].url).searchParams.get("name"), "Alex Kim");
  assert.deepEqual(await request({ channel: AUTHOR_NAVIGATION_CHANNEL, name: "\u0000" }), { ok: false });
  assert.deepEqual(await request({ channel: AUTHOR_NAVIGATION_CHANNEL, name: "Alex Kim" }, { ...sender, url: "https://arxiv.org/search/" }), { ok: false });
  assert.equal(opened.length, 1);
});

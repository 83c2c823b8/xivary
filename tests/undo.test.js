import test from "node:test";
import assert from "node:assert/strict";
import { LocalRepository } from "../extension/src/repository/local-repository.js";
import { RepositoryClient } from "../extension/src/repository/repository-client.js";
import { createRepositoryHandler } from "../extension/src/background/repository-handler.js";
const paper = { arxivId: "2401.00001", title: "Keep metadata", authors: ["Alex Kim"], abstract: "private", note: "note", read: true };
const author = { displayName: "Alex Kim" };
function fixture() {
  let disk, time = 0, fail = false;
  const storage = { read: async () => structuredClone(disk), write: async state => { if (fail) throw new Error("disk failed"); disk = structuredClone(state); } };
  const repo = new LocalRepository(storage, () => "2026-10-09T00:00:00Z"); repo.undoNow = () => time;
  const handler = createRepositoryHandler(repo, "test");
  const client = new RepositoryClient({ sendMessage: message => new Promise(resolve => handler(message, { id: "test" }, resolve)) });
  return { repo, client, storage, advance: () => { time += 8000; }, fail: value => { fail = value; } };
}
for (const kind of ["paper", "author"]) {
  test(`${kind} removal receipt restores exact metadata/memberships through RPC without unrelated state`, async () => {
    const { client, storage } = fixture();
    const isPaper = kind === "paper";
    const entity = isPaper ? await client.savePaper(paper) : await client.followAuthor(author);
    const id = isPaper ? entity.arxivId : entity.id;
    const extra = isPaper ? await client.createPaperCollection("Second", paper) : await client.createAuthorCollection("Second", author);
    const before = await storage.read();
    const receipt = isPaper ? await client.removeFavorite(id) : await client.unfollowAuthor(id);
    await client.setOpenAuthorResultsInNewTab(false);
    if (isPaper) await client.followAuthor({ displayName: "Other Author" });
    else await client.savePaper({ ...paper, arxivId: "2401.00002" });
    await client.undoRemoval(receipt.undoToken);
    const after = await storage.read();
    const records = isPaper ? "favorites" : "authors", memberships = isPaper ? "paperMemberships" : "memberships";
    assert.deepEqual(after[records], before[records]); assert.deepEqual(after[memberships], before[memberships]);
    assert.equal(after.settings.openAuthorResultsInNewTab, false);
    assert.equal((isPaper ? after.memberships : after.paperMemberships).length, 1);
    assert.equal(extra.name, "Second");
    await assert.rejects(client.undoRemoval(receipt.undoToken), /expired/);
  });
  test(`${kind} collection receipt does not undo newer assignments or ABA changes`, async () => {
    const { client } = fixture(); const isPaper = kind === "paper";
    const entity = isPaper ? await client.savePaper(paper) : await client.followAuthor(author);
    const id = isPaper ? entity.arxivId : entity.id;
    const extra = isPaper ? await client.createPaperCollection("Second", paper) : await client.createAuthorCollection("Second", author);
    const receipt = isPaper ? await client.removePaperFromCollection(id, extra.id) : await client.removeAuthorFromCollection(id, extra.id);
    if (isPaper) { await client.addPaperToCollection(paper, extra.id); await client.removePaperFromCollection(id, extra.id); }
    else { await client.addAuthorToCollection(author, extra.id); await client.removeAuthorFromCollection(id, extra.id); }
    await assert.rejects(client.undoRemoval(receipt.undoToken), /changed/);
  });
}
test("independent removals undo in either order; expiry/restart cannot restore", async () => {
  const { client, repo, storage, advance } = fixture();
  await client.savePaper(paper); const a = await client.removeFavorite(paper.arxivId);
  const other = { ...paper, arxivId: "2401.00002" };
  await client.savePaper(other); const b = await client.removeFavorite(other.arxivId);
  await client.undoRemoval(a.undoToken); await client.undoRemoval(b.undoToken);
  assert.equal((await client.listFavorites()).length, 2);
  const expired = await client.removeFavorite(paper.arxivId); advance();
  await assert.rejects(repo.undoRemoval(expired.undoToken), /expired/);
  const restart = new LocalRepository(storage);
  await assert.rejects(restart.undoRemoval(b.undoToken), /expired/);
});
test("deleted collections cannot be resurrected and failed writes retain retryable receipt", async () => {
  const { client, storage, fail } = fixture();
  await client.savePaper(paper); const before = await storage.read();
  const receipt = await client.removeFavorite(paper.arxivId);
  fail(true); await assert.rejects(client.undoRemoval(receipt.undoToken), /disk failed/); fail(false);
  await client.undoRemoval(receipt.undoToken); assert.deepEqual((await storage.read()).favorites, before.favorites);
  const second = await client.removeFavorite(paper.arxivId);
  await client.deletePaperCollection(before.paperCollections[0].id);
  await assert.rejects(client.undoRemoval(second.undoToken), /changed/);
  assert.deepEqual(await client.listFavorites(), []);
});
test("removal write failure exposes no receipt and leaves original records intact", async () => {
  const { client, storage, fail } = fixture(); await client.savePaper(paper); const before = await storage.read();
  fail(true); await assert.rejects(client.removeFavorite(paper.arxivId), /disk failed/); fail(false);
  assert.deepEqual(await storage.read(), before);
});

test("one membership Undo preserves its timestamps and other memberships; concurrent Undo applies once", async () => {
  const { client, storage } = fixture();
  await client.savePaper(paper); const group = await client.createPaperCollection("Second", paper);
  const before = await storage.read();
  const receipt = await client.removePaperFromCollection(paper.arxivId, group.id);
  assert.equal((await client.getPaperLibrary()).memberships.length, 1);
  const results = await Promise.allSettled([client.undoRemoval(receipt.undoToken), client.undoRemoval(receipt.undoToken)]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  const after = await storage.read(); assert.deepEqual(after.favorites, before.favorites); assert.deepEqual(after.paperMemberships, before.paperMemberships);
});

test("deleting and reimporting a classification cannot revive a stale receipt", async () => {
  const { client } = fixture(); await client.savePaper(paper);
  const receipt = await client.removeFavorite(paper.arxivId);
  // Reimport just the empty classification, leaving the removed entity absent.
  const file = await client.exportCategory("bookmarks");
  await client.deletePaperCollection(file.paperCollections[0].id);
  await client.importCategory(JSON.stringify(file), "bookmarks");
  await assert.rejects(client.undoRemoval(receipt.undoToken), /changed/);
});

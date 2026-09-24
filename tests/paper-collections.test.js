import test from "node:test";
import assert from "node:assert/strict";
import { LocalRepository } from "../extension/src/repository/local-repository.js";
import { createPaper } from "../extension/src/domain/paper.js";
import { RepositoryClient } from "../extension/src/repository/repository-client.js";
import { createRepositoryHandler } from "../extension/src/background/repository-handler.js";

const now = "2026-09-24T01:02:03.000Z";
const paperA = { arxivId: "2401.00001", title: "Paper A", authors: ["Alex Kim"] };
const paperB = { arxivId: "2401.00002", title: "Paper B", authors: ["Renée Smith"] };

function fixture(initial) {
  let state = structuredClone(initial);
  let writes = 0;
  let serial = 0;
  const storage = {
    read: async () => structuredClone(state),
    write: async value => { state = structuredClone(value); writes++; },
  };
  return { storage, repository: new LocalRepository(storage, () => now, () => String(++serial)), writes: () => writes };
}

function schema4(favorites = []) {
  return {
    schemaVersion: 4,
    favorites: favorites.map(item => createPaper(item, now)),
    authors: [], collections: [], memberships: [], authorPaperCaches: [],
    settings: { lastUsedAuthorCollectionId: null },
    retained: "yes",
  };
}

test("schema 4 favorites migrate losslessly and idempotently to Saved Papers", async () => {
  const original = schema4([paperA, paperB]);
  original.favorites[0].note = "Preserve me";
  const { repository, storage, writes } = fixture(original);
  const library = await repository.getPaperLibrary();
  assert.equal(library.collections.length, 1);
  assert.equal(library.collections[0].name, "Saved Papers");
  assert.deepEqual(library.papers, original.favorites);
  assert.deepEqual(new Set(library.memberships.map(item => item.arxivId)), new Set(["2401.00001", "2401.00002"]));
  assert.ok(library.memberships.every(item => item.collectionId === library.collections[0].id));
  const migrated = await storage.read();
  assert.equal(migrated.schemaVersion, 5);
  assert.equal(migrated.retained, "yes");
  assert.equal(writes(), 1);
  await repository.listFavorites();
  await new LocalRepository(storage).getPaperLibrary();
  assert.equal(writes(), 1);
});

test("new libraries provide a default paper collection and save there in one click", async () => {
  const { repository } = fixture();
  const initial = await repository.getPaperLibrary();
  assert.equal(initial.collections[0].name, "Saved Papers");
  await repository.savePaper(paperA);
  const library = await repository.getPaperLibrary();
  assert.equal(library.papers.length, 1);
  assert.equal(library.memberships[0].collectionId, library.collections[0].id);
  assert.equal(library.settings.lastUsedPaperCollectionId, library.collections[0].id);
});

test("paper collections use stable IDs across rename and reject invalid duplicates", async () => {
  const { repository } = fixture();
  const collection = await repository.createPaperCollection("  Important  ", paperA);
  const before = (await repository.getPaperLibrary()).memberships;
  const renamed = await repository.renamePaperCollection(collection.id, "To Read");
  assert.equal(renamed.id, collection.id);
  assert.deepEqual((await repository.getPaperLibrary()).memberships, before);
  await assert.rejects(repository.createPaperCollection(" to read "), /already exists/);
  await assert.rejects(repository.createPaperCollection(" "), /required/);
});

test("many-to-many memberships retain save state until the final membership is removed", async () => {
  const { repository } = fixture();
  await repository.savePaper(paperA);
  const defaultCollection = (await repository.getPaperLibrary()).collections[0];
  const important = await repository.createPaperCollection("Important", paperA);
  assert.equal((await repository.listFavorites()).length, 1);
  assert.equal((await repository.getPaperLibrary()).memberships.length, 2);
  await repository.removePaperFromCollection(paperA.arxivId, defaultCollection.id);
  assert.equal((await repository.listFavorites()).length, 1);
  await repository.removePaperFromCollection(paperA.arxivId, important.id);
  assert.deepEqual(await repository.listFavorites(), []);
  assert.deepEqual((await repository.getPaperLibrary()).memberships, []);
});

test("deleting a collection removes only its memberships and repairs last-used", async () => {
  const { repository } = fixture();
  await repository.savePaper(paperA);
  const defaultCollection = (await repository.getPaperLibrary()).collections[0];
  const secondary = await repository.createPaperCollection("Reading", paperA);
  await repository.deletePaperCollection(secondary.id);
  assert.equal((await repository.listFavorites()).length, 1);
  assert.equal((await repository.getPaperLibrary()).settings.lastUsedPaperCollectionId, defaultCollection.id);
  await repository.deletePaperCollection(defaultCollection.id);
  assert.deepEqual(await repository.listFavorites(), []);
  await repository.savePaper(paperB);
  const recreated = await repository.getPaperLibrary();
  assert.equal(recreated.collections[0].name, "Saved Papers");
  assert.equal(recreated.memberships[0].collectionId, recreated.collections[0].id);
});

test("last-used paper collection is independent and drives the next new save", async () => {
  const { repository } = fixture();
  const authorCollection = await repository.createAuthorCollection("Geometers", { displayName: "Alex Kim" });
  const reading = await repository.createPaperCollection("Reading");
  await repository.savePaper(paperB);
  const papers = await repository.getPaperLibrary();
  const authors = await repository.getAuthorLibrary();
  assert.equal(papers.memberships[0].collectionId, reading.id);
  assert.equal(papers.settings.lastUsedPaperCollectionId, reading.id);
  assert.equal(authors.settings.lastUsedAuthorCollectionId, authorCollection.id);
  assert.equal((await repository.listFollowing()).length, 1);
});

test("unique saved-paper counts and membership state are shared through the message contract", async () => {
  const { repository } = fixture();
  const handler = createRepositoryHandler(repository, "extension");
  const client = new RepositoryClient({ sendMessage: message => new Promise(resolve => handler(message, { id: "extension" }, resolve)) });
  await client.savePaper(paperA);
  const collection = await client.createPaperCollection("Mirror Symmetry", paperA);
  assert.equal((await client.listFavorites()).length, 1);
  assert.equal((await client.getPaperLibrary()).memberships.length, 2);
  await client.removePaperFromCollection(paperA.arxivId, collection.id);
  assert.equal((await client.listFavorites()).length, 1);
  await client.renamePaperCollection(collection.id, "Renamed");
  await client.deletePaperCollection(collection.id);
});

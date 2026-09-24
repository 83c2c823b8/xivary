import test from "node:test";
import assert from "node:assert/strict";
import { LocalRepository } from "../extension/src/repository/local-repository.js";
import { createAuthor } from "../extension/src/domain/author.js";
import { createPaper } from "../extension/src/domain/paper.js";
import { RepositoryClient } from "../extension/src/repository/repository-client.js";
import { createRepositoryHandler } from "../extension/src/background/repository-handler.js";

const now = "2026-09-24T01:02:03.000Z";
const alex = { displayName: "Alex Kim" };
const renee = { displayName: "Renée Smith" };
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

test("first follow creates Following; repeat follow is idempotent", async () => {
  const { repository } = fixture();
  const author = await repository.followAuthor(alex);
  await repository.followAuthor(alex);
  const library = await repository.getAuthorLibrary();
  assert.equal(library.collections.length, 1);
  assert.equal(library.collections[0].name, "Following");
  assert.equal(library.memberships.length, 1);
  assert.equal(library.memberships[0].authorId, author.id);
  assert.equal(library.settings.lastUsedAuthorCollectionId, library.collections[0].id);
});

test("schema 2 follows migrate to Following once, preserving author and favorite records", async () => {
  const authors = [createAuthor(alex, now), createAuthor(renee, now)];
  const favorites = [createPaper({ arxivId: "2401.00001", title: "A paper", authors: ["Alex Kim"] }, now)];
  favorites[0].note = "Keep this";
  const { repository, storage, writes } = fixture({ schemaVersion: 2, favorites, following: authors });
  const library = await repository.getAuthorLibrary();
  assert.deepEqual(library.authors, authors);
  assert.equal(library.collections[0].name, "Following");
  assert.deepEqual(library.memberships, authors.map(author => ({ authorId: author.id, collectionId: library.collections[0].id, addedAt: now, updatedAt: now })));
  assert.deepEqual((await storage.read()).favorites, favorites);
  assert.equal((await storage.read()).schemaVersion, 5);
  await repository.listFollowing();
  await new LocalRepository(storage).getAuthorLibrary();
  assert.equal(writes(), 1);
});

test("new follows use the last explicitly created or added collection", async () => {
  const { repository } = fixture();
  const a = await repository.createAuthorCollection("Mirror Symmetry");
  const b = await repository.createAuthorCollection("People to Watch");
  const author = await repository.followAuthor(alex);
  assert.equal((await repository.getAuthorLibrary()).memberships[0].collectionId, b.id);
  await repository.addAuthorToCollection(alex, a.id);
  await repository.addAuthorToCollection(alex, a.id); // no duplicate membership
  const other = await repository.followAuthor(renee);
  const library = await repository.getAuthorLibrary();
  assert.equal(library.memberships.filter(item => item.authorId === author.id).length, 2);
  assert.equal(library.memberships.find(item => item.authorId === other.id).collectionId, a.id);
  assert.equal(library.settings.lastUsedAuthorCollectionId, a.id);
});

test("removing one of multiple memberships retains follow; removing all unfollows but keeps Author", async () => {
  const { repository } = fixture();
  const a = await repository.createAuthorCollection("A", alex);
  const b = await repository.createAuthorCollection("B", alex);
  const id = createAuthor(alex, now).id;
  await repository.removeAuthorFromCollection(id, a.id);
  assert.equal((await repository.listFollowing()).length, 1);
  assert.equal((await repository.getAuthorLibrary()).settings.lastUsedAuthorCollectionId, b.id);
  await repository.removeAuthorFromCollection(id, b.id);
  await repository.removeAuthorFromCollection(id, b.id);
  assert.deepEqual(await repository.listFollowing(), []);
  assert.equal((await repository.getAuthorLibrary()).authors.length, 1);
  await repository.followAuthor(alex);
  assert.equal((await repository.getAuthorLibrary()).authors.length, 1);
});

test("rename changes no IDs or memberships; deletion retains entities and repairs last-used", async () => {
  const { repository } = fixture();
  const a = await repository.createAuthorCollection("A", alex);
  const b = await repository.createAuthorCollection("B", alex);
  const before = await repository.getAuthorLibrary();
  const renamed = await repository.renameAuthorCollection(b.id, "Representation Theory");
  assert.equal(renamed.id, b.id);
  assert.deepEqual((await repository.getAuthorLibrary()).memberships, before.memberships);
  await repository.deleteAuthorCollection(b.id);
  assert.equal((await repository.listFollowing()).length, 1);
  assert.equal((await repository.getAuthorLibrary()).settings.lastUsedAuthorCollectionId, a.id);
  await repository.deleteAuthorCollection(a.id);
  const after = await repository.getAuthorLibrary();
  assert.deepEqual(after.authors, before.authors);
  assert.deepEqual(after.memberships, []);
  assert.deepEqual(await repository.listFollowing(), []);
  assert.equal(after.settings.lastUsedAuthorCollectionId, null);
  await repository.followAuthor(renee);
  assert.equal((await repository.getAuthorLibrary()).collections[0].name, "Following");
});

test("same author on different papers has the same memberships; other authors are independent", async () => {
  const { repository } = fixture();
  const a = createPaper({ arxivId: "2401.00001", title: "A", authors: ["Alex Kim"] }, now).authors[0];
  const b = createPaper({ arxivId: "2401.00002", title: "B", authors: ["Someone Else", "  Alex  Kim "] }, now).authors;
  const collection = await repository.createAuthorCollection("Algebra", a);
  await repository.followAuthor(b[0]);
  const snapshot = await repository.getAuthorLibrary();
  assert.equal(a.id, b[1].id);
  assert.ok(snapshot.memberships.some(item => item.authorId === b[1].id && item.collectionId === collection.id));
  await repository.removeAuthorFromCollection(b[1].id, collection.id);
  assert.deepEqual((await repository.listFollowing()).map(item => item.id), [b[0].id]);
});

test("collection validation and failed writes leave persisted memberships intact", async () => {
  const { repository, storage } = fixture();
  const collection = await repository.createAuthorCollection("  Algebra  ", alex);
  const initial = await storage.read();
  await assert.rejects(repository.createAuthorCollection("algebra"), /already exists/);
  await assert.rejects(repository.createAuthorCollection(" "), /required/);
  await assert.rejects(repository.createAuthorCollection("X".repeat(81)), /80/);
  await assert.rejects(repository.addAuthorToCollection(renee, "missing"), /no longer exists/);
  await assert.rejects(repository.createAuthorCollection("Bad author", {}));
  assert.deepEqual(await storage.read(), initial);
  storage.write = async () => { throw new Error("Quota"); };
  await assert.rejects(repository.deleteAuthorCollection(collection.id), /Quota/);
  assert.deepEqual(await storage.read(), initial);
});

test("concurrent membership changes and collection deletion leave no dangling references", async () => {
  const { repository } = fixture();
  const collection = await repository.createAuthorCollection("A");
  await Promise.all([repository.addAuthorToCollection(alex, collection.id), repository.addAuthorToCollection(renee, collection.id)]);
  const outcomes = await Promise.allSettled([repository.deleteAuthorCollection(collection.id), repository.addAuthorToCollection(alex, collection.id)]);
  assert.equal(outcomes[0].status, "fulfilled");
  assert.equal(outcomes[1].status, "rejected");
  const library = await repository.getAuthorLibrary();
  assert.equal(library.authors.length, 2);
  assert.equal(library.memberships.length, 0);
});

test("collection operations work across the repository message contract", async () => {
  const { repository } = fixture();
  const handler = createRepositoryHandler(repository, "extension");
  const client = new RepositoryClient({ sendMessage: message => new Promise(resolve => handler(message, { id: "extension" }, resolve)) });
  const collection = await client.createAuthorCollection("A", alex);
  await client.renameAuthorCollection(collection.id, "B");
  await client.addAuthorToCollection(renee, collection.id);
  await client.removeAuthorFromCollection(createAuthor(alex, now).id, collection.id);
  assert.equal((await client.getAuthorLibrary()).memberships.length, 1);
  await client.deleteAuthorCollection(collection.id);
  assert.deepEqual(await client.listFollowing(), []);
});

import test from "node:test";
import assert from "node:assert/strict";
import { LocalRepository } from "../extension/src/repository/local-repository.js";
import { RepositoryClient, REPOSITORY_CHANNEL } from "../extension/src/repository/repository-client.js";
import { ChromeLocalStorage, STORAGE_KEY } from "../extension/src/lib/storage.js";
import { createRepositoryHandler } from "../extension/src/background/repository-handler.js";

const now = "2026-09-24T01:02:03.000Z";
const paper = { arxivId: "2401.00001", title: "A paper", authors: ["Alex Kim"] };
const author = { displayName: "Alex Kim", sourceArxivId: "2401.00001", sourceAuthorIndex: 0 };

function fixture() {
  let values = {};
  const area = {
    async get() { return structuredClone(values); },
    async set(update) { values = { ...values, ...structuredClone(update) }; },
  };
  const storage = new ChromeLocalStorage(area);
  const repository = new LocalRepository(storage, () => now);
  return { area, storage, repository };
}

test("empty library and favorites toggle persist through a new repository instance", async () => {
  const { storage, repository } = fixture();
  assert.deepEqual(await repository.listFavorites(), []);
  assert.deepEqual(await repository.listFollowing(), []);
  const saved = await repository.toggleFavorite(paper);
  assert.equal(saved.savedAt, now);
  const restarted = new LocalRepository(storage);
  assert.deepEqual(await restarted.listFavorites(), [saved]);
  assert.equal(await repository.toggleFavorite({ ...paper, arxivId: `${paper.arxivId}v3` }), null);
  assert.deepEqual(await restarted.listFavorites(), []);
  await repository.removeFavorite(paper.arxivId);
});

test("follow toggle, unfollow and favorite removal are independent", async () => {
  const { repository } = fixture();
  await repository.toggleFavorite(paper);
  const saved = await repository.toggleFollow(author);
  assert.deepEqual(await repository.listFollowing(), [saved]);
  await repository.removeFavorite(paper.arxivId);
  assert.equal((await repository.listFollowing()).length, 1);
  assert.equal(await repository.toggleFollow(author), null);
  await repository.toggleFollow(author);
  await repository.unfollowAuthor(saved.id);
  await repository.unfollowAuthor(saved.id);
  assert.deepEqual(await repository.listFollowing(), []);
});

test("same-name author references from different papers stay separate", async () => {
  const { repository } = fixture();
  await repository.toggleFollow(author);
  await repository.toggleFollow({ ...author, sourceArxivId: "2401.00002" });
  assert.equal((await repository.listFollowing()).length, 2);
});

test("overlapping writes do not lose favorites or followed authors", async () => {
  const { repository } = fixture();
  await Promise.all(Array.from({ length: 15 }, (_, index) => repository.toggleFavorite({
    ...paper, arxivId: `2401.${String(index).padStart(5, "0")}`,
  })).concat(repository.toggleFollow(author)));
  assert.equal((await repository.listFavorites()).length, 15);
  assert.equal((await repository.listFollowing()).length, 1);
  await Promise.all([repository.toggleFavorite(paper), repository.toggleFavorite(paper)]);
  assert.equal((await repository.listFavorites()).length, 15);
});

test("failed writes reject, leave persisted state intact, and do not poison the queue", async () => {
  const { repository, area } = fixture();
  await repository.toggleFavorite(paper);
  const set = area.set;
  area.set = async () => { throw new Error("Quota exceeded"); };
  await assert.rejects(repository.removeFavorite(paper.arxivId), /Quota exceeded/);
  assert.equal((await repository.listFavorites()).length, 1);
  area.set = set;
  await repository.removeFavorite(paper.arxivId);
  assert.deepEqual(await repository.listFavorites(), []);
});

test("unsupported or corrupt data is not overwritten", async () => {
  const { repository, area } = fixture();
  for (const state of [null, { schemaVersion: 2, favorites: [], following: [] }, { schemaVersion: 1, favorites: [{}], following: [] }]) {
    await area.set({ [STORAGE_KEY]: state });
    await assert.rejects(repository.toggleFavorite(paper));
    assert.deepEqual((await area.get())[STORAGE_KEY], state);
  }
});

test("read results are detached, newest first, and unknown fields survive writes", async () => {
  const { repository, storage } = fixture();
  await repository.toggleFavorite(paper);
  repository.clock = () => "2026-09-25T00:00:00.000Z";
  await repository.toggleFavorite({ ...paper, arxivId: "2401.00002" });
  const result = await repository.listFavorites();
  assert.equal(result[0].arxivId, "2401.00002");
  result[0].title = "Changed outside repository";
  assert.equal((await repository.listFavorites())[0].title, paper.title);
  const state = await storage.read();
  state.futureMetadata = "preserved";
  state.favorites[0].version = 7;
  await storage.write(state);
  await repository.toggleFollow(author);
  assert.equal((await storage.read()).futureMetadata, "preserved");
  assert.equal((await storage.read()).favorites[0].version, 7);
});

test("client and worker exchange repository results and propagate errors", async () => {
  const { repository } = fixture();
  const handler = createRepositoryHandler(repository, "test-extension");
  const client = new RepositoryClient({
    sendMessage: message => new Promise(resolve => {
      assert.equal(handler(message, { id: "test-extension" }, resolve), true);
    }),
  });
  const saved = await client.toggleFavorite(paper);
  assert.deepEqual(await client.listFavorites(), [saved]);
  const followed = await client.toggleFollow(author);
  assert.deepEqual(await client.listFollowing(), [followed]);
  await client.unfollowAuthor(followed.id);
  await client.removeFavorite(paper.arxivId);
  await assert.rejects(client.toggleFavorite({}), /arXiv ID/);
  const disconnected = new RepositoryClient({ sendMessage: async () => undefined });
  await assert.rejects(disconnected.listFavorites(), /unavailable/);
});

test("worker rejects unknown methods, malformed arguments and external senders", () => {
  const { repository } = fixture();
  const handler = createRepositoryHandler(repository, "test-extension");
  for (const [method, args, id] of [["constructor", [], "test-extension"], ["run", [], "test-extension"], ["toggleFavorite", [], "test-extension"], ["listFavorites", [], "other-extension"]]) {
    let response;
    assert.equal(handler({ channel: REPOSITORY_CHANNEL, method, args }, { id }, value => { response = value; }), false);
    assert.equal(response.ok, false);
  }
  assert.equal(handler({ channel: "unrelated" }, {}, () => assert.fail()), false);
});

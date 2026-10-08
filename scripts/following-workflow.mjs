import assert from "node:assert/strict";

// The same observable Following workflow runs in both native browser harnesses.
// RPC is used only to inspect outcomes; every modification uses production UI.
export async function followingWorkflow({ evaluate, click, until, reload, key, screenshot = async () => {} }) {
  const snapshot = () => evaluate("(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');return new RepositoryClient().getAuthorLibrary()})()");
  const bookmarks = () => evaluate("(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const {exportedAt,...data}=await new RepositoryClient().exportCategory('bookmarks');return data})()");
  const fill = (selector, value) => evaluate(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)}`);
  const collectionSelector = id => `[data-collection-id=${JSON.stringify(id)}]`;
  const action = (id, name) => `${collectionSelector(id)} + .collection-actions [data-action=${name}]`;
  const checkbox = id => `.arxiv-collection-picker input[type=checkbox][value=${JSON.stringify(id)}]`;
  const settled = () => until("!document.querySelector('#show-create').disabled && !document.querySelector('#status').textContent");
  const original = await snapshot();
  const papers = await bookmarks();
  const memberIds = new Set(original.memberships.map(item => item.authorId));
  assert.equal(memberIds.size, 1, "workflow starts with one default/previously followed author");
  const author = original.authors.find(item => memberIds.has(item.id));
  const previous = original.memberships.filter(item => item.authorId === author.id).map(item => item.collectionId);
  assert.equal(original.settings.organizeFollowedAuthorsIntoCollections, false);
  assert.equal(await evaluate("document.querySelector('#collection-sidebar').hidden && [...document.querySelectorAll('.manage-collections')].every(node=>node.hidden)"), true);

  async function preference(enabled) {
    await click(".settings-link");
    await until("document.querySelector('#organize-author-collections') && !document.querySelector('#organize-author-collections').disabled");
    await click("#organize-author-collections + .toggle");
    await until(`document.querySelector('#organize-author-collections').checked === ${enabled} && !document.querySelector('#organize-author-collections').disabled`);
    await click(".app-nav a[href*=authors]");
    await until(`document.querySelector('#collection-sidebar')?.hidden === ${!enabled} && document.querySelectorAll('.author-row').length === 1`);
  }
  await preference(true);
  assert.equal(await evaluate("document.querySelector('.collection-link .collection-count').textContent"), "1");
  assert.equal(await evaluate("document.documentElement.scrollWidth === document.documentElement.clientWidth"), true);
  assert.equal(await evaluate("document.querySelector('[data-collection-id=\"\"] span').textContent"), "All Following");
  await click("#show-create");
  await key("Escape");
  assert.equal(await evaluate("document.querySelector('#create-form').hidden && document.activeElement.id==='show-create'"), true);

  const collectionCount = (await snapshot()).collections.length;
  await click("#show-create");
  await fill("#collection-name", "typed but cancelled");
  await click("h1");
  assert.equal(await evaluate("document.querySelector('#create-form').hidden"), true);
  await click("#show-create"); await fill("#collection-name", "   "); await key("Enter");
  assert.equal(await evaluate("document.querySelector('#create-form').hidden"), true);
  assert.equal((await snapshot()).collections.length, collectionCount);

  async function create(name) {
    await click("#show-create");
    await fill("#collection-name", name);
    await key("Enter");
    await until(`!document.querySelector('#show-create').disabled && [...document.querySelectorAll('.collection-link span:first-child')].some(node=>node.textContent===${JSON.stringify(name)})`);
    const entry = (await snapshot()).collections.find(item => item.name === name);
    assert.equal(await evaluate("document.querySelector('#empty').textContent"), "No authors in this collection.");
    return entry;
  }
  const first = await create("Workflow A");
  const second = await create("Workflow B");
  // Rename uses the same inline keyboard pattern as Library and retains its ID.
  await click(action(second.id, "rename"));
  await key("Escape");
  assert.equal(await evaluate("document.activeElement.dataset.action"), "rename");
  await click(action(second.id, "rename"));
  await fill("[data-rename-id]", "Workflow Renamed");
  await key("Enter");
  await until("!document.querySelector('[data-rename-id]') && !document.querySelector('#show-create').disabled");
  assert.equal((await snapshot()).collections.find(item => item.id === second.id).name, "Workflow Renamed");
  // Duplicate names reject without losing assignments or leaving controls busy.
  await click(action(second.id, "rename"));
  await fill("[data-rename-id]", "Workflow A");
  await key("Enter");
  await until("document.querySelector('#status').classList.contains('error') && !document.querySelector('#show-create').disabled");
  assert.equal((await snapshot()).collections.find(item => item.id === second.id).name, "Workflow Renamed");
  await key("Escape");
  await click(collectionSelector(""));

  await click(".manage-collections");
  await until("document.querySelector('.arxiv-collection-picker input[type=checkbox]')");
  assert.equal(await evaluate("document.querySelector('.collection-picker-subtitle').textContent.includes('last collection')"), true);
  async function membership(id, enabled) {
    await click(checkbox(id));
    await until(`document.querySelector(${JSON.stringify(checkbox(id))})?.checked === ${enabled} && !document.querySelector(${JSON.stringify(checkbox(id))})?.disabled && document.querySelector('.collection-picker-status').textContent === ''`);
  }
  await membership(first.id, true);
  for (const id of previous) await membership(id, false);
  assert.deepEqual((await snapshot()).memberships.filter(item => item.authorId === author.id).map(item => item.collectionId), [first.id]);
  await click(".collection-picker-heading button");
  assert.equal(await evaluate("document.activeElement.classList.contains('manage-collections')"), true);
  await click(collectionSelector(first.id));
  assert.equal(await evaluate("document.querySelectorAll('.author-row').length"), 1);
  await click(".manage-collections");
  await until("document.querySelector('.arxiv-collection-picker input[type=checkbox]')");
  await membership(second.id, true);
  await membership(first.id, false);
  assert.equal(await evaluate("document.querySelectorAll('.author-row').length"), 0);
  await key("Escape");
  assert.equal(await evaluate("document.activeElement.dataset.collectionId"), first.id, "closing picker after filtered author leaves restores collection focus");
  await click(collectionSelector(second.id));
  assert.equal(await evaluate("document.querySelectorAll('.author-row').length"), 1);
  await screenshot();
  const moved = await snapshot();
  assert.deepEqual(moved.authors, original.authors, "moving retains author metadata");
  assert.deepEqual(await bookmarks(), papers);
  await reload();
  await until("document.querySelectorAll('.author-row').length===1 && !document.querySelector('#collection-sidebar').hidden");
  await click(collectionSelector(second.id));
  assert.equal(await evaluate("document.querySelectorAll('.author-row').length"), 1);
  await preference(false);
  assert.deepEqual((await snapshot()).memberships, moved.memberships);
  await reload();
  await until("document.querySelector('#collection-sidebar')?.hidden && document.querySelectorAll('.author-row').length===1");
  await preference(true);
  await click(collectionSelector(second.id));
  await click(action(second.id, "delete"));
  assert.equal(await evaluate("document.querySelector('.collection-delete-dialog').open && document.querySelector('.collection-delete-dialog').textContent.includes('become unfollowed')"), true);
  await key("Escape");
  assert.equal((await snapshot()).memberships.length, 1, "cancel preserves sole membership");
  await click(".manage-collections");
  await until("document.querySelector('.arxiv-collection-picker input[type=checkbox]')");
  await membership(second.id, false);
  assert.equal(await evaluate("document.querySelectorAll('.author-row').length"), 0, "last membership removal unfollows immediately");
  assert.deepEqual((await snapshot()).authors, original.authors);
  await membership(second.id, true); // The still-open picker can restore the follow.
  await click(".collection-picker-heading button");
  // Restore original memberships through the picker before deleting test groups.
  await click(".manage-collections");
  await until("document.querySelector('.arxiv-collection-picker input[type=checkbox]')");
  for (const id of previous) await membership(id, true);
  await click(".collection-picker-heading button");
  await click(action(second.id, "delete"));
  assert.equal(await evaluate("document.querySelector('.collection-delete-dialog').textContent.includes('other collections remain followed')"), true);
  await click("[data-confirm-id]");
  await settled();
  assert.equal(await evaluate("document.querySelectorAll('.author-row').length"), 1, "deleting group retains author followed in another");
  await click(collectionSelector(first.id));
  await click(action(first.id, "delete"));
  await click("[data-confirm-id]");
  await settled();
  await preference(false);
  const final = await snapshot();
  assert.deepEqual(final.collections, original.collections);
  assert.deepEqual(final.authors, original.authors);
  assert.deepEqual(final.memberships.map(({ authorId, collectionId }) => ({ authorId, collectionId })), original.memberships.map(({ authorId, collectionId }) => ({ authorId, collectionId })));
  assert.deepEqual(await bookmarks(), papers);
  await click(".author-row .actions button:last-child");
  await until("document.querySelectorAll('.author-row').length===0 && document.querySelector('.xivary-undo button')");
  await click(".xivary-undo-stack .xivary-undo:last-child button");
  await until("document.querySelectorAll('.author-row').length===1");
  assert.deepEqual((await snapshot()).memberships, final.memberships);
  console.log("Following workflow PASS: toggle, defaults, create/rename/errors/cancel/delete, assign/move, counts/filter, reload, metadata and Bookmark isolation");
}

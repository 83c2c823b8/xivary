import { collectionSidebarRow, closeCollectionMenu } from "../ui/collection-sidebar.js";
import { setFollowButton } from "../ui/follow-button.js";
import { setCollectionButton } from "../ui/collection-button.js";
import { bindCollectionCreate } from "../ui/collection-create.js";
import { confirmCollectionDeletion } from "../ui/confirm-collection.js";
import { showUndo } from "../ui/undo.js";
import { RepositoryClient } from "../repository/repository-client.js";
import { openAuthorCollectionPicker, closeAuthorCollectionPicker } from "../ui/author-collection-picker.js";

const repository = new RepositoryClient();
const element = id => document.getElementById(id);
let library;
let selected = "";
let busy = false;
let editingId = null;
let loadRevision = 0;
let renderedCollections;
const rows = new Map();
let renderedOrganization;

const closeCreate = bindCollectionCreate({
  trigger: element("show-create"), form: element("create-form"), input: element("collection-name"),
  onOpen: () => { editingId = null; renderCollections(); },
  create: name => mutate(async () => { const collection = await repository.createAuthorCollection(name); selected = collection.id; }, { propagateError: true }),
});
window.addEventListener("focus", () => { if (!busy) void load(); });
void load();

async function load() {
  const revision = ++loadRevision;
  try {
    const snapshot = await repository.getAuthorLibrary();
    if (revision !== loadRevision) return;
    library = snapshot;
    if (!organized() || !library.collections.some(collection => collection.id === selected)) selected = "";
    if (!organized()) {
      closeAuthorCollectionPicker();
      closeCreate();
      editingId = null;
    }
    render();
    setStatus("");
  } catch (error) { if (revision === loadRevision) setStatus(error.message, true); }
}

function organized() { return library.settings.organizeFollowedAuthorsIntoCollections; }
function followedAuthors() {
  const ids = new Set(library.memberships.map(item => item.authorId));
  return library.authors.filter(author => ids.has(author.id)).sort((a, b) => b.followedAt.localeCompare(a.followedAt));
}

function render() {
  if (!library) return;
  element("following-layout").classList.toggle("library-layout", organized());
  element("collection-sidebar").hidden = !organized();
  element("collection-toolbar").hidden = !organized();
  if (renderedOrganization !== organized()) { rows.clear(); renderedOrganization = organized(); }
  if (organized()) renderCollections();
  else { closeCollectionMenu(); renderedCollections = undefined; element("collection-list").replaceChildren(); }
  const ids = selected ? new Set(library.memberships.filter(item => item.collectionId === selected).map(item => item.authorId)) : null;
  const authors = followedAuthors().filter(author => !ids || ids.has(author.id));
  // Keep each visible row/anchor connected while the membership picker updates.
  // An author can leave the selected collection while that picker stays open.
  const live = new Set(authors.map(author => author.id));
  for (const id of rows.keys()) if (!live.has(id)) rows.delete(id);
  const visible = authors.map(author => {
    if (!rows.has(author.id)) rows.set(author.id, authorRow(author));
    const row = rows.get(author.id);
    row.querySelector("h2 a").textContent = author.displayName;
    return row;
  });
  // Avoid moving an unchanged row so a focus refresh retains keyboard focus.
  for (const row of [...element("authors").children]) if (rows.get(row.dataset.authorId) !== row) row.remove();
  visible.forEach((row, index) => {
    const current = element("authors").children[index];
    if (current !== row) element("authors").insertBefore(row, current || null);
  });
  element("count").textContent = `${authors.length} ${authors.length === 1 ? "author" : "authors"}`;
  element("empty").textContent = selected ? "No authors in this collection." : "No followed researchers.";
  element("empty").hidden = authors.length > 0;
  setDisabled(busy);
}

function authorRow(author) {
  const row = document.createElement("li");
  row.className = "author-row";
  row.dataset.authorId = author.id;
  const heading = document.createElement("h2");
  const link = document.createElement("a");
  link.textContent = author.displayName;
  link.href = `../author/author.html?authorId=${encodeURIComponent(author.id)}`;
  heading.append(link);
  const actions = document.createElement("div");
  actions.className = "actions";
  const collections = document.createElement("button");
  collections.type = "button";
  collections.className = "manage-collections";
  setCollectionButton(collections, author.displayName, { iconOnly: true });
  collections.setAttribute("aria-haspopup", "dialog");
  collections.setAttribute("aria-expanded", "false");
  collections.addEventListener("click", () => void openAuthorCollectionPicker({
    repository, author, anchor: collections, onChange: load,
    onClose: () => { if (!collections.isConnected) focusSelection(); },
  }));
  const unfollow = document.createElement("button");
  unfollow.type = "button";
  setFollowButton(unfollow, true, author.displayName);
  unfollow.addEventListener("click", () => void mutate(async () => { const result = await repository.unfollowAuthor(author.id); showUndo(repository, result, `Unfollowed ${author.displayName}.`, load); }));
  if (organized()) actions.append(collections);
  actions.append(unfollow);
  row.append(heading, actions);
  return row;
}

function focusSelection() {
  const selector = `[data-collection-id="${CSS.escape(selected)}"]`;
  if (organized()) document.querySelector(selector)?.focus();
  else document.querySelector(".settings-link").focus();
}

function renderCollections() {
  const entries = [
    { id: "", name: "All Following", count: followedAuthors().length },
    ...library.collections.map(collection => ({
      ...collection,
      count: library.memberships.filter(item => item.collectionId === collection.id).length,
    })),
  ];
  const signature = JSON.stringify([selected, editingId, entries]);
  if (signature === renderedCollections) return;
  // A focus refresh with unchanged data must not discard menu/input focus.
  closeCollectionMenu();
  renderedCollections = signature;
  element("collection-list").replaceChildren(...entries.map(entry => {
    const item = document.createElement("li");
    item.className = "collection-item";
    if (editingId === entry.id) {
      item.append(renameForm(entry));
      return item;
    }
    const row = collectionSidebarRow(entry, {
      selected, aggregateIcon: "authors",
      select: () => { selected = entry.id; editingId = null; closeCreate(); render(); },
      rename: () => renameCollection(entry), remove: () => deleteCollection(entry),
    });
    item.append(row);
    return item;
  }));
}

function renameCollection(entry) {
  editingId = entry.id;
  closeCreate();
  renderCollections();
  document.querySelector(`[data-rename-id="${CSS.escape(entry.id)}"]`)?.select();
}

function deleteCollection(entry) {
  editingId = null;
  closeCreate();
  confirmCollectionDeletion(entry, "Deleting removes this collection and its memberships. Authors followed only here become unfollowed; authors in other collections remain followed.", () => mutate(async () => {
    await repository.deleteAuthorCollection(entry.id);
    if (selected === entry.id) selected = "";
  }, { propagateError: true }), () => focusCollectionAction(entry.id));
}

function renameForm(entry) {
  const form = document.createElement("form");
  form.className = "collection-inline-form";
  const input = document.createElement("input");
  input.type = "text";
  input.required = true;
  input.maxLength = 80;
  input.value = entry.name;
  input.dataset.renameId = entry.id;
  input.setAttribute("aria-label", `Rename ${entry.name}`);
  form.append(input);
  form.addEventListener("submit", event => {
    event.preventDefault();
    void mutate(() => repository.renameAuthorCollection(entry.id, input.value), { focusCollectionId: entry.id });
  });
  form.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); form.requestSubmit(); }
    if (event.key === "Escape") {
      event.preventDefault();
      editingId = null;
      renderCollections();
      focusCollectionAction(entry.id);
    }
  });
  return form;
}

async function mutate(operation, { focusCollectionId, propagateError = false } = {}) {
  if (busy) return;
  busy = true;
  setDisabled(true);
  try {
    await operation();
    editingId = null;
    await load();
    setDisabled(false);
    if (focusCollectionId) focusCollectionAction(focusCollectionId);
    else focusSelection();
  }
  catch (error) { setStatus(error.message, true); if (propagateError) throw error; }
  finally { busy = false; setDisabled(false); }
}

function setDisabled(value) { document.querySelectorAll("main button,main input").forEach(node => { node.disabled = value; }); }
function setStatus(message, error = false) { element("status").textContent = message; element("status").classList.toggle("error", error); }

function focusCollectionAction(id) {
  document.querySelector(`[data-collection-id="${CSS.escape(id)}"]`)?.parentElement
    ?.querySelector('.collection-menu-trigger')?.focus();
}

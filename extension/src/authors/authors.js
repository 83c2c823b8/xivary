import { RepositoryClient } from "../repository/repository-client.js";
import { openAuthorCollectionPicker, closeAuthorCollectionPicker } from "../ui/author-collection-picker.js";

const repository = new RepositoryClient();
const element = id => document.getElementById(id);
let library;
let selected = "";
let busy = false;
let editingId = null;
let deletingId = null;
let loadRevision = 0;
const rows = new Map();
let renderedOrganization;

element("show-create").addEventListener("click", () => {
  editingId = null;
  deletingId = null;
  renderCollections();
  element("show-create").hidden = true;
  element("create-form").hidden = false;
  element("show-create").setAttribute("aria-expanded", "true");
  element("collection-name").focus();
});
element("create-form").addEventListener("keydown", event => {
  if (event.key === "Escape") { event.preventDefault(); closeCreate(true); }
  if (event.key === "Enter") { event.preventDefault(); event.currentTarget.requestSubmit(); }
});
element("create-form").addEventListener("submit", event => {
  event.preventDefault();
  void mutate(async () => {
    const collection = await repository.createAuthorCollection(element("collection-name").value);
    selected = collection.id;
    element("collection-name").value = "";
    closeCreate();
  });
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
      editingId = deletingId = null;
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
  else element("collection-list").replaceChildren();
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
  collections.textContent = "Collections";
  collections.setAttribute("aria-label", `Collections for ${author.displayName}`);
  collections.setAttribute("aria-haspopup", "dialog");
  collections.setAttribute("aria-expanded", "false");
  collections.addEventListener("click", () => void openAuthorCollectionPicker({
    repository, author, anchor: collections, onChange: load,
    onClose: () => { if (!collections.isConnected) focusSelection(); },
  }));
  const unfollow = document.createElement("button");
  unfollow.type = "button";
  unfollow.textContent = "Unfollow";
  unfollow.addEventListener("click", () => void mutate(() => repository.unfollowAuthor(author.id)));
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
  element("collection-list").replaceChildren(...entries.map(entry => {
    const item = document.createElement("li");
    item.className = "collection-item";
    if (editingId === entry.id) {
      item.append(renameForm(entry));
      return item;
    }
    if (deletingId === entry.id) {
      item.append(deleteConfirmation(entry));
      return item;
    }
    const row = document.createElement("div");
    row.className = "collection-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "collection-link";
    button.dataset.collectionId = entry.id;
    if (entry.id === selected) button.setAttribute("aria-current", "page");
    const name = document.createElement("span");
    name.textContent = entry.name;
    const count = document.createElement("span");
    count.className = "collection-count";
    count.textContent = entry.count;
    button.append(name, count);
    button.addEventListener("click", () => {
      selected = entry.id;
      editingId = null;
      deletingId = null;
      closeCreate();
      render();
    });
    row.append(button);
    if (entry.id) row.append(collectionActions(entry));
    item.append(row);
    return item;
  }));
}

function collectionActions(entry) {
  const actions = document.createElement("div");
  actions.className = "collection-actions";
  actions.append(
    iconButton("rename", `Rename ${entry.name}`, pencilIcon, () => {
      editingId = entry.id;
      deletingId = null;
      closeCreate();
      renderCollections();
      document.querySelector(`[data-rename-id="${CSS.escape(entry.id)}"]`)?.select();
    }),
    iconButton("delete", `Delete ${entry.name}`, trashIcon, () => {
      deletingId = entry.id;
      editingId = null;
      closeCreate();
      renderCollections();
      document.querySelector(`[data-confirm-id="${CSS.escape(entry.id)}"]`)?.focus();
    }),
  );
  return actions;
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
    void mutate(() => repository.renameAuthorCollection(entry.id, input.value), { focusAction: [entry.id, "rename"] });
  });
  form.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); form.requestSubmit(); }
    if (event.key === "Escape") {
      event.preventDefault();
      editingId = null;
      renderCollections();
      focusCollectionAction(entry.id, "rename");
    }
  });
  return form;
}

function deleteConfirmation(entry) {
  const panel = document.createElement("div");
  panel.className = "delete-confirmation";
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", `Delete ${entry.name}?`);
  const prompt = document.createElement("span");
  const solelyHere = library.memberships.filter(item => item.collectionId === entry.id &&
    !library.memberships.some(other => other.authorId === item.authorId && other.collectionId !== entry.id)).length;
  prompt.textContent = solelyHere
    ? `Delete? Unfollows ${solelyHere} ${solelyHere === 1 ? "author" : "authors"}.`
    : "Delete?";
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.textContent = "Yes";
  confirm.dataset.confirmId = entry.id;
  confirm.addEventListener("click", () => void mutate(async () => {
    await repository.deleteAuthorCollection(entry.id);
    if (selected === entry.id) selected = "";
  }));
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    deletingId = null;
    renderCollections();
    focusCollectionAction(entry.id, "delete");
  });
  panel.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    cancel.click();
  });
  panel.append(prompt, confirm, cancel);
  return panel;
}

function iconButton(action, label, icon, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.dataset.action = action;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = icon;
  button.addEventListener("click", onClick);
  return button;
}

function closeCreate(returnFocus = false) {
  element("create-form").hidden = true;
  element("show-create").hidden = false;
  element("show-create").setAttribute("aria-expanded", "false");
  if (returnFocus) element("show-create").focus();
}

async function mutate(operation, { focusAction } = {}) {
  if (busy) return;
  busy = true;
  setDisabled(true);
  try {
    await operation();
    editingId = null;
    deletingId = null;
    await load();
    setDisabled(false);
    if (focusAction) focusCollectionAction(...focusAction);
    else focusSelection();
  }
  catch (error) { setStatus(error.message, true); }
  finally { busy = false; setDisabled(false); }
}

function setDisabled(value) { document.querySelectorAll("main button,main input").forEach(node => { node.disabled = value; }); }
function setStatus(message, error = false) { element("status").textContent = message; element("status").classList.toggle("error", error); }

function focusCollectionAction(id, action) {
  document.querySelector(`[data-collection-id="${CSS.escape(id)}"]`)?.parentElement
    ?.querySelector(`[data-action="${action}"]`)?.focus();
}

const pencilIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.75 4.75L8 20l10.4-10.4a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m14.5 7.5 3 3"/></svg>';
const trashIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 3h6l1 4H8l1-4Zm-3 4 1 14h10l1-14M10 11v6m4-6v6"/></svg>';

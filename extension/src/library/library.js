import { bindCollectionCreate } from "../ui/collection-create.js";
import { confirmCollectionDeletion } from "../ui/confirm-collection.js";
import { RepositoryClient } from "../repository/repository-client.js";
import { paperRow } from "../ui/paper-row.js";
import { openPaperCollectionPicker } from "../ui/paper-collection-picker.js";

const repository = new RepositoryClient();
const element = id => document.getElementById(id);
let library;
let selected = "";
let busy = false;
let editingId = null;
let loadRevision = 0;

element("filter").addEventListener("input", render);
const closeCreate = bindCollectionCreate({
  trigger: element("show-create"), form: element("create-form"), input: element("collection-name"),
  onOpen: () => { editingId = null; renderCollections(); },
  create: name => mutate(async () => { const collection = await repository.createPaperCollection(name); selected = collection.id; }, { propagateError: true }),
});
window.addEventListener("focus", () => { if (!busy) void load(); });
void load();

async function load() {
  const revision = ++loadRevision;
  try {
    const snapshot = await repository.getPaperLibrary();
    if (revision !== loadRevision) return;
    library = snapshot;
    if (!library.collections.some(collection => collection.id === selected)) selected = "";
    render();
    setStatus("");
  } catch (error) { if (revision === loadRevision) setStatus(error.message, true); }
}

function render() {
  if (!library) return;
  renderCollections();
  const ids = selected ? new Set(library.memberships.filter(item => item.collectionId === selected).map(item => item.arxivId)) : null;
  const query = element("filter").value.trim().toLowerCase();
  const inCollection = library.papers.filter(paper => !ids || ids.has(paper.arxivId));
  const visible = inCollection.filter(paper => [paper.title, ...paper.authors.map(author => author.displayName), ...(paper.categories || [])].join(" ").toLowerCase().includes(query));
  element("papers").replaceChildren(...visible.map(paper => paperRow(paper, {
    saved: true,
    showAbstract: false,
    openArxivLinksInNewTab: library.settings.openArxivLinksInNewTab,
    onToggle: button => managePaper(paper, button),
  })));
  element("count").textContent = query && inCollection.length
    ? `${visible.length} of ${inCollection.length} papers`
    : `${inCollection.length} ${inCollection.length === 1 ? "paper" : "papers"}`;
  element("empty").textContent = query ? "No matching papers." : selected ? "No papers in this collection." : "No saved papers.";
  element("empty").hidden = visible.length > 0;
  setDisabled(busy);
}

function renderCollections() {
  const entries = [
    { id: "", name: "All Saved", count: library.papers.length },
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
      closeCreate();
      renderCollections();
      document.querySelector(`[data-rename-id="${CSS.escape(entry.id)}"]`)?.select();
    }),
    iconButton("delete", `Delete ${entry.name}`, trashIcon, () => {
      editingId = null;
      closeCreate();
      confirmCollectionDeletion(entry, "Deleting removes this collection and its memberships. Papers saved only here are removed from Bookmarks; papers in other collections remain saved.", () => mutate(async () => {
        await repository.deletePaperCollection(entry.id);
        if (selected === entry.id) selected = "";
      }, { propagateError: true }), () => focusCollectionAction(entry.id, "delete"));
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
    void mutate(() => repository.renamePaperCollection(entry.id, input.value), { focusAction: [entry.id, "rename"] });
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

async function managePaper(paper, button) {
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  await openPaperCollectionPicker({ repository, paper, anchor: button, onChange: load });
}

async function mutate(operation, { focusAction, propagateError = false } = {}) {
  if (busy) return;
  busy = true;
  setDisabled(true);
  try {
    await operation();
    editingId = null;
    await load();
    if (focusAction) focusCollectionAction(...focusAction);
  }
  catch (error) { setStatus(error.message, true); if (propagateError) throw error; }
  finally { busy = false; setDisabled(false); }
}

function setDisabled(value) { document.querySelectorAll("button,input").forEach(node => { node.disabled = value; }); }
function setStatus(message, error = false) { element("status").textContent = message; element("status").classList.toggle("error", error); }

function focusCollectionAction(id, action) {
  document.querySelector(`[data-collection-id="${CSS.escape(id)}"]`)?.parentElement
    ?.querySelector(`[data-action="${action}"]`)?.focus();
}

const pencilIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.75 4.75L8 20l10.4-10.4a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m14.5 7.5 3 3"/></svg>';
const trashIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 3h6l1 4H8l1-4Zm-3 4 1 14h10l1-14M10 11v6m4-6v6"/></svg>';

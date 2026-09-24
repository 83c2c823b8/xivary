import { RepositoryClient } from "../repository/repository-client.js";
import { paperRow } from "../ui/paper-row.js";
import { openPaperCollectionPicker } from "../ui/paper-collection-picker.js";

const repository = new RepositoryClient();
const element = id => document.getElementById(id);
let library;
let selected = "";
let busy = false;
let editingId = null;
let deletingId = null;

element("filter").addEventListener("input", render);
element("show-create").addEventListener("click", () => {
  editingId = null;
  deletingId = null;
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
    const collection = await repository.createPaperCollection(element("collection-name").value);
    selected = collection.id;
    element("collection-name").value = "";
    closeCreate();
  });
});
window.addEventListener("focus", () => void load());
void load();

async function load() {
  try {
    library = await repository.getPaperLibrary();
    if (!library.collections.some(collection => collection.id === selected)) selected = "";
    render();
    setStatus("");
  } catch (error) { setStatus(error.message, true); }
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

function deleteConfirmation(entry) {
  const panel = document.createElement("div");
  panel.className = "delete-confirmation";
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", `Delete ${entry.name}?`);
  const prompt = document.createElement("span");
  prompt.textContent = "Delete?";
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.textContent = "Yes";
  confirm.dataset.confirmId = entry.id;
  confirm.addEventListener("click", () => void mutate(async () => {
    await repository.deletePaperCollection(entry.id);
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

async function managePaper(paper, button) {
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  await openPaperCollectionPicker({ repository, paper, anchor: button, onChange: load });
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
    if (focusAction) focusCollectionAction(...focusAction);
  }
  catch (error) { setStatus(error.message, true); }
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

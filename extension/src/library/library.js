import { explicitLibraryCollection } from '../domain/library-selection.js';
import { bindVimMode } from "../ui/vim-mode.js";
import { filterPublicationDates } from "../domain/publication-date.js";
import { publicationTimeFilter } from "../ui/publication-time-filter.js";
import { collectionSidebarRow, closeCollectionMenu, updateSidebarSelection } from "../ui/collection-sidebar.js";
import { bindCollectionRenameOutside } from "../ui/collection-rename.js";
import { bindCollectionCreate } from "../ui/collection-create.js";
import { confirmCollectionDeletion } from "../ui/confirm-collection.js";
import { RepositoryClient } from "../repository/repository-client.js";
import { paperRow } from "../ui/paper-row.js";
import { openPaperCollectionPicker } from "../ui/paper-collection-picker.js";
import { orderedRecords } from '../domain/paper-ordering.js';
import { bindReorder } from '../ui/reorder.js';

const repository = new RepositoryClient();
bindVimMode(repository);
const element = id => document.getElementById(id);
let library;
let selected = "";
let selectionInitialized = false;
let rememberedSelection;
let busy = false;
let editingId = null;
let loadRevision = 0;
let renderedCollections;
const paperRows = new Map();
const timeFilter = publicationTimeFilter(render);
const collectionReorder = bindReorder(element('collection-list'), { move: (id, before, name) => saveMove('collections', id, before, name) });
const paperReorder = bindReorder(element('papers'), { move: (id, before, name) => saveMove('papers', id, before, name) });
window.addEventListener('pagehide', () => { collectionReorder.cancel(); paperReorder.cancel(); });

bindCollectionRenameOutside({
  getForm: () => document.querySelector("[data-rename-id]")?.closest("form"),
  isBusy: () => busy,
  cancel: () => { editingId = null; renderCollections(true); },
});

element("filter").addEventListener("input", render);
element("clear-filter").addEventListener("click", () => {
  element("filter").value = ""; render(); element("filter").focus();
});
const closeCreate = bindCollectionCreate({
  trigger: element("show-create"), form: element("create-form"), input: element("collection-name"),
  onOpen: () => { editingId = null; renderCollections(); },
  create: name => mutate(async () => { const collection = await repository.createPaperCollection(name); selected = collection.id; }, { propagateError: true }),
});
window.addEventListener("focus", () => { if (!busy && !collectionReorder.dragging && !paperReorder.dragging) void load(); });
element('retry-storage').addEventListener('click', () => void load());
setDisabled(true);
void load();

async function load() {
  const revision = ++loadRevision;
  element('retry-storage').hidden = true;
  try {
    const snapshot = await repository.getPaperLibrary();
    if (revision !== loadRevision) return;
    library = snapshot;
    if (!selectionInitialized) {
      rememberedSelection = snapshot.selectedCollectionId ?? '';
      selected = explicitLibraryCollection(location.search) ?? rememberedSelection;
      selectionInitialized = true;
    }
    if (!library.collections.some(collection => collection.id === selected)) selected = "";
    render();
    setStatus("");
  } catch (error) { if (revision === loadRevision) {
    setDisabled(true);element('retry-storage').hidden = false;element('retry-storage').disabled = false;
    setStatus(`Could not initialize Library: ${error.message}`, true);
  } }
}

function render() {
  if (!library) return;
  renderCollections();
  const ids = selected ? new Set(library.memberships.filter(item => item.collectionId === selected).map(item => item.arxivId)) : null;
  const query = element("filter").value.trim().toLowerCase();
  let inCollection = library.papers.filter(paper => !ids || ids.has(paper.arxivId));
  const order = selected && library.ordering.paperOrders.find(order => order.collectionId === selected);
  if (order) inCollection = orderedRecords(inCollection, order.paperIds);
  const date = timeFilter.values();
  const active = Boolean(query) || date.range !== "any";
  const visible = filterPublicationDates(inCollection.filter(paper => [paper.title, ...paper.authors.map(author => author.displayName), ...(paper.categories || [])].join(" ").toLowerCase().includes(query)), date);
  const nodes = visible.map(paper => {
    const signature = JSON.stringify([paper, library.settings.openArxivLinksInNewTab]);
    let cached = paperRows.get(paper.arxivId);
    if (cached?.signature !== signature) {
      cached = { signature, node: paperRow(paper, {
        repository,
        saved: true, showAbstract: false,
        openArxivLinksInNewTab: library.settings.openArxivLinksInNewTab,
        onToggle: button => managePaper(paper, button),
      }) };
      paperRows.set(paper.arxivId, cached);
    }
    if (selected) {
      cached.node.dataset.reorderId = paper.arxivId;
      paperReorder.attach(cached.node, paper.arxivId, paper.title, {
        disabled: visible.length !== inCollection.length,
        disabledReason: 'Clear filters to reorder the complete collection.',
      });
    } else paperReorder.detach(cached.node);
    return cached.node;
  });
  const existing = [...element("papers").children];
  if (existing.length !== nodes.length || nodes.some((node, index) => node !== existing[index])) {
    paperReorder.cancel(); element("papers").replaceChildren(...nodes);
  }
  const live = new Set(library.papers.map(paper => paper.arxivId));
  for (const id of paperRows.keys()) if (!live.has(id)) paperRows.delete(id);
  element("count").textContent = active && inCollection.length
    ? `${visible.length} of ${inCollection.length} papers`
    : `${inCollection.length} ${inCollection.length === 1 ? "paper" : "papers"}`;
  element("empty").textContent = active ? "No matching papers." : selected ? "No papers in this collection." : "No saved papers.";
  element("empty").hidden = visible.length > 0;
  element("clear-filter").hidden = !query || visible.length > 0;
  setDisabled(busy);
  rememberSelection();
}

function renderCollections(preserveRows = false) {
  const entries = [
    { id: "", name: "All Saved", count: library.papers.length },
    ...orderedRecords(library.collections, library.ordering.collectionIds).map(collection => ({
      ...collection,
      count: library.memberships.filter(item => item.collectionId === collection.id).length,
    })),
  ];
  const signature = JSON.stringify([selected, editingId, entries]);
  if (signature === renderedCollections) return;
  // A focus refresh with unchanged data must not discard menu/input focus.
  closeCollectionMenu();
  const previous = renderedCollections && JSON.parse(renderedCollections);
  renderedCollections = signature;
  if (!editingId && previous?.[1] === null && JSON.stringify(previous[2]) === JSON.stringify(entries)) {
    updateSidebarSelection(element("collection-list"), selected);
    return;
  }
  const buildItem = entry => {
    const item = document.createElement("li");
    item.className = "collection-item";
    if (editingId === entry.id) {
      item.append(renameForm(entry));
      return item;
    }
    const row = collectionSidebarRow(entry, {
      selected, aggregateIcon: "papers",
      select: () => { selected = entry.id; editingId = null; closeCreate(); render(); },
      rename: () => renameCollection(entry), remove: () => deleteCollection(entry),
      menuTrigger: true,
    });
    if (entry.id) {
      item.dataset.reorderId = entry.id;
      collectionReorder.attach(row, entry.id, entry.name);
    }
    item.append(row);
    return item;
  };
  if (preserveRows) {
    const input = document.querySelector("[data-rename-id]");
    const entry = entries.find(item => item.id === input?.dataset.renameId);
    if (entry) input.closest(".collection-item").replaceWith(buildItem(entry));
    return;
  }
  collectionReorder.cancel();
  element("collection-list").replaceChildren(...entries.map(buildItem));
}

function renameCollection(entry) {
  collectionReorder.cancel(); paperReorder.cancel();
  editingId = entry.id;
  closeCreate();
  renderCollections();
  document.querySelector(`[data-rename-id="${CSS.escape(entry.id)}"]`)?.select();
}

function deleteCollection(entry) {
  collectionReorder.cancel(); paperReorder.cancel();
  editingId = null;
  closeCreate();
  confirmCollectionDeletion(entry, "Deleting removes this collection and its memberships. Papers saved only here are removed from Bookmarks; papers in other collections remain saved.", () => mutate(async () => {
    await repository.deletePaperCollection(entry.id);
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
    void mutate(() => repository.renamePaperCollection(entry.id, input.value), { focusCollectionId: entry.id });
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

async function managePaper(paper, button) {
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  await openPaperCollectionPicker({ repository, paper, anchor: button, onChange: load });
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
    return true;
  }
  catch (error) { setStatus(error.message, true); if (propagateError) throw error; }
  finally { busy = false; setDisabled(false); }
}

function setDisabled(value) { document.querySelectorAll("button,input").forEach(node => { node.disabled = value || node.dataset.reorderUnavailable === 'true'; }); }
function setStatus(message, error = false) { element("status").textContent = message; element("status").classList.toggle("error", error); }

function focusCollectionAction(id) {
  (document.querySelector(`[data-collection-id="${CSS.escape(id)}"]`) ?? element("collection-list").querySelector("[aria-current=page]"))?.focus();
}

async function saveMove(kind, id, beforeId, name) {
  if (busy || (kind === 'papers' && (!selected || element('papers').querySelector('.reorder-handle:disabled')))) return;
  const collectionId = selected;
  let changed = false;
  const success = await mutate(async () => {
    changed = await (kind === 'collections' ? repository.movePaperCollection(id, beforeId) : repository.movePaperInCollection(collectionId, id, beforeId));
  });
  if (success && changed) {
    const ids = kind === 'collections' ? library.ordering.collectionIds : library.ordering.paperOrders.find(item => item.collectionId === collectionId)?.paperIds || [];
    setStatus(`Moved ${name} to position ${ids.indexOf(id) + 1} of ${ids.length}.`);
  }
}

function rememberSelection() {
  if (!selectionInitialized || selected === rememberedSelection) return;
  const id = selected;
  rememberedSelection = id;
  // Dispatch immediately; the shared background queue owns this write even if
  // the user navigates away before its response. No unload timer or UI storage.
  void repository.setLibrarySelection(id).catch(error => {
    if (selected === id) { rememberedSelection = undefined; setStatus(`Could not remember this collection: ${error.message}`, true); }
  });
}

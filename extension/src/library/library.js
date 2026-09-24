import { RepositoryClient } from "../repository/repository-client.js";
import { paperRow } from "../ui/paper-row.js";
import { openPaperCollectionPicker } from "../ui/paper-collection-picker.js";

const repository = new RepositoryClient();
const element = id => document.getElementById(id);
let library;
let selected = "";
let busy = false;

element("filter").addEventListener("input", render);
element("show-create").addEventListener("click", () => togglePanel("create"));
element("show-manage").addEventListener("click", () => togglePanel("manage"));
element("cancel-create").addEventListener("click", () => closePanels("create"));
element("close-manage").addEventListener("click", () => closePanels("manage"));
for (const name of ["create", "manage"]) element(`${name}-form`).addEventListener("keydown", event => {
  if (event.key === "Escape") { event.preventDefault(); closePanels(name); }
});
element("create-form").addEventListener("submit", event => {
  event.preventDefault();
  void mutate(async () => {
    const collection = await repository.createPaperCollection(element("collection-name").value);
    selected = collection.id;
    element("collection-name").value = "";
    closePanels();
  }, "Collection created.");
});
element("manage-form").addEventListener("submit", event => {
  event.preventDefault();
  void mutate(() => repository.renamePaperCollection(selected, element("rename-name").value), "Collection renamed.");
});
element("delete").addEventListener("click", () => void mutate(async () => {
  await repository.deletePaperCollection(selected);
  selected = "";
  closePanels();
}, "Collection deleted."));
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
  element("show-manage").hidden = !selected;
  if (!selected) element("manage-form").hidden = true;
  element("rename-name").value = library.collections.find(collection => collection.id === selected)?.name || "";
  const ids = selected ? new Set(library.memberships.filter(item => item.collectionId === selected).map(item => item.arxivId)) : null;
  const query = element("filter").value.trim().toLowerCase();
  const inCollection = library.papers.filter(paper => !ids || ids.has(paper.arxivId));
  const visible = inCollection.filter(paper => [paper.title, ...paper.authors.map(author => author.displayName), ...(paper.categories || [])].join(" ").toLowerCase().includes(query));
  element("papers").replaceChildren(...visible.map(paper => paperRow(paper, {
    saved: true,
    showAbstract: false,
    onToggle: button => managePaper(paper, button),
  })));
  element("count").textContent = `${visible.length} of ${inCollection.length}`;
  element("empty").textContent = library.papers.length ? "No papers in this view." : "No saved papers yet. Use the bookmark on an arXiv page or paper result.";
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
      closePanels();
      render();
    });
    item.append(button);
    return item;
  }));
}

async function managePaper(paper, button) {
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  await openPaperCollectionPicker({ repository, paper, anchor: button, onChange: load });
}

function togglePanel(name) {
  const panel = element(name === "create" ? "create-form" : "manage-form");
  const opening = panel.hidden;
  closePanels();
  if (!opening) return;
  const trigger = element(name === "create" ? "show-create" : "show-manage");
  panel.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  panel.querySelector("input")?.focus();
}

function closePanels(returnFocus) {
  element("create-form").hidden = true;
  element("manage-form").hidden = true;
  element("show-create").setAttribute("aria-expanded", "false");
  element("show-manage").setAttribute("aria-expanded", "false");
  if (returnFocus) element(returnFocus === "create" ? "show-create" : "show-manage").focus();
}

async function mutate(operation, message) {
  if (busy) return;
  busy = true;
  setDisabled(true);
  try { await operation(); await load(); setStatus(message); }
  catch (error) { setStatus(error.message, true); }
  finally { busy = false; setDisabled(false); }
}

function setDisabled(value) { document.querySelectorAll("button,input").forEach(node => { node.disabled = value; }); }
function setStatus(message, error = false) { element("status").textContent = message; element("status").classList.toggle("error", error); }

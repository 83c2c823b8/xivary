import { RepositoryClient } from "../repository/repository-client.js";
import { paperRow } from "../ui/paper-row.js";
import { openPaperCollectionPicker } from "../ui/paper-collection-picker.js";

const repository = new RepositoryClient();
const element = id => document.getElementById(id);
let library;
let selected = "";
let busy = false;

element("filter").addEventListener("input", render);
element("collection-filter").addEventListener("change", () => { selected = element("collection-filter").value; render(); });
element("create-form").addEventListener("submit", event => {
  event.preventDefault();
  void mutate(async () => {
    const collection = await repository.createPaperCollection(element("collection-name").value);
    selected = collection.id;
    element("collection-name").value = "";
  }, "Collection created.");
});
element("manage-form").addEventListener("submit", event => {
  event.preventDefault();
  void mutate(() => repository.renamePaperCollection(selected, element("rename-name").value), "Collection renamed.");
});
element("delete").addEventListener("click", () => void mutate(async () => {
  await repository.deletePaperCollection(selected);
  selected = "";
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
  const filter = element("collection-filter");
  filter.replaceChildren(
    new Option(`All Saved (${library.papers.length})`, ""),
    ...library.collections.map(collection => new Option(`${collection.name} (${library.memberships.filter(item => item.collectionId === collection.id).length})`, collection.id)),
  );
  filter.value = selected;
  element("manage-form").hidden = !selected;
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

async function managePaper(paper, button) {
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  await openPaperCollectionPicker({ repository, paper, anchor: button, onChange: load });
}

async function mutate(operation, message) {
  if (busy) return;
  busy = true;
  setDisabled(true);
  try { await operation(); await load(); setStatus(message); }
  catch (error) { setStatus(error.message, true); }
  finally { busy = false; setDisabled(false); }
}

function setDisabled(value) { document.querySelectorAll("button,input,select").forEach(node => { node.disabled = value; }); }
function setStatus(message, error = false) { element("status").textContent = message; element("status").classList.toggle("error", error); }

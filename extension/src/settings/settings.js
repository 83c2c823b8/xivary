import { RepositoryClient } from "../repository/repository-client.js";

const repository = new RepositoryClient();
const element = id => document.getElementById(id);
const controls = {
  "open-author-new-tab": { key: "openAuthorResultsInNewTab", save: enabled => repository.setOpenAuthorResultsInNewTab(enabled) },
  "open-arxiv-new-tab": {
    key: "openArxivLinksInNewTab",
    save: enabled => repository.setOpenArxivLinksInNewTab(enabled),
  },
  "organize-author-collections": {
    key: "organizeFollowedAuthorsIntoCollections",
    save: enabled => repository.setOrganizeFollowedAuthorsIntoCollections(enabled),
  },
};

for (const [id, preference] of Object.entries(controls)) {
  element(id).addEventListener("change", event => void update(event.currentTarget, preference));
}
let selectedCategory = null;
let exportCategory = null;
let exportTrigger = null;
let exportInProgress = false;
for (const button of document.querySelectorAll("[data-export]")) {
  button.addEventListener("click", () => void openExport(button));
}
for (const button of document.querySelectorAll("[data-import]")) {
  button.addEventListener("click", () => {
    selectedCategory = button.dataset.import;
    element("import-file").click();
  });
}
element("import-file").addEventListener("change", event => void importData(event.currentTarget));
element("cancel-export").addEventListener("click", () => element("export-dialog").close());
element("confirm-export").addEventListener("click", () => void exportData());
element("export-dialog").addEventListener("cancel", event => { if (exportInProgress) event.preventDefault(); });
element("export-dialog").addEventListener("close", () => exportTrigger?.focus());
void load();
window.addEventListener("focus", () => {
  if (!Object.keys(controls).some(id => element(id).disabled)) void load();
});

async function load() {
  setDisabled(true);
  try {
    const preferences = await repository.getPreferences();
    for (const [id, preference] of Object.entries(controls)) element(id).checked = preferences[preference.key];
    setStatus("");
  } catch (error) { setStatus(error.message, true); }
  finally { setDisabled(false); }
}

async function update(input, preference) {
  const requested = input.checked;
  input.disabled = true;
  try {
    const saved = await preference.save(requested);
    input.checked = saved[preference.key];
    setStatus("");
  } catch (error) {
    input.checked = !requested;
    setStatus(error.message, true);
  } finally { input.disabled = false; }
}

function setDisabled(value) { Object.keys(controls).forEach(id => { element(id).disabled = value; }); }
function setStatus(message, error = false) { element("status").textContent = message; element("status").classList.toggle("error", error); }

async function openExport(button) {
  const category = button.dataset.export;
  button.disabled = true;
  try {
    const library = category === "bookmarks" ? await repository.getPaperLibrary() : await repository.getAuthorLibrary();
    const selector = element("export-selection");
    selector.replaceChildren();
    selector.add(new Option(`All ${category}`, "all"));
    for (const collection of library.collections) selector.add(new Option(collection.name, collection.id));
    element("export-heading").textContent = `Export ${label(category)}`;
    exportCategory = category;
    exportTrigger = button;
    element("export-dialog").showModal();
  } catch (error) { setStatus(`${label(category)} export failed: ${error.message}`, true); }
  finally { button.disabled = false; }
}

async function exportData() {
  const category = exportCategory;
  const selected = element("export-selection");
  const collectionId = selected.value;
  const selection = collectionId === "all" ? { kind: "all" } : { kind: "collection", collectionId };
  const scopeName = selected.selectedOptions[0].textContent;
  const button = element("confirm-export");
  exportInProgress = true;
  button.disabled = true;
  element("cancel-export").disabled = true;
  try {
    const backup = await repository.exportCategory(category, selection);
    const blob = new Blob([JSON.stringify(backup, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const suffix = selection.kind === "all" ? "all" : "collection";
    link.download = `xivary-${category}-${suffix}-${backup.exportedAt.slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    element("export-dialog").close();
    setStatus(`${scopeName} exported.`);
  } catch (error) { setStatus(`${label(category)} export failed: ${error.message}`, true); }
  finally { exportInProgress = false; button.disabled = false; element("cancel-export").disabled = false; }
}

async function importData(input) {
  const category = selectedCategory;
  selectedCategory = null;
  const button = document.querySelector(`[data-import="${category}"]`);
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  button.disabled = true;
  try {
    const result = await repository.importCategory(await file.text(), category);
    await load();
    setStatus(`${result.importedScope} imported into ${label(category)}.`);
  } catch (error) { setStatus(`${label(category)} import failed: ${error.message}`, true); }
  finally { button.disabled = false; }
}

function label(category) { return category[0].toUpperCase() + category.slice(1); }

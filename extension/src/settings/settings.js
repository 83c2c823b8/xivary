import { decodeBase64, encodeBase64, MAX_BACKUP_BYTES } from '../repository/backup-zip.js';
import { bindVimMode } from "../ui/vim-mode.js";
import { bindSettingsToc } from "../ui/settings-toc.js";
import { parseLatexMacros } from "../domain/latex.js";
import { RepositoryClient } from "../repository/repository-client.js";

const repository = new RepositoryClient();
bindVimMode(repository);
bindSettingsToc();
const element = id => document.getElementById(id);
const controls = {
  "vim-mode": { key: "vimMode", save: enabled => repository.setVimMode(enabled) },
  "render-latex": { key: "renderLatexInAbstracts", save: enabled => repository.setRenderLatexInAbstracts(enabled) },
  "open-toolbar-new-tab": { key: "openXivaryFromToolbarInNewTab", save: enabled => repository.setOpenXivaryFromToolbarInNewTab(enabled) },
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
let macrosLoaded = false;
let macrosDirty = false;
let macrosBusy = false;
element("latex-macros").addEventListener("input", () => { macrosDirty = true; });
element("macros-form").addEventListener("submit", event => { event.preventDefault(); void saveMacros(); });
repository.subscribeOffline(() => { void loadOfflineUsage(); });
async function loadOfflineUsage() {
  try {
    const data = await repository.getOfflineLibrary();
    element("offline-usage").textContent = `${data.count} offline ${data.count === 1 ? "paper" : "papers"} · ${(data.size / 1048576).toFixed(1)} MB of PDFs${data.localUsage === null ? "" : ` · ${(data.localUsage / 1048576).toFixed(1)} MB local storage (estimated)`}`;
  } catch (error) { element("offline-usage").textContent = error.message; }
}
void load();
const unsubscribe = repository.subscribePreferences(() => {
  if (!Object.keys(controls).some(id => element(id).disabled)) void load();
});
window.addEventListener("pagehide", event => { if (!event.persisted) unsubscribe(); });
window.addEventListener("focus", () => {
  if (!Object.keys(controls).some(id => element(id).disabled)) void load();
});

async function load() {
  void loadOfflineUsage();
  const focused = document.activeElement;
  setDisabled(true);
  try {
    const preferences = await repository.getPreferences();
    for (const [id, preference] of Object.entries(controls)) element(id).checked = preferences[preference.key];
    if (!macrosLoaded || (!macrosDirty && !macrosBusy)) {
      element("latex-macros").value = preferences.customLatexMacros;
      macrosLoaded = true;
    }
    setStatus("");
  } catch (error) { setStatus(error.message, true); }
  finally {
    setDisabled(false);
    restoreToggleFocus(focused);
    if (macrosLoaded && !macrosBusy) element("save-macros").disabled = element("latex-macros").disabled = false;
  }
}

async function update(input, preference) {
  const focused = document.activeElement;
  const requested = input.checked;
  input.disabled = true;
  try {
    const saved = await preference.save(requested);
    input.checked = saved[preference.key];
    setStatus("");
  } catch (error) {
    input.checked = !requested;
    setStatus(error.message, true);
  } finally { input.disabled = false; restoreToggleFocus(focused); }
}

function restoreToggleFocus(input) {
  if (input?.matches(".toggle-input") && input.isConnected && !input.disabled && document.activeElement === document.body) input.focus({ preventScroll: true });
}

function setDisabled(value) { Object.keys(controls).forEach(id => { element(id).disabled = value; }); }
function setStatus(message, error = false) { element("status").textContent = message; element("status").classList.toggle("error", error); }

async function openExport(button) {
  const category = button.dataset.export;
  button.disabled = true;
  try {
    const library = category === "all" ? null : category === "bookmarks" ? await repository.getPaperLibrary() : await repository.getAuthorLibrary();
    const selector = element("export-selection");
    selector.replaceChildren();
    selector.add(new Option(category === "all" ? "All research data" : `All ${category}`, "all"));
    if (library) {
      const collections = document.createElement('optgroup'); collections.label = 'Collections';
      for (const collection of library.collections) collections.append(new Option(collection.name, collection.id));
      selector.append(collections);
    }
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
    const backup = await repository.exportBackup(category, selection);
    const blob = new Blob([backup.base64 ? decodeBase64(backup.base64) : backup.text], { type: backup.mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = backup.filename;
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
  const files = [...(input.files || [])];
  input.value = '';
  if (!files.length) return;
  const buttons = [...document.querySelectorAll('[data-import]')];
  buttons.forEach(button => { button.disabled = true; });
  try {
    if (files.reduce((size,file) => size + file.size, 0) > MAX_BACKUP_BYTES) throw new Error('Selected backups exceed 20 MiB.');
    const inputs = [];
    for (const file of files) {
      const header = new Uint8Array(await file.slice(0,4).arrayBuffer());
      const zip = file.name.toLowerCase().endsWith('.zip') || (header[0]===0x50 && header[1]===0x4b && header[2]===3 && header[3]===4);
      inputs.push(zip ? { kind: 'zip', data: encodeBase64(new Uint8Array(await file.arrayBuffer())) } : { kind: 'json', data: await file.text() });
    }
    const result = await repository.importBackup(inputs, category);
    await load();
    setStatus(`${result.imported} imported, ${result.merged} merged, ${result.skipped} skipped, ${result.invalid} invalid${result.conflicts ? `; ${result.conflicts} conflicting fields kept or names disambiguated` : ''}.`);
  } catch (error) { setStatus(`${label(category)} import failed: ${error.message} No records imported.`, true); }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}

function label(category) { if (category === "all") return "All research data"; return category[0].toUpperCase() + category.slice(1); }

async function saveMacros() {
  if (macrosBusy || !macrosLoaded) return;
  const input = element("latex-macros");
  const status = element("macros-status");
  try {
    parseLatexMacros(input.value);
    macrosBusy = true;
    element("save-macros").disabled = input.disabled = true;
    const saved = await repository.setCustomLatexMacros(input.value);
    input.value = saved.customLatexMacros;
    macrosDirty = false;
    input.removeAttribute("aria-invalid");
    status.textContent = "Macros saved.";
    status.classList.remove("error");
  } catch (error) {
    input.setAttribute("aria-invalid", "true");
    status.textContent = error.message;
    status.classList.add("error");
  } finally {
    macrosBusy = false;
    element("save-macros").disabled = input.disabled = false;
  }
}

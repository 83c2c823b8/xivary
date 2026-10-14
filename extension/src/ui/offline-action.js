import { anchorPicker } from "./popover-position.js";

const coordinators = new WeakMap();
const widgetKey = Symbol("offlineWidget");
let activeMenu;
function coordinator(repository) {
  if (coordinators.has(repository)) return coordinators.get(repository);
  const widgets = new Set(); let snapshot; let pending; let dirty = false;
  async function refresh() {
    if (pending) { dirty = true; return pending; }
    pending = repository.getOfflineLibrary().then(value => {
      snapshot = value;
      for (const reference of widgets) {
        const widget = reference.deref();
        if (!widget) { widgets.delete(reference); continue; }
        widget.update(value);
      }
    }).catch(error => { for (const reference of widgets) reference.deref()?.error(error.message); }).finally(() => { pending = null; if (dirty) { dirty = false; void refresh(); } });
    return pending;
  }
  const unsubscribe = repository.subscribeOffline(() => { void refresh(); });
  window.addEventListener("focus", refresh);
  window.addEventListener("pagehide", event => { if (!event.persisted) { unsubscribe(); activeMenu?.(); window.removeEventListener("focus", refresh); } });
  const value = { widgets, refresh, get snapshot() { return snapshot; } };
  coordinators.set(repository, value); return value;
}

export function offlineAction(paper, repository, { onChange = async () => {}, allowExport = false } = {}) {
  const button = document.createElement("button"); button.type = "button"; button.className = "offline-action";
  button.setAttribute("aria-haspopup", "menu"); button.setAttribute("aria-expanded", "false");
  let copy, operation, localError, busy = false;
  const group = coordinator(repository);
  function paint() {
    const state = localError ? "error" : operation?.status || (copy ? "saved" : "empty");
    button.dataset.state = state;
    const label = state === "saving" ? "Saving for offline reading" : state === "error" ? "Offline save failed; retry" : copy ? "Available offline" : "Save for offline reading";
    button.title = localError || operation?.error || (copy ? `${label} (${copy.versionedId})` : label);
    button.setAttribute("aria-label", `${label}: ${paper.title}`);
    button.setAttribute("aria-busy", String(state === "saving"));
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${state === "saved" ? '<path d="m5 12 4 4L19 6M4 20h16"/>' : state === "error" ? '<path d="M12 4v9m0 4v1M4 21h16"/>' : '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>'}</svg>`;
  }
  const widget = { button, update(value) { localError = null; copy = value.copies.find(c => c.arxivId === paper.arxivId); operation = value.operations[paper.arxivId]; paint(); }, error(message) { localError = message; paint(); } };
  button[widgetKey] = widget;
  group.widgets.add(new WeakRef(widget)); paint(); if (group.snapshot) widget.update(group.snapshot); void group.refresh();
  async function act(action, concurrent = false) {
    if (busy && !concurrent) return;
    const ownsBusy = !busy;
    if (ownsBusy) busy = true;
    localError = null;
    try { await action(); await group.refresh(); await onChange(); localError = null; }
    catch (error) { localError = error.message; }
    finally { if (ownsBusy) busy = false; paint(); }
  }
  function save(update = false) {
    operation = { status: "saving" }; paint();
    return repository.saveOfflinePaper(paper, update);
  }
  button.addEventListener("click", async () => {
    if (!copy && !operation && !localError) {
      await act(() => save()); return;
    }
    activeMenu?.();
    const menu = document.createElement("div"); menu.className = "offline-menu"; menu.setAttribute("role", "menu");
    button.setAttribute("aria-expanded", "true");
    let cleanup = () => {};
    const close = () => { cleanup(); menu.remove(); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", key, true); button.setAttribute("aria-expanded", "false"); activeMenu = null; if (button.isConnected) button.focus(); };
    const outside = event => { if (!menu.contains(event.target) && !button.contains(event.target)) close(); };
    const key = event => {
      const items = [...menu.querySelectorAll("button")];
      if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); } close(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); const index = items.indexOf(document.activeElement);
        items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }
    };
    function item(label, action, concurrent = false) {
      const node = document.createElement("button"); node.type = "button"; node.textContent = label; node.setAttribute("role", "menuitem");
      node.addEventListener("click", () => { close(); void act(action, concurrent); }); menu.append(node); return node;
    }
    if (copy) {
      const detail = document.createElement("span"); detail.className = "offline-detail"; detail.textContent = `${copy.versionedId} · ${(copy.size / 1048576).toFixed(1)} MB`; menu.append(detail);
      item("Read offline", () => repository.openOfflinePaper(paper.arxivId));
      if (operation?.status !== "saving") item("Update offline copy", () => save(true));
      if (allowExport) item("Export PDF", async () => {
        const { copy: saved, blob } = await repository.readOfflinePdf(paper.arxivId);
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = `${saved.versionedId.replaceAll("/", "_")}.pdf`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      });
      // Small inline confirmation; bookmark and existing Undo receipts are untouched.
      const confirmation = document.createElement("button"); confirmation.type = "button";
      confirmation.setAttribute("role", "menuitem"); confirmation.textContent = "Remove offline copy…"; menu.append(confirmation);
      let armed = false;
      confirmation.addEventListener("click", () => {
        if (!armed) { armed = true; confirmation.textContent = "Confirm removal"; return; }
        close(); void act(() => repository.removeOfflineCopy(paper.arxivId), true);
      });
    }
    if (operation?.status === "saving") item("Cancel offline save", () => repository.cancelOfflineSave(paper.arxivId), true);
    else if (!copy || operation?.status === "error" || localError) item(copy ? "Retry update" : "Save for offline reading", () => save(Boolean(copy)));
    if (localError || operation?.error) { const detail = document.createElement("span"); detail.className = "offline-detail"; detail.textContent = localError || operation.error; menu.append(detail); }
    document.body.append(menu); activeMenu = close; cleanup = anchorPicker(menu, button, close);
    document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", key, true); menu.querySelector("button")?.focus();
  });
  return button;
}

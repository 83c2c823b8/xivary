/** Native modal dialog; persistence is supplied by the existing page mutation. */
export function confirmCollectionDeletion(entry, consequence, remove, onClose = () => {}) {
  const invoker = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "collection-delete-dialog";
  const heading = document.createElement("h2"); heading.textContent = `Delete “${entry.name}”?`;
  const description = document.createElement("p"); description.textContent = consequence;
  description.id = "xivary-collection-delete-description";
  dialog.setAttribute("aria-describedby", description.id);
  dialog.setAttribute("aria-label", heading.textContent);
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const actions = document.createElement("div"); actions.className = "dialog-actions";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; cancel.className = "button-secondary";
  const confirm = document.createElement("button"); confirm.type = "button"; confirm.textContent = "Delete"; confirm.className = "button-danger";
  confirm.dataset.confirmId = entry.id;
  let busy = false;
  let closed = false;
  function close() {
    if (closed) return;
    closed = true; dialog.close(); dialog.remove(); onClose();
    if (document.activeElement === document.body) {
      if (invoker?.isConnected && !invoker.disabled) invoker.focus();
      else document.querySelector(".collection-link[aria-current], #show-create")?.focus();
    }
  }
  cancel.addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); if (!busy) close(); });
  confirm.addEventListener("click", async () => {
    if (busy) return;
    busy = true; confirm.disabled = cancel.disabled = true;
    try { await remove(); close(); }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; confirm.disabled = cancel.disabled = false; }
  });
  dialog.addEventListener("close", close);
  actions.append(cancel, confirm);
  dialog.append(heading, description, status, actions);
  document.body.append(dialog); dialog.showModal(); cancel.focus();
}

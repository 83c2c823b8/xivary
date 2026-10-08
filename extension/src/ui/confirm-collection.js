/** Native modal dialog; persistence is supplied by the existing page mutation. */
export function confirmCollectionDeletion(entry, consequence, remove, onClose = () => {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "collection-delete-dialog";
  const heading = document.createElement("h2"); heading.textContent = `Delete “${entry.name}”?`;
  const description = document.createElement("p"); description.textContent = consequence;
  dialog.setAttribute("aria-label", heading.textContent);
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel";
  const confirm = document.createElement("button"); confirm.type = "button"; confirm.textContent = "Delete";
  confirm.dataset.confirmId = entry.id;
  let busy = false;
  let closed = false;
  function close() {
    if (closed) return;
    closed = true; dialog.close(); dialog.remove(); onClose();
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
  dialog.append(heading, description, status, cancel, confirm);
  document.body.append(dialog); dialog.showModal(); cancel.focus();
}

import { showUndo } from "./undo.js";
let closeCurrent = () => {};

export function closeAuthorCollectionPicker() { closeCurrent(); }

/** Optional author-collection UI. Persistence stays behind RepositoryClient. */
export async function openAuthorCollectionPicker({ repository, author, anchor, onChange, onClose = () => {} }) {
  closeCurrent();
  const panel = document.createElement("div");
  panel.className = "arxiv-collection-picker";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `Collections for ${author.displayName}`);
  panel.tabIndex = -1;
  const heading = document.createElement("div");
  heading.className = "collection-picker-heading";
  const title = document.createElement("strong");
  title.textContent = author.displayName;
  const done = document.createElement("button");
  done.type = "button";
  done.textContent = "Done";
  heading.append(title, done);
  const status = document.createElement("p");
  status.className = "collection-picker-status";
  status.setAttribute("role", "status");
  const choices = document.createElement("div");
  const form = document.createElement("form");
  const name = document.createElement("input");
  name.type = "text";
  name.required = true;
  name.maxLength = 80;
  name.placeholder = "New collection name";
  name.setAttribute("aria-label", "New collection name");
  const create = document.createElement("button");
  create.type = "submit";
  create.textContent = "+ New collection";
  form.append(name, create);
  const hint = document.createElement("p");
  hint.className = "collection-picker-subtitle";
  hint.textContent = "Removing the last collection unfollows this author. To move, select the destination first.";
  panel.append(heading, hint, status, choices, form);
  document.body.append(panel);
  anchor.setAttribute("aria-expanded", "true");
  const rect = anchor.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 316))}px`;
  panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - Math.min(360, innerHeight - 16)))}px`;
  panel.focus();
  let busy = false;
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    panel.remove();
    anchor.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("keydown", escape);
    if (anchor.isConnected) anchor.focus();
    onClose();
  }
  function outside(event) { if (!panel.contains(event.target) && !anchor.contains(event.target)) close(); }
  function escape(event) { if (event.key === "Escape") { event.preventDefault(); close(); } }
  closeCurrent = close;
  done.addEventListener("click", close);
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", escape);

  async function render(focusId) {
    const library = await repository.getAuthorLibrary();
    if (closed) return;
    const selected = new Set(library.memberships.filter(item => item.authorId === author.id).map(item => item.collectionId));
    choices.replaceChildren();
    for (const collection of library.collections) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = collection.id;
      checkbox.checked = selected.has(collection.id);
      checkbox.addEventListener("change", () => change(async () => {
        if (checkbox.checked) await repository.addAuthorToCollection(author, collection.id);
        else {
          const result = await repository.removeAuthorFromCollection(author.id, collection.id);
          showUndo(repository, result, "Removed from collection.", async () => { await render(); await onChange(); });
        }
      }, collection.id));
      label.append(checkbox, document.createTextNode(collection.name));
      choices.append(label);
    }
    if (!library.collections.length) choices.textContent = "Create a collection to follow this author.";
    if (focusId) [...choices.querySelectorAll("input")].find(input => input.value === focusId)?.focus();
  }

  async function change(operation, focusId) {
    if (busy) return;
    busy = true;
    panel.querySelectorAll("input, button[type=submit]").forEach(node => { node.disabled = true; });
    status.textContent = "Saving…";
    try {
      await operation();
      await render(focusId);
      await onChange();
      status.textContent = "";
    } catch (error) {
      await render(focusId).catch(() => {});
      status.textContent = error.message;
    } finally {
      busy = false;
      panel.querySelectorAll("input, button[type=submit]").forEach(node => { node.disabled = false; });
    }
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    void change(async () => { await repository.createAuthorCollection(name.value, author); name.value = ""; });
  });
  try { await render(); }
  catch (error) { status.textContent = error.message; }
}

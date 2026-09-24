let closeCurrent = () => {};

/** Shared paper-membership editor. Persistence stays behind PaperRepository. */
export async function openPaperCollectionPicker({ repository, paper, anchor, onChange }) {
  closeCurrent();
  const panel = document.createElement("div");
  panel.className = "arxiv-collection-picker";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `Save ${paper.title} to collections`);
  panel.tabIndex = -1;
  const heading = document.createElement("div");
  heading.className = "collection-picker-heading";
  const title = document.createElement("strong");
  title.textContent = "Save to…";
  const done = document.createElement("button");
  done.type = "button";
  done.textContent = "Done";
  heading.append(title, done);
  const paperTitle = document.createElement("p");
  paperTitle.className = "collection-picker-subtitle";
  paperTitle.textContent = paper.title;
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
  panel.append(heading, paperTitle, status, choices, form);
  document.body.append(panel);
  anchor.setAttribute("aria-expanded", "true");
  const rect = anchor.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 316))}px`;
  panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - Math.min(380, innerHeight - 16)))}px`;
  panel.focus();
  let busy = false;
  let closed = false;

  function close() {
    closed = true;
    panel.remove();
    anchor.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("keydown", escape);
    if (anchor.isConnected) anchor.focus();
  }
  function outside(event) { if (!panel.contains(event.target) && !anchor.contains(event.target)) close(); }
  function escape(event) { if (event.key === "Escape") { event.preventDefault(); close(); } }
  closeCurrent = close;
  done.addEventListener("click", close);
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", escape);

  async function render(focusId) {
    const library = await repository.getPaperLibrary();
    if (closed) return;
    const selected = new Set(library.memberships.filter(item => item.arxivId === paper.arxivId).map(item => item.collectionId));
    choices.replaceChildren();
    for (const collection of library.collections) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = collection.id;
      checkbox.checked = selected.has(collection.id);
      checkbox.addEventListener("change", () => change(async () => {
        if (checkbox.checked) await repository.addPaperToCollection(paper, collection.id);
        else await repository.removePaperFromCollection(paper.arxivId, collection.id);
      }, collection.id));
      label.append(checkbox, document.createTextNode(collection.name));
      choices.append(label);
    }
    if (!library.collections.length) choices.textContent = "Create a collection to save this paper.";
    if (focusId) [...choices.querySelectorAll("input")].find(input => input.value === focusId)?.focus();
  }

  async function change(operation, focusId) {
    if (busy) return;
    busy = true;
    panel.querySelectorAll("input, button[type=submit]").forEach(node => { node.disabled = true; });
    status.textContent = "Saving…";
    try {
      const result = await operation();
      await render(focusId || result?.id);
      await onChange();
      status.textContent = "Updated.";
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
    void change(async () => {
      const collection = await repository.createPaperCollection(name.value, paper);
      name.value = "";
      return collection;
    });
  });
  try { await render(); }
  catch (error) { status.textContent = error.message; }
}

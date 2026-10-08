/** Sidebar creation has one submission path, no blur-based creation. */
export function bindCollectionCreate({ trigger, form, input, create, onOpen = () => {} }) {
  let busy = false;
  function close(returnFocus = false) {
    if (busy) return;
    form.hidden = true;
    trigger.hidden = false;
    trigger.setAttribute("aria-expanded", "false");
    input.value = "";
    if (returnFocus) trigger.focus();
  }
  trigger.addEventListener("click", () => {
    onOpen(); trigger.hidden = true; form.hidden = false;
    trigger.setAttribute("aria-expanded", "true"); input.focus();
  });
  async function submit() {
    if (busy) return;
    const name = input.value.trim();
    if (!name) { close(true); return; }
    if (!form.reportValidity()) return;
    busy = true;
    try { await create(name); busy = false; close(); }
    catch { /* Page mutation displays the storage/validation error; keep the form. */ }
    finally { busy = false; }
  }
  form.addEventListener("submit", event => { event.preventDefault(); void submit(); });
  form.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    if (event.key === "Enter") { event.preventDefault(); void submit(); }
  });
  document.addEventListener("pointerdown", event => { if (!form.hidden && !form.contains(event.target) && !trigger.contains(event.target)) close(); });
  return close;
}

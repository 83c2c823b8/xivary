/** Multiple independent receipts expire after eight seconds; nothing is persisted. */
export function showUndo(repository, result, message, onChange = async () => {}) {
  if (!result?.undoToken) return;
  const toast = document.createElement("div");
  toast.className = "xivary-undo";
  toast.setAttribute("role", "status");
  const label = document.createElement("span");
  label.textContent = message;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Undo";
  toast.append(label, button);
  let stack = document.querySelector(".xivary-undo-stack");
  if (!stack) { stack = document.createElement("div"); stack.className = "xivary-undo-stack"; document.body.append(stack); }
  stack.append(toast);
  const dismiss = () => { toast.remove(); if (!stack.children.length) stack.remove(); };
  const timer = setTimeout(dismiss, 8000);
  let busy = false;
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    let restored = false;
    try {
      await repository.undoRemoval(result.undoToken);
      restored = true;
      await onChange();
      clearTimeout(timer); dismiss();
    } catch (error) {
      label.textContent = error.message;
      if (restored) button.remove(); // A refresh failure must not repeat a committed Undo.
      else { busy = false; button.disabled = repository.available === false; }
    }
  });
}

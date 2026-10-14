const visible = new Map();
export const UNDO_NOTICE_MS = 3000;

/** Visible time only; background-owned receipt expiry remains unchanged. */
export function dismissalTimer(dismiss, { now = Date.now,
  setTimer = (...args) => setTimeout(...args), clearTimer = timer => clearTimeout(timer) } = {}) {
  let remaining = UNDO_NOTICE_MS, started = now(), timer, stopped = false;
  const pauses = new Set();
  const schedule = () => {
    if (stopped || pauses.size || timer !== undefined) return;
    started = now(); timer = setTimer(() => { timer = undefined; stopped = true; dismiss(); }, remaining);
  };
  schedule();
  return {
    pause(reason) {
      if (stopped || pauses.has(reason)) return;
      pauses.add(reason);
      if (timer !== undefined) { clearTimer(timer); timer = undefined; remaining = Math.max(0, remaining - (now() - started)); }
    },
    resume(reason) { pauses.delete(reason); schedule(); },
    stop() { stopped = true; if (timer !== undefined) clearTimer(timer); timer = undefined; },
  };
}

/** Independent, nonpersistent Undo notices never change receipt/data rules. */
export function showUndo(repository, result, message, onChange = async () => {}) {
  if (!result?.undoToken || visible.has(result.undoToken)) return;
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
  visible.set(result.undoToken, toast);
  const dismiss = () => {
    timer.stop(); visible.delete(result.undoToken); toast.remove();
    if (!stack.children.length) stack.remove();
    window.removeEventListener('pagehide', dismiss);
  };
  const timer = dismissalTimer(dismiss);
  toast.addEventListener('pointerenter', () => timer.pause('hover'));
  toast.addEventListener('pointerleave', () => timer.resume('hover'));
  toast.addEventListener('focusin', () => timer.pause('focus'));
  toast.addEventListener('focusout', event => { if (!toast.contains(event.relatedTarget)) timer.resume('focus'); });
  window.addEventListener('pagehide', dismiss, { once: true });
  let busy = false;
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    timer.pause('busy');
    button.disabled = true;
    let restored = false;
    try {
      await repository.undoRemoval(result.undoToken);
      restored = true;
      await onChange();
      dismiss();
    } catch (error) {
      label.textContent = error.message;
      if (restored) button.remove(); // A refresh failure must not repeat a committed Undo.
      else { busy = false; button.disabled = repository.available === false; }
    } finally { timer.resume('busy'); }
  });
}

// Internal pages opt in explicitly. No content-script or popup entry point.
export const HINT_ALPHABET = "asdfghjk";
export const SEQUENCE_TIMEOUT = 650;
const EDITABLE = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="spinbutton"],[role="slider"]';
const ACTIONABLE = 'a[href],button,input:not([type="hidden"]),textarea,select,[contenteditable="true"],[role="button"][tabindex],[role="link"][tabindex]';

/** Equal-length base-N labels are prefix-free, including beyond one alphabet. */
export function hintLabels(count) {
  const width = Math.max(1, Math.ceil(Math.log(Math.max(1, count)) / Math.log(HINT_ALPHABET.length)));
  return Array.from({ length: count }, (_, index) => {
    let label = "";
    for (let position = 0; position < width; position++) {
      label = HINT_ALPHABET[index % HINT_ALPHABET.length] + label;
      index = Math.floor(index / HINT_ALPHABET.length);
    }
    return label;
  });
}

export function editable(target) { return Boolean(target?.closest?.(EDITABLE)); }
export function unsafeKey(event) {
  return event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.keyCode === 229;
}

function rendered(node, view) {
  if (!node.isConnected || node.closest('[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"]') || node.matches(':disabled')) return false;
  const style = view.getComputedStyle(node);
  return style.display !== "none" && style.visibility === "visible" && style.opacity !== "0" && node.getClientRects().length > 0;
}

export function hintTargets(doc, view) {
  return [...doc.querySelectorAll(ACTIONABLE)].filter(node => {
    if (!rendered(node, view) || node.closest('[data-vim-overlay]')) return false;
    // Test actual fragments: a wrapped link's bounding-box center can be prose
    // whitespace, even when the link itself is visible and actionable.
    return [...node.getClientRects()].some(rect => {
      const left = Math.max(0, rect.left), right = Math.min(doc.documentElement.clientWidth, rect.right);
      const top = Math.max(0, rect.top), bottom = Math.min(view.innerHeight, rect.bottom);
      if (right <= left || bottom <= top) return false;
      const hit = doc.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      return hit === node || node.contains(hit);
    });
  });
}

function transient(doc, view) {
  return [...doc.querySelectorAll('dialog[open],[role="dialog"],[role="menu"],[role="listbox"],form')]
    .some(node => rendered(node, view));
}

export function scrollDestination(key, top, height, total) {
  const max = Math.max(0, total - height);
  const delta = { j: 80, k: -80, d: height / 2, u: -height / 2 }[key];
  return Math.max(0, Math.min(max, key === "gg" ? 0 : key === "G" ? max : top + delta));
}

export function bindVimMode(repository, doc = document, view = window) {
  let enabled = false, disposed = false, composing = false, sequenceTimer = null;
  let hints = null, prefix = "", newTab = false, observer = null, help = null;
  let revision = 0;
  const resetSequence = () => { view.clearTimeout(sequenceTimer); sequenceTimer = null; };
  const cancelHints = () => {
    observer?.disconnect(); observer = null;
    hints?.overlay.remove(); hints = null; prefix = "";
  };
  const cancel = () => { resetSequence(); cancelHints(); help?.close(); };
  async function refresh() {
    const current = ++revision;
    try {
      const preferences = await repository.getPreferences();
      if (disposed || current !== revision) return;
      enabled = preferences.vimMode === true;
      if (!enabled) cancel();
    } catch {
      // An unavailable repository must never enable shortcuts by assumption.
      if (disposed || current !== revision) return;
      enabled = false; cancel();
    }
  }
  const unsubscribe = repository.subscribePreferences(refresh);

  function showHints(openInNewTab) {
    resetSequence(); cancelHints();
    const targets = hintTargets(doc, view);
    if (!targets.length) return;
    newTab = openInNewTab;
    const overlay = doc.createElement("div");
    overlay.dataset.vimOverlay = "hints";
    overlay.setAttribute("aria-hidden", "true");
    const labels = hintLabels(targets.length);
    const entries = targets.map((target, index) => {
      const node = doc.createElement("span");
      node.className = "vim-hint"; node.dataset.hint = labels[index]; node.textContent = labels[index];
      const rect = target.getBoundingClientRect();
      node.style.left = `${Math.max(2, Math.min(rect.left, doc.documentElement.clientWidth - labels[index].length * 10 - 12))}px`;
      node.style.top = `${Math.max(2, Math.min(rect.top, view.innerHeight - 24))}px`;
      overlay.append(node);
      return { target, label: labels[index], node };
    });
    doc.body.append(overlay); hints = { overlay, entries };
    observer = new view.MutationObserver(records => {
      if (records.some(record => !overlay.contains(record.target))) cancelHints();
    });
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, characterData: true });
  }

  function activate(target) {
    const openInNewTab = newTab;
    cancelHints();
    if (!rendered(target, view) || transient(doc, view)) return;
    target.focus({ preventScroll: true });
    // F overrides the link's tab choice; buttons retain their ordinary action.
    if (openInNewTab && target.matches('a[href]:not([download])') &&
        /^(https?:|chrome-extension:|moz-extension:)$/.test(new URL(target.href).protocol)) {
      const link = doc.createElement("a");
      link.href = target.href; link.target = "_blank"; link.rel = "noopener noreferrer";
      doc.body.append(link); link.click(); link.remove();
    } else if (!editable(target) || target.matches('input[type="checkbox"],input[type="radio"],input[type="button"],input[type="submit"],input[type="reset"]')) target.click();
  }

  function showHelp() {
    resetSequence();
    const invoker = doc.activeElement;
    const dialog = doc.createElement("dialog");
    dialog.className = "vim-help"; dialog.dataset.vimOverlay = "help";
    dialog.setAttribute("aria-labelledby", "vim-help-heading");
    const title = doc.createElement("h2"); title.id = "vim-help-heading"; title.textContent = "Vim Mode";
    const list = doc.createElement("dl");
    for (const [keys, action] of [
      ["j / k", "Scroll down / up"], ["d / u", "Half page down / up"],
      ["gg / G", "Top / bottom"], ["h / l", "Previous / next Xivary tab"],
      ["f / F", "Hints / open links in a new tab"], ["Escape", "Cancel"], ["?", "Shortcut help"],
    ]) {
      const term = doc.createElement("dt"), detail = doc.createElement("dd");
      term.textContent = keys; detail.textContent = action; list.append(term, detail);
    }
    const note = doc.createElement("p"); note.textContent = "F activates buttons normally. Shortcuts pause while editing or using menus and dialogs.";
    const close = doc.createElement("button"); close.type = "button"; close.textContent = "Close";
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => { dialog.remove(); help = null; if (invoker?.isConnected) invoker.focus({ preventScroll: true }); }, { once: true });
    dialog.append(title, list, note, close); doc.body.append(dialog); help = dialog;
    dialog.showModal(); close.focus();
  }

  function keydown(event) {
    if (!enabled || composing || unsafeKey(event)) return;
    if (editable(event.target) || transient(doc, view)) { resetSequence(); cancelHints(); return; }
    const key = event.key;
    if (hints) {
      if (key === "Escape") { event.preventDefault(); cancel(); return; }
      if (key === "Shift") return;
      if (event.repeat) return;
      if (!HINT_ALPHABET.includes(key) || key.length !== 1) { cancelHints(); return; }
      event.preventDefault();
      prefix += key;
      const matches = hints.entries.filter(entry => entry.label.startsWith(prefix));
      for (const entry of hints.entries) entry.node.hidden = !entry.label.startsWith(prefix);
      if (matches.length === 1 && matches[0].label === prefix) activate(matches[0].target);
      else if (!matches.length) cancelHints();
      return;
    }
    if (key === "Escape") {
      if (sequenceTimer !== null) { event.preventDefault(); resetSequence(); }
      return;
    }
    if (key === "g" && !event.repeat) {
      event.preventDefault();
      if (sequenceTimer !== null) { resetSequence(); scroll("gg"); }
      else sequenceTimer = view.setTimeout(resetSequence, SEQUENCE_TIMEOUT);
      return;
    }
    resetSequence();
    if (["j", "k", "G", "d", "u"].includes(key)) { event.preventDefault(); scroll(key); }
    else if (key === "h" || key === "l") {
      const tabs = [...doc.querySelectorAll('.app-nav a[href]')].filter(node => rendered(node, view));
      const current = tabs.findIndex(node => node.getAttribute("aria-current") === "page");
      if (current !== -1) {
        const target = tabs[current + (key === "h" ? -1 : 1)];
        event.preventDefault(); target?.click();
      }
    } else if (!event.repeat && (key === "f" || key === "F")) { event.preventDefault(); showHints(key === "F"); }
    else if (!event.repeat && key === "?") { event.preventDefault(); showHelp(); }
  }

  function scroll(key) {
    const root = doc.scrollingElement;
    // All supported views scroll their document; sidebar/picker scroll is native.
    if (root) view.scrollTo({ top: scrollDestination(key, root.scrollTop, view.innerHeight, root.scrollHeight), behavior: "instant" });
  }
  const compositionStart = () => { composing = true; cancel(); };
  const compositionEnd = () => { composing = false; };
  const focusIn = event => { if (editable(event.target)) { resetSequence(); cancelHints(); } };
  const dismiss = () => { resetSequence(); cancelHints(); };
  const pageHide = event => { if (event.persisted) cancel(); else dispose(); };
  doc.addEventListener("keydown", keydown);
  doc.addEventListener("compositionstart", compositionStart);
  doc.addEventListener("compositionend", compositionEnd);
  doc.addEventListener("focusin", focusIn);
  doc.addEventListener("pointerdown", dismiss);
  view.addEventListener("scroll", dismiss, true);
  view.addEventListener("resize", dismiss);
  view.addEventListener("blur", dismiss);
  view.addEventListener("focus", refresh);
  view.addEventListener("pageshow", refresh);
  function dispose() {
    if (disposed) return;
    disposed = true; revision++; cancel(); unsubscribe();
    doc.removeEventListener("keydown", keydown);
    doc.removeEventListener("compositionstart", compositionStart);
    doc.removeEventListener("compositionend", compositionEnd);
    doc.removeEventListener("focusin", focusIn);
    doc.removeEventListener("pointerdown", dismiss);
    view.removeEventListener("scroll", dismiss, true);
    view.removeEventListener("resize", dismiss);
    view.removeEventListener("blur", dismiss);
    view.removeEventListener("focus", refresh);
    view.removeEventListener("pagehide", pageHide);
    view.removeEventListener("pageshow", refresh);
  }
  view.addEventListener("pagehide", pageHide);
  void refresh();
  return dispose;
}

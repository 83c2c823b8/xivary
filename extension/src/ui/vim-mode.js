// Internal pages opt in explicitly. No content-script or popup entry point.
import { activateAdjacentTab } from '../platform/tab-navigation.js';
export const HINT_ALPHABET = "asdfghjk";
export const SEQUENCE_TIMEOUT = 650;
const EDITABLE = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="spinbutton"],[role="slider"]';
const ACTIONABLE = 'a[href],button,input:not([type="hidden"]),textarea,select,[contenteditable="true"],[role="button"][tabindex],[role="link"][tabindex],label.setting-row';

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
export function escapeAlias(event) {
  return Boolean(event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey &&
    !event.isComposing && event.keyCode !== 229 && (event.key === '[' || event.code === 'BracketLeft'));
}
export function unsafeKey(event) {
  return event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.keyCode === 229;
}

function rendered(node, view) {
  if (!node.isConnected || node.closest('[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"]') || node.matches(':disabled')) return false;
  const style = view.getComputedStyle(node);
  return style.display !== "none" && style.visibility === "visible" && style.opacity !== "0" && node.getClientRects().length > 0;
}

/** Offscreen editors are eligible; focus must not scroll the document. */
export function inputTarget(doc, view) {
  const eligible = node => node && rendered(node, view) && !node.readOnly &&
    !node.closest('dialog:not([open]),[aria-readonly="true"]') &&
    (!node.matches('input') || ['text','search','email','url','tel','password','number'].includes(node.type));
  const preferred = ['#filter', '#paper-query', '#latex-macros'];
  for (const selector of preferred) {
    const node = doc.querySelector(selector);
    if (eligible(node)) return node;
  }
  return [...doc.querySelectorAll('input,textarea,[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"]')].find(eligible);
}

function focusInput(doc, view) {
  const field = inputTarget(doc, view);
  if (!field || field === doc.activeElement || field.contains(doc.activeElement)) return;
  field.focus({ preventScroll: true });
  if (doc.activeElement !== field) return;
  if (field.matches('input,textarea')) {
    // Some textual input types (email/number) do not expose a selection API.
    try { field.setSelectionRange(field.value.length, field.value.length); } catch {}
  } else {
    const range = doc.createRange(); range.selectNodeContents(field); range.collapse(false);
    const selection = view.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }
}

export function hintTargets(doc, view) {
  return [...doc.querySelectorAll(ACTIONABLE)].filter(node => {
    if (node.matches('label.setting-row') && node.querySelector('input')?.disabled) return false;
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
  return [...doc.querySelectorAll('dialog[open],[role="dialog"],[role="menu"],[role="listbox"],[popover],form:not([data-vim-persistent-form])')]
    .some(node => rendered(node, view));
}

export function scrollDestination(key, top, height, total) {
  const max = Math.max(0, total - height);
  const delta = { j: 80, k: -80, d: height / 2, u: -height / 2 }[key];
  return Math.max(0, Math.min(max, key === "gg" ? 0 : key === "G" ? max : top + delta));
}

export const SCROLL_DURATION = 90;
/** One short animation, retargeted in place; never a queue of native animations. */
export function createScrollAnimator(doc, view) {
  let frame = null, motion = null;
  const reduced = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  const cancel = () => {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null; motion = null;
  };
  const unchanged = () => motion && doc.scrollingElement === motion.root &&
    view.innerHeight === motion.height && motion.root.scrollHeight === motion.total &&
    Math.abs(motion.root.scrollTop - motion.written) <= 1;
  const write = top => {
    view.scrollTo({ top, behavior: 'instant' });
    motion.written = motion.root.scrollTop; // Browsers round fractional offsets.
  };
  function tick(now) {
    frame = null;
    if (!unchanged()) { cancel(); return; }
    const progress = reduced?.matches ? 1 : Math.min(1, (now - motion.started) / SCROLL_DURATION);
    write(motion.from + (motion.target - motion.from) * (1 - (1 - progress) ** 3));
    if (progress >= 1 || Math.abs(motion.root.scrollTop - motion.target) < 0.5) {
      write(motion.target); motion = null;
    } else frame = view.requestAnimationFrame(tick);
  }
  function move(key) {
    if (!unchanged()) cancel();
    const root = doc.scrollingElement;
    if (!root) return;
    const direction = key === 'j' ? 1 : -1;
    // Reversal drops the old directional backlog and responds from the live
    // position; repeated presses in the same direction accumulate 80px targets.
    const base = motion?.direction === direction ? motion.target : root.scrollTop;
    const target = scrollDestination(key, base, view.innerHeight, root.scrollHeight);
    if (target === root.scrollTop) { cancel(); return; }
    if (motion?.target === target) return; // No work for repeated boundary presses.
    const from = root.scrollTop;
    // Interrupt an in-progress native TOC smooth scroll at its live position.
    if (!motion) view.scrollTo({ top: from, behavior: 'instant' });
    motion = { root, from, target, direction, height: view.innerHeight, total: root.scrollHeight,
      written: from, started: view.performance.now() };
    if (reduced?.matches) { write(target); cancel(); }
    else if (frame === null) frame = view.requestAnimationFrame(tick);
  }
  return { move, cancel };
}

export function bindVimMode(repository, doc = document, view = window, switchTab = activateAdjacentTab) {
  let enabled = false, disposed = false, composing = false, sequenceTimer = null;
  let hints = null, prefix = "", newTab = false, observer = null, help = null;
  let revision = 0;
  let switchingTab = false;
  const scrolling = createScrollAnimator(doc, view);
  const resetSequence = () => { view.clearTimeout(sequenceTimer); sequenceTimer = null; };
  const cancelHints = () => {
    observer?.disconnect(); observer = null;
    hints?.overlay.remove(); hints = null; prefix = "";
  };
  const cancel = () => { scrolling.cancel(); resetSequence(); cancelHints(); help?.close(); };
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
      ["gg / G", "Top / bottom"], ["h / l", "Browser history back / forward"],
      ["J / K", "Left / right browser tab (wraps)"],
      ["gi", "Focus search / editor"], ["f / F", "Hints / open links in a new tab"], ["Escape / Ctrl+[", "Cancel / leave ordinary text fields"], ["?", "Shortcut help"],
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
    if (editable(event.target) || transient(doc, view)) { scrolling.cancel(); resetSequence(); cancelHints(); return; }
    const key = event.key;
    if (hints) {
      if (key === "Escape") { event.preventDefault(); cancel(); return; }
      if (key === "Shift") return;
      if (event.repeat) return;
      if (!HINT_ALPHABET.includes(key) || key.length !== 1) { cancelHints(); return; }
      event.preventDefault();
      prefix += key;
      const matches = hints.entries.filter(entry => entry.label.startsWith(prefix));
      for (const entry of hints.entries) {
        entry.node.hidden = !entry.label.startsWith(prefix);
        entry.node.classList.toggle('vim-hint-match', !entry.node.hidden && prefix.length < entry.label.length);
      }
      if (matches.length === 1 && matches[0].label === prefix) activate(matches[0].target);
      else if (!matches.length) cancelHints();
      return;
    }
    if (key === "Escape") {
      scrolling.cancel();
      if (sequenceTimer !== null) { event.preventDefault(); resetSequence(); }
      return;
    }
    if (key === "g" && !event.repeat) {
      event.preventDefault();
      if (sequenceTimer !== null) { resetSequence(); scroll("gg"); }
      else sequenceTimer = view.setTimeout(resetSequence, SEQUENCE_TIMEOUT);
      return;
    }
    if (key === 'i' && sequenceTimer !== null && !event.repeat) {
      event.preventDefault(); resetSequence(); scrolling.cancel(); focusInput(doc, view); return;
    }
    resetSequence();
    if (["j", "k", "G", "d", "u"].includes(key)) {
      // Dedicated sidebar/picker scrolling and their keyboard handlers stay native.
      for (let node = event.target; node?.parentElement; node = node.parentElement) {
        if (node !== doc.scrollingElement && node.scrollHeight > node.clientHeight &&
            /^(auto|scroll)$/.test(view.getComputedStyle(node).overflowY)) { scrolling.cancel(); return; }
      }
      event.preventDefault(); scroll(key);
    }
    else if (key === 'J' || key === 'K') {
      scrolling.cancel(); event.preventDefault();
      if (!switchingTab) {
        switchingTab = true;
        Promise.resolve().then(() => switchTab(key === 'J' ? -1 : 1)).catch(() => {}).finally(() => { switchingTab = false; });
      }
    } else if (key === "h" || key === "l") {
      scrolling.cancel();
      event.preventDefault();
      if (key === 'h') view.history.back();
      else view.history.forward();
    } else if (!event.repeat && (key === "f" || key === "F")) { scrolling.cancel(); event.preventDefault(); showHints(key === "F"); }
    else if (!event.repeat && key === "?") { scrolling.cancel(); event.preventDefault(); showHelp(); }
  }

  // Window bubble runs after target/form/document cancellation handlers. Claimed
  // Escape, transient UI, non-text widgets and IME always retain priority.
  function editableEscape(event) {
    if (!enabled || composing || unsafeKey(event) || event.key !== 'Escape' || transient(doc, view)) return;
    const field = event.target?.closest?.('input,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
    if (!field || field.matches('input') && !['text','search','email','url','tel','password','number'].includes(field.type)) return;
    if (field !== doc.activeElement && !field.contains(doc.activeElement)) return;
    event.preventDefault(); cancel(); field.blur();
  }

  function aliasEscape(event) {
    if (!enabled || event.defaultPrevented) return;
    if (composing || event.isComposing || event.keyCode === 229) {
      // Let the browser/IME consume Escape, without delivering it to a form's
      // application cancellation handler. Do not suppress the native default.
      if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) event.stopPropagation();
      return;
    }
    if (!escapeAlias(event)) return;
    // Deliver one semantic Escape through the normal component-first route.
    // No application listener needs a second Ctrl+[ cancellation branch.
    const escape = new view.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27,
      bubbles: true, composed: true, cancelable: true });
    event.target.dispatchEvent(escape);
    let handled = escape.defaultPrevented;
    // Synthetic keys have no browser default. Reuse a native dialog's cancel
    // contract, including an in-progress export's preventDefault safeguard.
    if (!handled) {
      const dialog = [...doc.querySelectorAll('dialog[open]')].find(node => rendered(node, view));
      if (dialog) {
        const allowed = dialog.dispatchEvent(new view.Event('cancel', { cancelable: true }));
        if (allowed) dialog.close();
        handled = true;
      }
    }
    if (handled) { event.preventDefault(); event.stopImmediatePropagation(); }
  }

  function scroll(key) {
    if (key === 'j' || key === 'k') { scrolling.move(key); return; }
    scrolling.cancel();
    const root = doc.scrollingElement;
    // All supported views scroll their document; sidebar/picker scroll is native.
    if (root) view.scrollTo({ top: scrollDestination(key, root.scrollTop, view.innerHeight, root.scrollHeight), behavior: "instant" });
  }
  const compositionStart = () => { composing = true; cancel(); };
  const compositionEnd = () => { composing = false; };
  const focusIn = event => { scrolling.cancel(); if (editable(event.target)) { resetSequence(); cancelHints(); } };
  const dismiss = () => { resetSequence(); cancelHints(); };
  const interrupt = () => { scrolling.cancel(); dismiss(); };
  const pageHide = event => { if (event.persisted) cancel(); else dispose(); };
  doc.addEventListener("keydown", keydown);
  doc.addEventListener("keydown", aliasEscape, true);
  view.addEventListener("keydown", editableEscape);
  doc.addEventListener("compositionstart", compositionStart);
  doc.addEventListener("compositionend", compositionEnd);
  doc.addEventListener("focusin", focusIn);
  doc.addEventListener("pointerdown", interrupt);
  doc.addEventListener("wheel", interrupt, { passive: true });
  doc.addEventListener("touchstart", interrupt, { passive: true });
  doc.addEventListener("visibilitychange", interrupt);
  view.addEventListener("scroll", cancelHints, true);
  view.addEventListener("resize", interrupt);
  view.addEventListener("blur", interrupt);
  view.addEventListener("popstate", interrupt);
  view.addEventListener("hashchange", interrupt);
  view.addEventListener("focus", refresh);
  view.addEventListener("pageshow", refresh);
  function dispose() {
    if (disposed) return;
    disposed = true; revision++; cancel(); unsubscribe();
    doc.removeEventListener("keydown", keydown);
    doc.removeEventListener("keydown", aliasEscape, true);
    view.removeEventListener("keydown", editableEscape);
    doc.removeEventListener("compositionstart", compositionStart);
    doc.removeEventListener("compositionend", compositionEnd);
    doc.removeEventListener("focusin", focusIn);
    doc.removeEventListener("pointerdown", interrupt);
    doc.removeEventListener("wheel", interrupt);
    doc.removeEventListener("touchstart", interrupt);
    doc.removeEventListener("visibilitychange", interrupt);
    view.removeEventListener("scroll", cancelHints, true);
    view.removeEventListener("resize", interrupt);
    view.removeEventListener("blur", interrupt);
    view.removeEventListener("popstate", interrupt);
    view.removeEventListener("hashchange", interrupt);
    view.removeEventListener("focus", refresh);
    view.removeEventListener("pagehide", pageHide);
    view.removeEventListener("pageshow", refresh);
  }
  view.addEventListener("pagehide", pageHide);
  void refresh();
  return dispose;
}

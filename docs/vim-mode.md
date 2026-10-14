# Vim Mode

Enable **Settings → Keyboard navigation → Vim Mode** for Library, Following,
Author Results and Settings. It starts off, persists on this device, and updates
already-open supported pages. The toolbar popup, separate Search page and arXiv
content scripts do not install Vim shortcuts. No permissions or dependencies change.

| Key | Action |
| --- | --- |
| `j` / `k` | Scroll down / up by 80 CSS pixels |
| `d` / `u` | Scroll down / up by half the viewport |
| `gg` / `G` | Smoothly scroll to top / bottom |
| `gi` | Focus the main search field or an eligible editor |
| `h` / `l` | Browser history backward / forward |
| `J` / `K` | Browser tab to the **left / right**, wrapping at either end |
| `f` | Show hints for visible links and controls |
| `F` | Hints; open selected navigational links in a new tab |
| `Escape` / `Ctrl+[` | Cancel an interaction or leave an ordinary text field |
| `?` | Open compact shortcut help |

## Navigation and focus

`h/l` call `window.history.back()/forward()`, including same-document entries;
missing entries are no-ops. They never switch Xivary views directly. Leaving an
extension page for an ordinary website also leaves Xivary's keyboard handler.

`J` moves left (index -1), `K` right (index +1). The shared background handler
queries indices in the source tab's window and activates the adjacent tab, including
pinned tabs. It rechecks source activation, the enabled preference and supported
internal sender before acting, handles closed tabs/API failures, and never explicitly
opens, closes, reorders or reloads tabs. A single-tab window is a no-op. Chrome may
restore a discarded tab on activation. No broad `tabs` permission is needed for
indices/activation; that permission exposes sensitive tab metadata ([Chrome API
documentation](https://developer.chrome.com/docs/extensions/reference/api/tabs)).
The platform boundary uses the native Promise API in both browsers.

`g` starts a 650ms sequence: `gg` scrolls to top; `gi` focuses an editor. An expired,
cancelled or invalid sequence does not focus a field. Library/Following prefer
`#filter`; Author Results prefers `#paper-query` when its search panel is visible;
Settings prefers `#latex-macros`. Otherwise use the first visible, connected,
enabled, writable text input, textarea or contenteditable in document order.
Hidden/inert content, closed dialogs and nontext controls are excluded. `gi` never
opens hidden search panels or cycles fields. It preserves values, focuses without
scrolling, and places a newly focused caret at the end where supported. Existing
focus/selection remains unchanged; contenteditable caret placement uses a DOM Range
without modifying nodes. Native Tab and Shift+Tab remain unhandled, including
buttons and other controls in the normal focus order.

## Scrolling and hints

All supported pages scroll `document.scrollingElement`. j/k use one 90ms RAF
animation: repeated keys accumulate a clamped target and reversal starts from the
current offset. It does not queue independent smooth animations. Reduced motion
uses immediate scrolling. Editing, pointer/wheel input, composition, viewport or
content changes, native scroll displacement, page exit and disabling cancel pending
motion. `gg/G` use the same single animator, with cubic ease-out and a
distance-aware duration of `min(260, 120 + 3 × sqrt(distance))` milliseconds. Repeated
edge commands keep their current target; switching to j/k starts from the live
offset. Native keys and navigation interrupt without being claimed. Reduced motion
also makes edge commands immediate. Dedicated sidebar/picker scrolling stays native.
Half-page commands remain immediate; scrolling never selects individual rows.

The existing j/k easing, 90ms duration and 80px steps are retained to preserve
repeat speed and responsive reversal. Author Results has the same keyboard-focusable
Settings gear, native current-tab link and hint eligibility as Library/Following.

Hints use deterministic DOM order and equal-length, prefix-free labels from
`asdfghjk`; larger visible target sets use multiple letters. Typing narrows labels;
activation requires a complete label. Default labels remain compact monochrome;
remaining partial matches have a subtle pale-yellow/olive accent in light/dark
styles. Hidden, disabled, inert, offscreen and occluded targets are excluded.
Settings includes sidebar links, switches and ordinary buttons/editors. A styled
checkbox remains the single semantic target; its explicitly marked visible switch
supplies geometry. Labels sit immediately beside switches and use measured hint
dimensions to stay inside the viewport, including narrow layouts. Fresh sessions
recalculate geometry; scrolling, resizing or document changes dismiss stale hints.
`F` opens HTTP(S) or extension links with `noopener noreferrer`; buttons and
checkbox/radio actions retain normal activation and confirmations. Download and
nonnavigational links retain normal activation. Text-field hints focus native editing.
Noneditable hints click without first focusing the control, so switches/buttons
do not leave focus behind or interrupt Normal Mode. Focus intentionally opened in
a new editor or dialog is preserved; native Tab focus and visible outlines are
unchanged. Disabling Vim Mode through its own hint removes the session and keeps
shortcuts disabled.
Escape/Ctrl+[, outside activation, scrolling, resizing, blur, editing focus or DOM
changes remove hints, highlights and observers. Page exit removes listeners and
subscriptions; cached history pages refresh preferences when shown again.

## Escape, editing and IME

Normal shortcuts suspend in editable widgets and during composition (`composition`
events, `isComposing`, legacy key code 229). Ctrl/Alt/Meta shortcuts remain native
except enabled Ctrl+[. That alias requires Ctrl alone and logical `[` or physical
`BracketLeft` for practical layout fallback; extra modifiers are excluded.

Ctrl+[ dispatches one semantic Escape through existing component handlers. Target,
form and document cancellation take priority; ordinary editor blur runs afterward
at window bubble only if the event was unclaimed and no transient UI is active.
Collection creation/renaming retain cancellation and focus return, menus/dialogs
retain dismissal, and native dialogs retain their cancel contract. Ordinary text,
search and macro fields keep entered values without saving/submitting. IME prevents
editor blur/alias dispatch. During composition, capture stops application Escape
cancellation while leaving its native IME default available. Only handled aliases suppress browser defaults. An
unclaimed Normal-mode Escape does not navigate or mutate data.

Visible transient forms, menus/listboxes, dialogs and popovers suspend underlying
shortcuts. The permanent Settings macro form is explicitly exempt; typing remains
guarded by its textarea. Settings has one continuous document with a sticky TOC;
TOC clicks and scroll-spy never rewrite history, discard drafts or remount controls.
The existing Author Results `/` shortcut remains independent.

## Verification and limits

The Settings hint correction starts from clean `master` at `787831c` (214 baseline
Node tests). The focused regression suite passes 216 Node tests, Chrome 154 and
Firefox 157 installed-extension workflows, release integration, both browser
packages and whitespace checks. Native Settings keys exercise switch geometry
and one-target ownership, exactly-once changes, unchanged scroll/focus after
saving, `f → switch → j/k → f`, own-switch disabling/re-enabling, macro-editor
hint focus/Escape/Ctrl+[, button and TOC activation. Geometry is measured on the
actual Settings document at desktop and narrow widths, including viewport-edge
clamping; labels are remeasured as fonts settle. Test setup waits for native TOC
scrolling to finish before starting another hint session. Before/after desktop hint screenshots
and updated narrow screenshots were inspected. These are headless, disposable
installed-extension profiles, not substitute Settings fixtures or store installs.

Starting tree: clean `master` at `c6919ac`; baseline Node tests passed 201/201.
The baseline Chromium workflow exposed a focused-fixture hint issue; the harness
now explicitly leaves editing and waits for focus-triggered rerenders. Final checks
pass 214/214 Node tests, installed unpacked Chromium 154 (including polish), the
generated Firefox 157 package workflow, release integration, both 149-file packages
and `git diff --check`. Version remains 0.3.0; permissions and synchronization
storage are unchanged. Native test setup waits for enabled controls and settled
layout; runtime reload is deferred until its DevTools request returns, then actual
reload/recovery is asserted. Screenshots were captured and inspected.

Tests cover local default/persistence/live updates, sequence bounds, target
eligibility, caret preservation, deterministic hints, animated scroll retargeting,
reduced motion, history, tab wraparound/stale-source errors, typing/IME guards and
cleanup. Shared installed-extension workflows use native browser keys on Library,
Following, Author Results and Settings; long-list/hint fixtures are temporary DOM
additions. Portable Library/Following snapshots are compared before and after.
Settings checks direct fragments, sticky/narrow layout, native Tab order, unsaved
macros/validation, hints and immediate disabling. Chromium uses a disposable
multi-tab window for native J/K, pinned tabs, both wrap boundaries and single-tab
no-ops. Firefox uses the direct binaries in [browser support](browser-support.md).

Capture screenshots with `ARXIV_SCREENSHOT_DIR`, including `vim-hints-light.png`,
`vim-hints-light-partial.png`, dark equivalents, `vim-settings-toc.png`,
`vim-settings-toc-narrow.png`, help and native-page hints. Chromium covers 360px;
Firefox's native minimum limits narrow screenshots to 500px. Physical Japanese IME,
screen-reader output, keyboard-layout coverage and minimum browser versions remain
manual checks. Native adjacent-tab switching was verified in Chromium; Firefox
adjacent-tab switching remains a manual check. Composition tests dispatch events,
not an OS IME. These temporary
installed profiles do not prove store-installed behavior or Google-account Sync.
Conservative occlusion may omit partly covered targets; layout changes dismiss
hints. Offscreen gi fields are focused without automatic scrolling. Email/number
inputs may lack a caret API. Native widgets may reserve Escape for their own UI.

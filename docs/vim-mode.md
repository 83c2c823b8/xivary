# Vim Mode

Enable **Settings → Keyboard navigation → Vim Mode** for Library, Following and
Author Results. It starts off, persists on this device, and updates open supported
pages. Settings itself, the toolbar popup, the separate Search page and arXiv
content scripts do not install Vim shortcuts. No permissions or dependencies change.

| Key | Action |
| --- | --- |
| `j` / `k` | Scroll the document down / up by 80 CSS pixels |
| `d` / `u` | Scroll down / up by half the viewport |
| `gg` / `G` | Top / bottom |
| `h` / `l` | Previous / next Xivary navigation tab |
| `f` | Show hints for visible links and controls |
| `F` | Show hints; open selected navigational links in a new tab |
| `Escape` | Cancel hints or a pending key sequence; dismiss help |
| `?` | Open a compact native shortcut dialog |

The visible tab order is **Library → Following**, without wrapping. Author Results
uses Following's current-tab marker: `h` goes to Library, and `l` does nothing.
Collection sidebars and browser tabs are not this horizontal navigation. Native
anchor activation preserves existing full-page routing; navigating starts the
destination's normal view lifecycle, including its temporary filter defaults.

The shared controller scrolls `document.scrollingElement` through immediate
`window.scrollTo` calls. It never selects rows or queues smooth animations. Sidebar
and picker scrolling remains native. `gg` requires a second `g` within 650ms;
an isolated or expired `g` does nothing. Other handled keys reset the sequence.

Hints use deterministic DOM order and equal-length, prefix-free labels from
`asdfghjk`; larger visible target sets use multiple letters. Typing narrows the
labels, and activation requires a complete matching label. Hidden, disabled,
inert, offscreen and center-occluded controls are excluded. Text-field hints focus
the field for native editing. `F` opens navigational HTTP(S) or extension links
with `noopener noreferrer`; buttons and checkbox/radio actions activate normally.
Download and nonnavigational links retain their normal activation. Existing
confirmations remain in force; hints do not bypass repository operations or dialogs.

Escape, outside pointer activation, scrolling, resizing, window blur, editing
focus or DOM changes dismiss hints. Each dismissal disconnects its observer and
removes the overlay. Page exit removes controller listeners/subscriptions; cached
history pages dismiss interactions and refresh preferences when shown again.
Light/dark and forced-colors hint styles are local to the temporary labels.

Inputs, textareas, selects, contenteditable and editable ARIA widgets suspend
shortcuts. Composition events, `isComposing` and legacy key code 229 guard IME
typing. Ctrl, Alt and Meta shortcuts and previously prevented events stay native.
Visible forms, menus, listboxes and dialogs suspend underlying-page shortcuts.
The help dialog uses native modal focus, Escape, a Close button and focus return.
No permanent Vim indicator or per-row control is added. The existing Author
Results `/` search shortcut remains independent.

## Verification and limits

Starting tree: clean `master` at `c738d70`; baseline 192/192 Node tests passed.
Final verification passes 201/201 Node tests, the installed Chromium 154 suite
(including the polish regression suite), generated Firefox 157 package workflows,
release transfer/Chrome Sync lifecycle tests, both 146-file package builds and
`git diff --check`. Version remains 0.3.0. The four Sync preferences, library
synchronization blocker and official Settings support footer are unchanged.

The Node tests cover defaults/migration, local-only persistence, portable/Sync
exclusion, notifications/failures, deterministic labels, scroll bounds, timed
sequences, stale asynchronous reads and controller cleanup. The shared installed
extension workflow runs native key input in Chromium and Firefox, covering live
updates, reloads, scrolling, tab boundaries, hint filtering/actions/new tabs,
dynamic dismissal, narrow labels, editable fields, menus and collection dialogs.
It compares portable Library/Following snapshots before and after the workflow.
Chromium also checks notification delivery to an already-open Following page from
another extension context, without focus/reload, and absence of shortcuts on arXiv.
Both browsers verify native Space toggling and retained visible switch focus.

Captured and inspected screenshots cover native Library/Following hints, a larger
multi-character target fixture, Author Results, help, Settings and narrow viewports.
Reproduce with `ARXIV_SCREENSHOT_DIR` on the browser commands; examples are
`vim-library-native-hints.png`, `vim-following-native-hints.png`,
`vim-author-hints.png`, `vim-help.png`, `vim-settings.png` and `vim-hints-narrow.png`,
plus Firefox-prefixed equivalents. Chromium covers 360px; Firefox's native window
minimum limits its narrow capture to 500px. Expanded scrolling/target fixtures are
temporary DOM additions, with no persistent data writes.

Firefox uses the direct binaries documented in [browser support](browser-support.md),
because the Snap launchers cannot initialize temporary test profiles here. Harness
waits allow repository loads and deferred scroll/resize events to settle; they never
wait for animation frames after a hint has put its source tab in the background.
These fixture runs are not store-installed or account-mediated Sync verification.

IME event tests simulate Japanese composition; they do not operate an OS Japanese
IME. Physical IME, screen-reader output, minimum browser versions and store-installed
packages remain manual checks. Hint selection is designed for sighted keyboard
use; overlays are accessibility-hidden and native controls retain their semantics.
Center-occlusion detection is conservative: a partly covered control may be omitted.
Layout changes cancel hints rather than attempting to retain an old label map.

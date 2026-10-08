# Xivary UI design

This guide describes the implemented interface. General principles that apply to
other products are in [DESIGN_PRINCIPLES.md](DESIGN_PRINCIPLES.md). Xivary is a
compact desktop research tool, not a dashboard. Preserve data and interaction
contracts when changing presentation.

## Hierarchy and typography

Paper titles and author names lead; metadata, counts and management controls are
secondary. Keep blue content links and white surfaces with subtle gray dividers.
Primary Save and Follow actions must remain obvious and comfortably clickable.
IBM Plex Sans Regular/SemiBold is bundled locally with system font fallbacks.
The base is 15px/1.5; page headings 24px, paper/author headings 17px, metadata 13px.
Do not truncate paper metadata. Long author names wrap. Long sidebar collection
names truncate visually and retain the complete accessible name and tooltip.

The 48px app bar contains Xivary, Library and Following. Each page has one heading
and one Settings gear. Library/Following heading padding is 10px above/11px below;
main content begins 16px below it. Search is not primary navigation.

## Shared collection navigation

`ui/collection-sidebar.js` supplies presentation and the two-action menu; each page
owns its repository operations, selection and inline rename form. Shared styling
lives in `ui/collection-sidebar.css`. No shared storage model is introduced.

- White sidebar, 320px desktop column, 28px content gap, subtle right divider.
- Rows are 44px high with 8px corners. Hover is `#f5f6f7`; selected is the stronger
  `#e8eaed`. Selection does not change when its menu is opened.
- Aggregate All Saved uses a bookmark icon; All Following uses a users icon.
  Real collections use folders. All views have a small gap before the collections.
- Collection names lead; 14px tabular counts remain visible in a separate column.
  Counts stay right-aligned; no management icon or reserved action column appears.
- Each row is a semantic button with visible keyboard focus. Single click or
  Enter/Space selects immediately; double-click or F2 starts inline rename.
  Right-click, Shift+F10 or the Context Menu key opens collection actions without
  selecting. Aggregate rows have no rename or context-menu behavior.
- A subtle divider precedes the plus-icon New collection control.

### Aggregate and default collection identities

All Saved and All Following are computed aggregate views, with no collection ID or
rename/delete actions. Saved Papers is a real paper collection, initially
`paper-collection:saved-papers`. Following is a real author collection created on
first follow when none exists; legacy migrations use `collection:following`.
These are not immutable or undeletable collections. Both follow existing rename,
delete and membership rules; first-follow/default recreation remains repository
behavior. This milestone changes no names, IDs or migration rules.

Every saved/followed item has at least one membership. Aggregate counts count live
entities once; individual collection counts count that collection's memberships.
Deleting a sole-membership collection removes its papers from Bookmarks or
unfollows its authors. Items in other collections retain those memberships.
Disabling Following organization hides controls without changing assignments.

## Collection menu and creation

The fixed, viewport-clamped management menu is at most 196px wide, has 8px corners,
4px padding, a subtle border and a small separation shadow. Rows have 36px hit
areas. Rename is neutral; Delete collection uses restrained red text. Neither
selects the collection. Delete opens the existing confirmation dialog.

Pointer menus open beside the click, clamped to an 8px viewport margin. Keyboard
menus open below the focused collection row and initially focus Rename.
Up/Down wrap, Home/End select the first/last action. Enter/Space activates native
buttons. Escape closes and restores trigger focus. Tab closes and continues native
navigation from the trigger. Outside pointer, scrolling and resizing dismiss the
menu. Outside dismissal does not steal focus from the newly clicked control.
Unchanged focus refresh preserves the menu and inline input instead of rebuilding
them. Rename completion/cancellation and dialog cancellation return to the recreated
row. Removed rows fall back to existing collection/navigation focus rules.
Rename preselects the current name; text inputs retain their native context menus.

New collection opens focused inline entry. Enter submits a nonempty valid name;
whitespace-only Enter cancels. Escape and outside click cancel, including typed
text; outside click never creates. Async submissions are guarded. Rename saves on
Enter with existing validation; Escape cancels and restores trigger focus. Outside
pointer activation cancels without saving or stealing focus. Only the edited row
is restored, leaving the outside target connected: selecting another collection
or navigating still takes one click. Inside clicks continue editing; blur never saves.

## Buttons, pickers and forgiving actions

Shared tokens in `ui/page.css`: 7px control corners, 38px standard minimum height,
14px dialog corners, blue visible focus and neutral borders. Use primary blue for
committing transfer actions, subtle secondary Cancel, restrained red Delete for
whole-collection confirmation. Busy controls disable without changing geometry.
Compact repeated Following controls retain their 30px height and text label.
Following rows use an always-visible 34px square, muted folder-only membership
trigger with 7px corners, a neutral hover surface and visible keyboard focus. Its
accessible name is Manage collections for [author], with a Manage collections
tooltip. Author-heading collection triggers use the same 34px folder-only design.
The shared Follow presentation remains dark + Follow or gray checkmark Following,
with an Unfollow accessible action name and tooltip. Never communicate an important action by hover
alone. Keep arXiv and author-heading Follow styling consistent.

Library bookmarks remain 34px square. Saved uses a filled icon on a lighter neutral
surface (`#f1f3f4`); unsaved uses an outline. Existing pressed state, label, tooltip,
picker and Undo remain intact. Library-only row padding is 13px above/below, versus
15px/16px previously; author-feed paper rows retain their reading density.
Following rows use 12px above/below and an 8px action gap. Empty status elements do
not reserve vertical space. Errors still appear in their live status region.

Ordinary Unfollow or membership removal is immediate with eight-second Undo.
Whole-collection deletion requires the existing native modal confirmation with the
actual sole-membership consequence. Cancel is initially focused; Escape cancels
when not busy. Confirmation is guarded, errors stay visible, and focus returns.
No persistent history, deletion semantics or Undo duration changes are implied.
Membership pickers retain their dialog surfaces, native checkbox semantics,
Done/Escape/outside dismissal and focus restoration. `ui/popover-position.js`
anchors them to the actual button with a 7px gap and 8px viewport margins.
Right-side triggers prefer right-edge alignment; left-side triggers prefer left.
The picker prefers below, flips above when it fits, or uses the larger available
side with a constrained height. Width remains 300px (bounded by the viewport),
natural height is capped at 360px; one scrollable surface keeps Done and creation
controls reachable without nested scrolling. Long names wrap.

Resize, captured container/page scroll, and observed layout/content changes
coalesce into one animation-frame update. Positioning preserves input focus,
values and scroll position; closing disconnects observers/listeners. Removing the
trigger closes the picker. In a filtered collection this can follow membership
removal; the existing Undo action remains available. Context menus instead dismiss
on scroll/resize, since their pointer location no longer describes a stable anchor.
Both paper and author pickers share `ui/author-collection-picker.css`. The semantic
checkbox inputs use a small CSS appearance treatment: 17px squares, 4px corners,
white unchecked surfaces with neutral borders, and `#555b63` checked surfaces with
white ticks. Native accent-color alone left corners too square in Chromium.
Forced-colors mode restores native checkbox painting. Existing blue keyboard
focus rings remain distinct from the neutral checked state. New collection inputs
and submit buttons use 8px corners without changing padding, control heights or
the picker layout; Done retains the standard button radius.

Picker/rename refinement evidence: 162/162 Node tests, Chromium 154 and Firefox
157 fixture workflows, release checks and both 71-file packages passed. Inspected
screenshots cover checked/unchecked boxes, input/button focus and Chromium hover;
keyboard Space changes membership through the existing picker. Sidebar checks
retain Enter saving and Escape cancellation, and exercise outside/inside clicks,
one-click selection and navigation without rename writes. Reproduce images with
`ARXIV_SCREENSHOT_DIR`; look for `library-picker-input-focus.png`,
`following-picker-checkbox-focus.png` and Firefox-prefixed equivalents. Physical
touch, screen readers, platform high-contrast themes and store-installed rendering
remain manual checks; fixture screenshots do not verify every browser environment.

### Minimal sidebar and anchored picker verification

The current refinement passes 165/165 Node tests, Chromium 154 smoke/interaction
checks, Firefox 157 smoke, native release-transfer/Chrome Sync lifecycle checks,
and both 72-file packages. Screenshots were captured and inspected for minimal
rows, selected rename text, context menus at left/right/bottom edges, deletion
confirmation, first/middle/last author pickers, above/below placement, narrow
constrained scrolling, creation/validation and scroll reanchoring. Viewport clamps
exclude scrollbars so edge menus stay fully visible. Existing desktop/narrow
Library geometry and popup interaction coverage remain intact.

Reproduce with `ARXIV_SCREENSHOT_DIR` on the browser commands. Representative files:
`library.png`, `library-collection-menu-right.png`, `library-collection-rename.png`,
`library-picker-narrow-constrained.png`, `following-picker-author-last.png`, and
Firefox-prefixed equivalents. Edge checks temporarily reposition real controls in
the test profile; screenshots are fixture evidence, not live/store-wide validation.
Chromium exercises 360px constrained pickers; Firefox's native window minimum is
wider. F2, Shift+F10, right-click and double-click use native browser input in both
suites. Firefox's Context Menu key handler uses a dispatched event because WebDriver
has no corresponding key code; physical-key verification remains manual. Screen
readers, physical touch and minimum-version/store rendering also remain manual.
No collection identities, data semantics, schemas, Sync boundaries, portable
formats, permissions or version were changed.

## Author Results filtering and toolbar

The toolbar keeps Refresh, Open on arXiv and Search as 38px icon controls, with
18px line icons and 7px corners. The time trigger remains available when search
is closed. The 38px search input has 8px corners and shares control typography;
count sits at the right, while the Updated timestamp is a secondary 12px line
below. Empty status regions reserve no space; year headings begin 10px above their
lists. On narrow windows icons retain their compact widths, search wraps to its
own full-width row, and year controls wrap without horizontal overflow.

Search is a visibility toggle, independent of its query. Opening focuses the
input; clicking again or Escape in the input closes it without clearing filters.
An empty search closes on outside click, after the intended click activates to
avoid moving the time trigger during pointerdown. Nonempty queries stay open on
outside click. A subtle neutral active surface/dot and accessible tooltip identify
hidden text filters. Clearing text removes only text filtering. `/` opens search
outside editing controls; Escape in other menus/forms does not close it.

The time menu preserves Any time, Past year, Past 3 years and Custom…; its neutral
180px surface uses 9px corners, 36px items, a selected checkmark and light-gray
selection. Semantic menu/menuitemradio roles expose selection. Arrow keys wrap,
Home/End choose endpoints, Enter/Space select, and Escape restores trigger focus
without changing selection. Tab dismisses and continues from the trigger; outside
pointer dismisses without stealing focus. Shared viewport positioning anchors the
menu with a 7px gap and 8px margins, excluding scrollbars.

Custom uses From year/To year text inputs: 96px wide, 38px high, 8px corners,
numeric input hints and no calendars/spinners. Apply accepts four ASCII digits
from 1000 through 9999; blank endpoints remain open-ended. From must not exceed To.
Malformed/partial/reversed drafts leave the last applied filter unchanged and show
concise feedback only on Apply. Valid endpoints are inclusive local-calendar years:
2020–2026 means local 2020-01-01 through, but excluding, local 2027-01-01. This
preserves the former custom filter's timezone convention and `publishedAt` source;
missing/invalid dates remain excluded by bounded filters. Past year/Past 3 years
remain rolling `setFullYear` intervals, not calendar-year buckets.

Choosing Custom reveals the editor without replacing a preset until Apply; the
trigger still names the applied preset and feedback explains the pending edit.
Switching to presets hides the editor, retaining the last valid years for reuse.
Clear range returns to Any time without clearing text search. Filter state stays
in memory across result refreshes; page reload starts unfiltered, as before. No
new persistence or migration is introduced. Author headings retain text-labeled
Follow/Following plus the conditional folder-only membership trigger, existing
picker positioning, final-membership disclosure and eight-second Undo.

### Author Results verification

168/168 Node tests, Chromium 154 smoke/interaction checks, Firefox 157 smoke,
release-transfer/Chrome Sync lifecycle checks and both 73-file packages pass.
Inspected screenshots cover closed/empty/query search, no matches, neutral time
selection and keyboard focus, valid/invalid years, 360px Chromium layouts, long
names and the header membership picker. Native browser input tests verify search
cancellation without query loss, menu selection/dismissal/focus, Apply validation,
open-ended years, preset transitions, membership edits and existing Unfollow/Undo.
Filter changes issue no extra arXiv requests in the Chromium fixture workflow.

Reproduce with `ARXIV_SCREENSHOT_DIR` on the browser commands; examples include
`author-search-query.png`, `author-time-menu-focus.png`, `author-custom-years.png`,
`author-invalid-years.png`, `author-years-narrow.png`, `author-header-picker.png`
and Firefox-prefixed equivalents. Firefox's minimum native window width is wider
than Chromium's 360px fixture. These are rendered extension/fixture checks, not
store-installed or minimum-version evidence. Physical touch, screen readers and
platform-specific rendering remain manual release checks. No new persistent
filter state, permissions or version changes are implied.

## Library filtering

Keep the rounded 44px search field and its icon left aligned, maximum 340px width.
The shared 38px publication-time trigger sits alongside it, vertically centered;
the actual filtered count remains at the content's right edge. At narrow widths,
search spans its own row, with time and count below. Custom years wrap below the
toolbar. Library uses the same menu, input, validation, Apply/Clear and focus
behavior as Author Results (`ui/publication-time-filter.js` and its shared CSS).

`domain/publication-date.js` supplies both pages' date calculations. Only
`publishedAt` is filtered: rolling local-calendar one/three-year presets and
inclusive custom years 1000–9999 with optional blank bounds. Any time includes
missing/invalid dates; bounded ranges exclude them. Invalid drafts preserve the
last applied filter. No saved-date fallback is used.

Collection selection, existing title/author/category substring matching and time
filtering intersect without changing order or memberships. Abstracts are neither
searched nor displayed inline; Abstract/PDF links remain unchanged. Sidebar counts
remain unfiltered membership totals. A filtered zero-match view shows No matching
papers; Clear search clears only text and focuses its input. Clear range clears
only time filtering. Collection navigation and saved-paper updates preserve both
filters; page reload starts with Any time. Filters never write persistent state.

### Library publication-filter verification

170/170 Node tests, Chromium 154 and Firefox 157 smoke/interaction suites,
release-transfer/Chrome Sync lifecycle checks and both 76-file packages pass.
The shared browser workflow covers preset selection, keyboard/outside dismissal,
focus return, valid/open-ended/reversed/partial years, independent clear actions,
Collection/text/date composition, unchanged sidebar totals, removal/Undo refresh
and unfiltered reload. Fixture cleanup compares the original portable Bookmarks
snapshot to verify record and membership preservation.

Inspected rendered screenshots include `library.png`, `library-date-menu-focus.png`,
`library-date-custom.png`, `library-date-invalid.png` and `library-date-narrow.png`,
plus Firefox equivalents; capture them with `ARXIV_SCREENSHOT_DIR`. Chromium covers
360px layout; Firefox uses its wider native minimum window width. The comparison
with `author-custom-years.png` confirms shared presentation. Screen readers, physical
touch, minimum browser versions and store-installed rendering remain manual checks;
these fixture profiles do not demonstrate account-mediated Sync delivery.

## Toolbar popup

The actual Chrome action popup is **300px wide** with a 51px header including its
separator, 16px header padding and a 36px Settings gear. Main padding is 8px above,
12px horizontally and 10px below. Two 44px navigation rows have a 2px gap and 8px
corners; total normal height is 159px. Icons are 21px subdued line icons, labels
15px semibold, counts right aligned and tabular. Neutral hover and blue focus
outlines do not move content. There is no additional Settings row.

Popup content uses a coordinated **12px** radius on `html` and `body`, hidden
overflow, a transparent root canvas and white body. The clipped header surface is
`#fafbfc`, with a subtle `#e8eaed` divider and a transparent Settings button surface.
No wrapper border, extra padding, masking or application shadow is added.

**Native boundary limitation:** before/after screenshots of the actual headed
Chrome 154 popup on Linux/X11 confirm that its browser-owned backing surface and
shadow remain rectangular. The 12px radius softens/clips application content;
it does **not** produce genuinely rounded native outer corners in this environment.
Do not infer native window rounding from computed CSS or a content-only screenshot.
Normal, hover and native Tab focus states were inspected without clipping, layout
shifts or scrollbars; the popup remains 300 × 159 CSS pixels. Other browser-native
window shapes are platform-dependent and must be checked separately. Firefox's
extension-page rendering is covered; its actual toolbar widget remains unverified.

The icon opens the popup. Library/Following retain their routes and the existing
new/current-tab preference, duplicate guards and conservative restricted-tab
fallback. Settings retains openOptionsPage. Counts remain local, not synced.

## Responsive and accessibility rules

Below 860px, sidebars stack above content with a bottom divider. Below 480px,
Library count wraps beneath its full-width search field; Following controls wrap
beneath the author name. Avoid horizontal overflow, clipped menus and truncated
accessible names. Use semantic buttons, aria-current, pressed states, meaningful
labels, menu roles, aria-haspopup/expanded and visible focus rings. Static icons
are aria-hidden. Never inject user names as HTML. Keep keyboard focus out of hidden
or disconnected controls; dialogs manage focus through native modal behavior.

## Visual fixtures and regression evidence

Reproduce Chrome before/after surfaces using the existing fixture suite:

```sh
ARXIV_SCREENSHOT_DIR=/tmp/xivary-ui npm run test:browser
```

Images include `library.png`, `library-narrow.png`, `library-collection-menu.png`,
`library-no-matches.png`, `following-collections.png`,
`following-collection-menu.png` and `popup.png` (actual native action popup).
The interaction suite also captures both deletion dialogs under
`/tmp/xivary-design-{paper,author}-dialog.png`. Screenshots are generated review
artifacts, not runtime files. Browser checks are fixture evidence, not proof of
all live arXiv layouts or distribution environments. See
[browser verification](browser-support.md) for the final evidence and manual gaps.

Firefox uses the same screenshot environment variable and emits `firefox-library`,
`firefox-following`, menu/dialog and popup-page images. Chrome and Firefox rendered
fixtures were inspected; only Chrome's native toolbar popup was captured. The
320px stress screenshot uses deliberately long text and six-digit counts without
changing storage. Physical touch, screen readers and store-installed/minimum
browser surfaces remain manual checks.

## Contextual arXiv controls and lifecycle

Abstract-page Bookmarks sit immediately after the existing title contents in
inline document flow: 36px hit area, 23px icon, 7px corners and a small left gap.
They wrap naturally after long titles instead of floating to the column edge.
The original title text and nested markup stay intact; saved state remains filled.

An invalidated content-script context is terminal until page reload. Close its
pickers, disable Xivary controls and show “Reload this page to reconnect Xivary.”
Do not expose the raw lifecycle exception or retry the dead runtime. Author links
then retain native navigation. Ordinary runtime failures retain diagnostics and
retry behavior. Developer lifecycle diagnostics remain in the console.

### Verification and limits

This refinement passed 161/161 Node tests, Chromium smoke plus interaction tests,
Firefox 157 smoke, release transfer/Sync lifecycle checks, both 70-file packages
and `git diff --check`. Chrome 154 exercised actual extension reload, disabled old
controls, picker dismissal, native author-link fallback and page-reload recovery.
Firefox covered Save/Follow persistence and the existing membership workflow;
extension-context invalidation after an add-on update remains unverified there.

Rendered fixture screenshots were inspected for short/long/multiline titles,
360px title wrapping, Following controls, keyboard focus and open pickers. Generate
them with `ARXIV_SCREENSHOT_DIR` and the browser suites; representative images are
`arxiv-title-long-360.png`, `arxiv-context-unavailable.png`,
`following-folder-trigger.png` and `firefox-folder-picker.png`. These checks do not
prove every live arXiv layout, physical touch, screen-reader behavior or a
store-installed update. Existing manual release checks remain applicable.

# Consistent controls and toolbar launcher — 2026-10-09

## Starting state

Clean `master` at `7ab28561685e5a75a5e0a7b9cae7cb5b446bfd45`, two commits ahead
of origin. The Follow presentation milestone was already integrated. Baseline
151/151 Node tests passed. No existing changes were discarded. Version stays 0.2.0.

## UI scope

Internal pages use small existing CSS conventions: 7px controls, 14px dialogs,
38px standard controls and restrained neutral surfaces. Compact Follow/collection
row controls retain 30px geometry; icon and sidebar controls keep their intentional
sizes. Shared Follow rounding is 7px on arXiv too, with existing colors/icons/actions.
No page layout redesign or animation was added.

Collection deletion uses shared responsive modal styling, title/description,
secondary Cancel and restrained red Delete. Native modal focus/keyboard behavior,
initial Cancel focus, Escape cancellation, busy guard, error feedback and focus
return are preserved. The existing per-page focus callback takes priority; there
is a connected-invoker/collection-control fallback. The same dialog conventions
style Settings export with a primary export action. Data consequences are unchanged:
sole-member papers are removed and sole-member authors become unfollowed; other
memberships survive. Cancel does not write.

Following rows reuse shared ✓ Following icons, action labels and tooltips. Clicking
still unfollows explicitly and offers the existing eight-second Undo. Collections
uses a folder/label/chevron presentation and the same membership picker; it stays
hidden when organization is disabled. The author heading uses that picker trigger
too. Paper/author pickers share rounded surfaces, control shapes and focus states;
Library's saved-bookmark control keeps its distinct icon and existing behavior.

The popup retains its 408px normal width, compact header, upper-right Settings
gear, two complete clickable rows, existing library/person icons and subdued
right-aligned local counts. Rounded row hover/focus backgrounds and focus outlines
are consistent with internal controls. Count loading and Settings behavior stay
on their original paths.

## Launcher decision and safety

Inspection found a manifest default_popup, not a direct action.onClicked landing
page. The user confirmed keeping that popup. `openXivaryFromToolbarInNewTab`
controls only Library/Following row activation and defaults to true. The icon
itself still opens the popup. The existing Library/Following routes remain exact;
Settings still uses openOptionsPage and other app/arXiv navigation is unchanged.

Every activation rereads RepositoryClient preferences. A busy guard disables both
rows until success/failure; it does not issue duplicate navigation. New-tab mode
uses tabs.create. Current-tab mode queries the active current-window tab and uses
tabs.update. Missing/invalid tabs, failed tab lookup or a known restricted URL use
one new tab. If URL details are withheld without broad tabs permission, the native
API decides whether the explicit current-tab navigation is allowed. Update failure
shows an error and leaves the popup available; it never performs a speculative
second write. No additional permissions are needed.

## Compatibility

The fourth preference uses LocalRepository → existing SyncStorage projection and
v1 boolean register ordering/retries/live reconciliation. Missing schema-5 values
normalize to true without reset/write-on-read; the next mutation persists it.
Invalid values fail safely. Preexisting replica keys remain intact; absent new keys
seed at revision zero only after validated merge. Established remote winners prevail.
Older settings-only clients ignore this register. Bookmarks, Following, collections,
memberships, caches and local pointers stay local; legacy remote library records
stay untouched/inert. Firefox preferences stay local. No schema migration, portable
format change, version bump, dependency, host/API permission or backend was added.
All preferences remain excluded from manual transfers.

## Verification

- Node: **156/156 pass**, versus 151 baseline. Added three launcher tests (routes,
  fresh preference reads, missing/restricted fallback and failure without duplicate
  writes), one local upgrade/default/persistence test and one independent two-device
  upgrade/propagation test. Existing data, migration, Undo and portable tests pass.
- Chrome 154: real native action-popup geometry/counts/Settings checks, Library and
  Following in both tab modes, keyboard Enter/focus, repeated activation guard,
  unchanged content/author navigation, complete collection workflow and eight-second
  Undo pass on deterministic fixtures. Dialog Escape/focus return and styling are
  asserted. Popup, Following controls and both deletion dialogs were captured and
  visually inspected; this is not every live-site/browser environment.
- Firefox 157: existing smoke and expanded collection/dialog/Undo flow pass. The
  popup-page same-tab Library path exercises native Promise APIs; real Firefox
  toolbar-widget activation remains manual and is not claimed from WebDriver.
- Native transfer/Chrome lifecycle release smoke passes: category All/collection
  downloads and file imports, legacy-record isolation, all four native Sync
  registers/onChanged/focus updates, fourth-preference pending alarm/worker
  recovery, extension reload and profile restart. This uses test-authored peer
  records in disposable unsigned-in profiles, not real account propagation.
- Both browser packages build with **68 runtime files**; manifest remains 0.2.0,
  existing popup/permissions retained, runtime bytes compared to source.

Future 0.3.0 release preparation must choose the version separately, test published
update identity/minimum browsers, same-account delivery of the fourth preference,
Firefox native toolbar/transfer and macOS/touch/assistive surfaces. No credentials,
normal profiles, push, signing or publishing are used. Generated packages and
screenshots are not committed. Repository commit gates remain unchanged.

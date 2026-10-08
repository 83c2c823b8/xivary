# Browser support and verification

One application tree produces Chromium and Firefox manifests. Chrome uses native
extension Sync only for four designated user preferences; Firefox remains local-only. No Xivary
account, OAuth, backend or external sync provider is implemented.

## Latest compact UI evidence — 2026-10-09

Started clean on `master` at `ab389a36586c252ed52c9ae4d66dcfc2c5f90e2e`
(three commits ahead of origin). Baseline Node: 156/156 pass. Original Chrome
smoke passed and before screenshots were captured; its extended interaction phase
initially timed out waiting for creation focus. The harness now waits for rendered
collections and fonts. Native click targets scroll into view, and screenshots wait
for foreground/font/paint readiness. Assertions were preserved and expanded.

- **VERIFIED AUTOMATICALLY:** 158/158 Node tests, no failures/skips, including two
  shared sidebar presentation regressions. Both 69-file packages match source,
  remain version 0.2.0 and retain existing manifests/permissions. Diff check passes.
- **VERIFIED IN REAL BROWSER, fixtures:** Chrome 154 full smoke/interaction suites;
  actual action popup is 300 × 159px with stable 44px rows, correct local counts,
  Settings gear, both routes/tab modes, keyboard and duplicate guards. Shared menu
  checks cover stable counts, no selection on open, Up/Down/Home/End/Tab/Escape,
  outside dismissal, unchanged-focus-refresh retention and rename/dialog focus
  return. Library zero matches/Clear search/count alignment pass. Existing membership,
  Unfollow/Bookmark Undo, content and author interactions remain covered.
- **VERIFIED IN REAL BROWSER, fixtures:** Firefox 157 / geckodriver 0.37.1 smoke
  and the shared Following menu/collection/Undo workflow pass. Library, Following,
  menu, deletion dialog and popup-page screenshots were inspected. This is not
  verification of Firefox's native toolbar widget.
- **VISUAL REVIEW OF REAL BROWSER SCREENSHOTS:** Chrome before/after Library,
  Following, sidebar/menu/dialog, actual popup and hover/focus states; 560px layouts
  and 320px long-name/six-digit-count stress fixture. No clipping/overlap was found
  in the modified controls. Stress text/counts are layout fixtures, not stored data.
- **VERIFIED IN REAL BROWSER, unsigned-in test profiles:** native category transfers,
  settings-only isolation, four test-authored preference events, pending real alarm/
  worker recovery, reload and full profile restart pass. Account delivery is not
  inferred from these checks.

Two implemented design references: [Xivary UI](UI_DESIGN.md) and
[reusable principles](DESIGN_PRINCIPLES.md). No collection identity, persistence,
Sync/portable contract, launcher semantics, version or permission changed.
Human assistive/touch/macOS checks, minimum versions, distribution and real-account
checks below remain **NOT YET VERIFIED**. All automated commit gates pass.

## Previous UI/launcher evidence — 2026-10-09

156/156 Node tests and Chrome/Firefox fixture smoke suites pass. Chrome exercises
the actual 408px toolbar popup, correct counts and Settings gear, both routes in
new/current-tab modes, keyboard activation and duplicate guards. Shared Following
controls, dialog Escape/focus return and Undo pass. Popup/row/dialog screenshots
were visually inspected. Firefox exercises the popup-page current-tab Library path,
which does not prove its native toolbar widget. The fourth designated preference
uses existing schema-5/Sync-v1 boundaries; library state remains local.
See [scope, safety and final verification](ui-launcher-polish.md).

## Previous Follow presentation evidence — 2026-10-09

151/151 Node tests and both browser smoke suites pass. Chromium additionally
compares both Follow/Following states against arXiv, exercises keyboard Unfollow/
Undo and collection visibility, and checks 320px heading wrapping. Both states
were captured and visually inspected on fixture pages. Release lifecycle/transfer
checks pass; 66-file packages remain version 0.2.0 with unchanged permissions.
See [scope and regression record](unified-follow-button.md). External/manual
release requirements below remain unchanged.

## Previous author-navigation evidence — 2026-10-09

- **149/149 Node tests pass**, including 41 independent-repository Sync simulations,
  15 portable-file tests and 9 Undo tests. New boolean defaults/upgrades/validation,
  settings-only propagation, full-name link recognition and stale/failed/expired
  Undo are covered. Schema 5 and portable formats remain unchanged.
- **Chrome 154.0.8037.57**: original geometry/UI suite plus native author Follow/
  Unfollow/Undo/reload, both collection forms/dialogs, paper metadata restoration,
  eight-second UI expiry, delayed/invalid/empty API states, default-new-tab and
  current-tab entry, current real-search DOM fixture with dynamic authors and native
  Ctrl/middle/Enter interactions. **VERIFIED IN REAL BROWSER, fixtures**.
- **Firefox 157.0 / geckodriver 0.37.1**: existing suite, author heading Unfollow/
  Undo and shared Following empty/outside/create/delete/Undo workflow pass.
  **VERIFIED IN REAL BROWSER, fixtures**. New search/current-tab variants were
  exercised in Chrome; Firefox-specific search/navigation checks remain manual.
- **Chrome release suite** passes native All/collection transfers, settings-only
  cutover, all three test-authored remote preference registers/focus updates,
  pending alarm/worker recovery, extension reload and full test-profile restart.
  **VERIFIED IN REAL BROWSER, unsigned-in disposable profiles**; account transport
  remains **NOT YET VERIFIED**.
- **64-file Chromium/Firefox packages pass** source/manifest inspection. No API or
  broad host permission added; content matching adds only arXiv `/search/*`.
  **VERIFIED AUTOMATICALLY**.
- Current standard search HTML was fetched on 2026-10-09 and used as a regression
  fixture. This is **LIVE DOM INSPECTION**, not a current live API/browser claim.
  The published store archive was not supplied or compared. No store-specific
  slowdown was reproduced; two demonstrated loading/response defects were fixed.

See [polish scope and bounded investigation](author-interaction-polish.md).
All required commit gates pass. Account delivery, minimum versions, platform-native
manual surfaces and the next store version remain release-preparation checks.

## Prior evidence — 2026-10-08

| Check | Evidence | Status |
| --- | --- | --- |
| Node regression | 135 tests, including 40 Sync simulations, 15 portable-file tests and 6 author-navigation tests | VERIFIED AUTOMATICALLY |
| Chromium packages | 60 files; manifest and every runtime byte checked against source | VERIFIED AUTOMATICALLY |
| Firefox packages | 60 files; non-manifest runtime files identical to Chromium | VERIFIED AUTOMATICALLY |
| Chrome 154.0.8037.57 | Original geometry/UI suite plus both Settings gears, author entry and full Following collection workflow; fresh disposable profile | VERIFIED IN REAL BROWSER, fixtures |
| Firefox 157.0 / geckodriver 0.37.1 | Generated temporary add-on, content Save/Follow/unfollow, reloads, RPC, Library, Following, author feeds, popup-page navigation, preferences, both gears and full Following collection workflow | VERIFIED IN REAL BROWSER, fixtures |
| Chrome transfer UI | All and collection exports for both categories, actual downloads/native file input, collection restoration, repeat import, other-category preservation, Cancel, malformed feedback, no Preferences transfer UI | VERIFIED IN REAL BROWSER |
| Chrome Sync integration | Actual sync area, onChanged reconciliation, Settings focus refresh, durable pending publication, real alarm delivery after worker stop/recreation, extension reload, full test-profile restart and restored Following collection browsing | VERIFIED IN REAL BROWSER, unsigned-in disposable profiles with test-authored peer records |
| Live arXiv | Three real abstracts; five author views with current name-matched paper rows, ordinary/Enter/Ctrl/middle and unrelated navigation | VERIFIED IN REAL BROWSER, network |
| Settings-only cutover | Chrome existing/fresh profiles ignore legacy live/malformed library records, keep remote history and imported library state local | VERIFIED IN REAL BROWSER, test-authored peer records |
| Independent device conflicts/failures | Separate repositories/disks and shared fake transport, replay/delay/restart/quota/failures | SIMULATED |
| Earlier combined transfer UI | User reported successful Chrome file selection/download before the collection selector refactor | VERIFIED MANUALLY, historical flow only |
| Google-account delivery | No dedicated signed-in matching-ID test installations provided or used; credentials and normal profiles untouched | NOT YET VERIFIED |
| Firefox native toolbar popup, transfer download/file flow, signed installation/restart | Extension-page navigation and repository behavior pass; these browser surfaces require separate checks | NOT YET VERIFIED |
| Declared minimum versions, other Chromium distributions, store signing | Chrome 102 / Firefox 140 minimums, Edge/Brave, Chrome store identity and AMO signing not exercised | NOT YET VERIFIED |

The complete release record and remaining checklist are in [release.md](release.md).
A single unsigned-in profile's real events do not establish account propagation.
Headless browser automation is real runtime evidence, not a claim of human review.

## Verification commands and commit policy

Required before committing portability/integration changes:

```sh
npm test
npm run test:browser
npm run test:firefox
npm run test:release
npm run package
npm run package:firefox
git diff --check
```

The existing requirement that both browser smoke suites pass is retained. The
prior environment blockers no longer block these gates. External account delivery,
minimum-version/store testing and manual browser surfaces remain explicit release
checks; they must not be reported as passed from simulations or packaging. See
[release assessment](release.md#release-assessment) before distribution.

`npm run test:arxiv` is a separate live-network check; it deliberately does not
replace the fixture suites. It reports navigation separately if live paper retrieval
fails. API/network availability is outside the deterministic baseline.

Node 20+, zip/unzip and Chrome are needed. Firefox smoke also needs Firefox,
geckodriver supporting `--allow-system-access`, OpenSSL and loopback networking.
Override paths for local installations:

```sh
CHROME_BIN=/path/to/chrome npm run test:browser
FIREFOX_BIN=/path/to/firefox GECKODRIVER_BIN=/path/to/geckodriver npm run test:firefox
```

This environment uses direct binaries at
`/snap/firefox/8995/usr/lib/firefox/{firefox,geckodriver}` because Snap launchers
cannot set up profiles here. The current successful runs supersede historical
2026-10-03 `setsockopt`/`Extensions.loadUnpacked` timeouts and loopback `EPERM`.
The initial 119-test baseline passed; Firefox then reproduced an unsupported
WebDriver direct `moz-extension://` navigation. That was a harness restriction,
not a manifest/application failure. The harness now enters through the real arXiv
author action, uses extension-origin links/navigation, and enables the documented
[geckodriver privileged-context flag](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html).
No production permission or behavior was added for WebDriver.

Chrome's CDP-loaded extension becomes disabled on `runtime.reload()`. The release
harness reenables the same ID through Chrome's own extensions page in its temporary
profile, without uninstalling, clearing storage or adding application permissions.
Restart reenables the same unpacked test installation if necessary. This is not
evidence of a signed-store installation's lifetime. Worker recovery is separately
verified: stop the real worker with a persisted
pending register, avoid repository/UI activity, then observe the real alarm and
new worker target publishing that register. Browser restart uses the same dedicated
profile and retains the replica ID/library. No account login is automated.

## Author-link support

Content injection matches only `https://arxiv.org/abs/*` and
`https://arxiv.org/search/*`. Delegated click handling recognizes abstract
`.authors a[href]` and standard result `li.arxiv-result p.authors a[href]` with an
`Authors:` label and same-origin `/search/` or
`/search/{archive}` destinations, `searchtype=author`, and a nonempty query.
Visible full names supply the existing name-key/query pipeline, rather than
abbreviated surname/initial href queries. Unsupported layouts and list pages
remain native; dynamically inserted results use the same single listener.
Unknown/malformed links fail open; download links and non-self targets stay native.

Ordinary primary click and Enter open the reusable author page in another tab
by default; the inbound author navigation setting permits the current tab.
Ctrl/Cmd/Shift/Alt, middle-click, context menus and copying keep the original anchor
href. All modifiers are unit tested; Ctrl/middle/Enter also ran in Chrome. Human
context-menu and platform-specific Cmd interactions remain manual checks.
Namesakes may share results and are disclosed; no verified identity is inferred.
Opening a name route never follows it and survives refresh without page memory.

Historical live pages exercised before this polish (no fixture responses):

- [math/0307245](https://arxiv.org/abs/math/0307245): one author, Grisha Perelman,
  `/search/math?searchtype=author&query=Perelman,+G`.
- [2512.03554](https://arxiv.org/abs/2512.03554): Atsuki Nakago and Atsushi Takahashi,
  independently opened with full visible names and abbreviated math queries.
- [1706.03762](https://arxiv.org/abs/1706.03762): eight authors and `/search/cs`
  queries, including `Gomez,+A+N`; Ashish Vaswani and Illia Polosukhin opened.

The original candidate run rendered 3, 2, 39, 25 and 7 matching rows respectively.
The Following repair rerun rendered 3, 2, 39, 26 and 7, after tightening harness
readiness to wait for retrieval metadata/error. These counts are observations,
not permanent expectations. Unicode/accented names
and encoded apostrophes are fixture/unit coverage, not claimed as live-page tests.
That historical run did not broaden support. This milestone extends support to
standard search-result anchors based on current fetched HTML and fixture checks.

## API boundary, manifests and packages

`platform/browser-api.js` prefers native `browser`, then `chrome`; the classic
loader is the only bootstrap exception. UI/domain code has no native storage
access. Only `lib/storage.js` opens local/sync areas and subscribes to onChanged;
the shared background registers alarms/startup and serializes reconciliation.
Settings refreshes through RepositoryClient on focus/reopening, with no storage
listener. Local persistence stays schema 5; wire records stay Sync v1.

`extension/manifest.json` is the unpacked Chromium entry and common source.
`scripts/browser-manifest.mjs` derives Firefox's module event-page background,
removes the Chrome minimum and `alarms`, and declares stable ID `xivary@arxiv-tool`,
minimum Firefox 140 and required `searchTerms` for arXiv author/field queries.
Chrome uses a module service worker and minimum 102. Permissions are `storage`
plus Chromium-only `alarms`; host access is only `https://export.arxiv.org/*`.
No identity, tabs, downloads, native messaging or broad host permission is added.

`npm run package` and `npm run package:firefox` generate ignored `dist/` directories
and versioned ZIPs. Non-manifest application files are copied byte-for-byte; no
separately maintained runtime tree exists. No store upload/signing is automated.

## Pending manual Chrome sync checks

Use dedicated installations A/B with the same extension ID and browser sync enabled
on the same account, set up by the developer. Record versions, IDs and observations.
Do not use two unsigned-in profiles as evidence of account transport.

1. Change each of the four boolean preferences on A then B; refocus Settings/Following and
   observe the desired value on the other installation.
2. Save/follow/create/rename/move/delete locally; verify the other installation's
   Bookmarks/Following/collections/memberships stay unchanged after reload/restart.
3. Import an All/collection file on A; verify local restoration and no library
   upload/restore on B. Preferences still propagate independently.
4. Use distinct local last-used paper/author pointers and caches; verify they do
   not propagate. Unknown/device settings have no active Sync registers.
5. Upgrade with existing local and remote legacy v1 state; retain local data and
   leave remote legacy records unchanged. A fresh installation receives only
   preferences, even with legacy live/tombstone/malformed records present.
6. Verify offline preference conflicts/retry, disabled/unavailable Sync and legacy
   quota occupancy. Never erase history to manufacture a successful test.

## Pending manual Firefox and distribution checks

- Actual toolbar popup and keyboard/context-menu interactions in Firefox; Chrome
  Cmd-click on macOS and human open-in-new-tab/copy-link behavior.
- Firefox All/collection downloads and native picker imports for both categories,
  repeat/Cancel/malformed feedback and legacy v1 category selection.
- Signed Firefox installation and installed add-on browser restart persistence;
  temporary add-on lifetime does not prove signed-installation lifetime.
- Chosen minimum browser versions, store identity/signing, optional Edge/Brave.

Set `ARXIV_SCREENSHOT_DIR=/tmp/xivary-ui` with either fixture smoke command to
capture visual review artifacts. Firefox prefixes its extension-page images with
`firefox-`; its popup-page screenshot is not a native toolbar-popup claim. Chrome
captures its actual action popup. Screenshots are not packaged or committed.

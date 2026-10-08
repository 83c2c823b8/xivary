# Xivary release records

## v0.3.0 release preparation

Prepared from clean `master` at `625b66c671877f14424f3f07eb0bf9ad8537933d`
(10 commits ahead of origin). Baseline: **170/170 Node tests pass**.
Only product version metadata, its manifest assertion and release documentation
change in this milestone. `package.json` and the shared manifest now declare
**0.3.0**; Firefox derives that version without a separately maintained manifest.
The version bump does not change local schema **5**, migrations, Sync **v1**,
portable **v2** or application code. Older portable v1/unscoped v2 files remain
supported. Four designated preferences synchronize; all library data stays local.
Legacy remote library records remain inert and untouched. Browser permissions and
Firefox add-on ID `xivary@arxiv-tool` are unchanged from the preceding source.

The [0.3.0 changelog](../CHANGELOG.md) is the concise store-facing summary.
It reflects Git history: shared Library/Author Results publication filters,
query-preserving search, contextual Follow/Collection actions, eight-second Undo,
compact popup and launcher preference, sidebar keyboard/context menus, anchored
pickers, search-page author navigation and quiet content-context recovery.
Settings gears and compatible manual transfer are retained existing features.

### Final verification

All required commit gates passed on this release tree:

| Check | Result / evidence |
| --- | --- |
| `npm test` | **170/170**, zero failed/skipped; migrations, portable compatibility, settings-only Sync simulations and UI/domain regressions |
| `npm run test:browser` | **PASS**, Chrome 154.0.8037.57; smoke plus interaction suite, including native author link/Undo/keyboard and Library/Author Results filters |
| `npm run test:firefox` | **PASS**, Firefox 157; generated extension, local-only persistence, filters, Following/Undo, pickers and keyboard workflows |
| `npm run test:release` | **PASS**; native All/collection file transfers, invalid/Cancel/isolation, actual preference storage events, real alarm/worker recovery, reload and full profile restart |
| Both packaging commands / manifest tests | **PASS**, matched 0.3.0, 76 files each; only generated platform manifests differ |
| Full release diff / `git diff --check` | **PASS**; runtime code, storage and permissions untouched; artifacts ignored |

Inspected current rendered `library.png`, `author-custom-years.png`,
`firefox-library-date-invalid.png`, `library-date-narrow.png`,
`following-collections.png` and actual Chrome `popup.png`. Desktop and 360px Chrome
layouts remain compact; Firefox uses its native minimum window width. Capture
via `ARXIV_SCREENSHOT_DIR` on browser commands. Browser evidence uses dedicated
profiles and fixtures; Sync peers are simulated, with real native events/lifecycle.
No live-network suite was rerun: current live arXiv/API availability is not asserted.

### Upgrade compatibility and remaining manual checks

Automated migration/legacy-record tests preserve favorites, author metadata,
Collection IDs and memberships, including repeated migration and restart.
Browser suites verify Collection/text/date composition, Author Results filters,
Following/Undo, keyboard dismissal/focus and native author-link behavior. The
release suite compares retained local metadata/memberships/caches/preferences
across extension reload and full profile restart, tests native portable transfer
and settings-only Sync events/recovery. Application files remain byte-identical
to the preceding tested 0.2.0 development HEAD; only manifest version changes.

**Not tested:** an actual Chrome Web Store-installed 0.2.0→0.3.0 update, a signed
Firefox upgrade, or a byte comparison against the published store binary (not
supplied). Reload/restart and schema simulations are not signed-update evidence.
Before publication, use dedicated test profiles with the actual preceding build:
record/export both categories, update the same extension identity without
uninstalling/resetting, then compare records, counts, Collection IDs/memberships
and preferences after reload/restart. Export is a precaution; an upgrade must not
require import to retain data. Check open arXiv tabs' reload hint after updating.

Also complete the existing [manual release checklist](#release-assessment):
same-account preference delivery (including local-data isolation), minimum Chrome
102/Firefox 140, native Firefox toolbar/transfer surfaces, Cmd/context-menu/copy,
screen readers, physical touch and platform-native rendering. Firefox's native
minimum window width prevents the Chromium 360px layout check. No account
propagation, store rendering or signed-update result is inferred from automation.

### Release artifacts and manual submission

Build with `npm run package` and `npm run package:firefox`; inspect with
`unzip -l`, `unzip -p <archive> manifest.json` and `sha256sum`.
Artifacts are ignored, unsigned ZIPs with `manifest.json` at the root:

- Chrome: `dist/xivary-0.3.0-chromium.zip`.
- Firefox: `dist/xivary-0.3.0-firefox.zip`.

No development files, test fixtures, repository metadata, credentials or source
maps are included. Both packages contain 76 files; only manifests differ.
Package hashes below identify this run's artifacts; rebuilding may change ZIP
metadata/hashes.

| Browser | Files | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Chromium | 76 | 221437 | `223c184f4846b31d237bb43c42a8b36279f82e902557dbaec21eea8ba99a2079` |
| Firefox | 76 | 221504 | `987db962ce98aef88cb5fcd936feb6ff592450e30bbd4753a7fc1436ca04fb40` |


1. Complete the manual checks above and retain the preceding version and portable
   backups in the dedicated test profiles. Do not uninstall to test an update.
2. For Chrome, open the **existing Xivary item** in the developer dashboard, select
   **Package → Upload New Package**, upload the Chromium ZIP, verify version 0.3.0,
   and review listing/privacy/distribution details against README and PRIVACY.md.
   Paste the concise changelog, submit for review and use deferred publication if
   you want to control publication after approval. Do not create a replacement item.
   If your account already requires Verified CRX Uploads, apply its existing signing
   procedure manually; this run neither creates keys nor supplies a signed CRX.
   See [Chrome's update procedure](https://developer.chrome.com/docs/webstore/update).
3. For Firefox, use the existing AMO add-on's upload-new-version flow if registered;
   otherwise submit a new listed add-on. Upload the Firefox ZIP, retain its existing
   Gecko ID, review validator findings, provide release notes/privacy/support and
   accurate reviewer/source details, then submit manually. Resolve validator errors
   before distribution; obtain Mozilla's signed artifact. This ZIP is not signed
   and is not a normal release-Firefox installation package yet. See
   [Mozilla's submission procedure](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/).
4. After approval/publication, verify installation and same-ID data-preserving
   update in the dedicated profiles. No upload, signing, tag, push or remote release
   is performed by this milestone.

**Assessment: RELEASE READY PENDING MANUAL VERIFICATION** of the explicit checks
above and store validation/signing. Automated gates permit a local preparation
commit; they do not authorize or prove distribution.

## Historical 0.2.0 milestones

The sections below are historical evidence, not current artifact paths or claims
of 0.3.0 verification. Their original versions/counts/hashes are retained.

The current implementation synchronizes only four designated user preferences.
Bookmarks, Following, collections and memberships stay local. The user reports the
preceding version has been published. Earlier milestone sections below retain
historical candidate evidence; current scope and results are in
[compact UI verification](#compact-ui-polish-and-design-guides).

## Scope and starting state

Release hardening began from `4076d63c4a88120f6df7dad106e57772bf0205bf` on
`master`, tracking `origin/master`. Nothing was staged: 28 tracked edits/deletions and 18 untracked status entries
(including the platform directory). The dirty tree contained
portability, Chrome Sync, scoped Import/Export and contextual Settings/author entry,
including untracked implementation/tests/docs. No unrelated work was identified.
All work was preserved; no reset, restore, checkout-over-changes, clean or stash
was used. The source/diff were copied to a temporary provenance snapshot before
editing. The historical 119 tests matched the actual baseline.

Primary provenance map (many files are shared between milestones):

| Milestone | Main files / overlap |
| --- | --- |
| Portability | `platform/`, local storage/client/popup/background, manifest generation, package script, platform/package tests, Firefox harness |
| Chrome Sync | `sync-model.js`, `sync-storage.js`, native storage transport, shared background events/alarms, exported local validator, collection naming, Sync tests/docs |
| Portable transfer | `portable-library.js`, repository contract/client/RPC, Settings data UI, shared collision names, import/export tests/docs |
| Contextual Settings / author entry | page header gears/CSS, `author-link.js`, author route/navigation handler, content delegation, reusable author view, fixtures/navigation tests/browser smoke |
| This hardening | compatible missing-preference seed, 12 preference tests, Firefox entry/driver fix, deterministic transient-cache browser fixture, new release/live harnesses, release/privacy/verification documentation and candidate version |

Baseline: `npm test` **119/119**; Chromium and Firefox packages **59 files each**;
`git diff --check` passed; Chrome fixture smoke passed. Firefox content Save/Follow
and reload passed before direct WebDriver `moz-extension://` navigation failed.
The older socket restrictions did not recur. The WebDriver failure was a harness
navigation/privileged-context restriction, corrected without production changes.

## Settings and architecture

| Persistent setting | Policy | Rationale |
| --- | --- | --- |
| `openArxivLinksInNewTab` | Sync boolean | Portable desired link behavior |
| `organizeFollowedAuthorsIntoCollections` | Sync boolean | Portable preferred author organization UI |
| `lastUsedPaperCollectionId` | Local pointer | Local saving context |
| `lastUsedAuthorCollectionId` | Local pointer | Independent local following context |

There are no other implemented persistent preferences. Unknown retained settings,
cache/query/freshness, request/queue/filter state and replica diagnostics are
excluded. Settings uses RepositoryClient → shared RPC → LocalRepository → existing
SyncStorage projection → native storage adapter. It has no direct storage calls
or Settings-specific browser event listener. Focus/reopening rereads preferences.

Sync v1 already has boolean `s` registers: no protocol/version evolution was needed.
Desired values use the established logical counter/replica ordering; independent
settings merge independently, stale/replayed records cannot displace retained
winners, and unchanged values do not produce new revisions. Local state/pending
records commit before publication; failures retry through existing alarms/startup.

Existing-local/empty remote seeds local intent at revision zero. Fresh defaults
lose to established remote registers, including remote revision zero. Initial
populated overlaps prefer remote; subsequent conflicts use logical revisions.
An old already-bootstrapped replica without settings now merges validated remote
first and seeds only keys missing on both sides, without revising library data.
Malformed/unsupported remote records pause Sync rather than reset state. Unavailable
Sync leaves local editing/pending intent intact. Firefox stays local-only.
See [Sync compatibility table](chrome-sync.md#bootstrap-failure-and-recovery).

## Original candidate evidence

| Verification | Result / kind |
| --- | --- |
| `npm test` | **131/131**, no skipped/failing tests; automated deterministic |
| Settings Sync | 12 added tests, 39 Sync tests total; independent disks/repositories/shared fake transport; simulated |
| Portable transfer | 15 tests; collection restoration/isolation/idempotency, malformed atomicity, collision handling, v1/earlier v2 and Sync projection; deterministic |
| `npm run test:browser` | PASS on Chrome 154.0.8037.57, disposable profile; original actual popup/geometry, save/follow/reload, Library, Following, filters/actions, RPC, Settings, gears, author/direct refresh/native Ctrl/middle/Enter; real browser with fixtures |
| `npm run test:firefox` | PASS on Firefox 157.0/geckodriver 0.37.1; generated package, content controls/reloads, local-only storage, feeds, extension-origin popup-page navigation/options, preferences, both gears and transient author entry; real browser with fixtures |
| `npm run test:release` | PASS; actual All/collection downloads/native file input, restore/repeat/category isolation, Cancel/malformed feedback; actual Sync events/focus refresh, pending alarm, stopped-worker recreation/publication, extension reload and same-profile full browser restart |
| `npm run test:arxiv` | PASS; actual network pages math/0307245, 2512.03554 and 1706.03762; full displayed names/archive/initial hrefs, five independent views with name-matched paper rows, no follows, primary/Enter/Ctrl/middle/unrelated navigation |
| Both package commands | PASS, 59 runtime/package files each, version 0.2.0; package/source comparisons and manifest tests |
| Diff, permissions and artifacts | Complete accumulated source/new-file review; diff check passes; generated output ignored |
| Account sync | **NOT YET VERIFIED**; one unsigned-in profile's native events are not account propagation |
| Human review | Historical user confirmation concerned the superseded combined transfer UI only; new evidence above is automation, not human manual review |

Firefox's driver requires `--allow-system-access` to inspect extension contexts and
enters from the arXiv author's real navigation, instead of forcing unsupported
WebDriver extension URLs. The fixture proxy binds loopback; direct installed
binaries bypass this environment's broken Snap launcher. No Chrome geometry
assertion was weakened.

The release harness stops the worker with pending state and observes the actual
one-shot alarm/new worker target without repository activity. CDP-loaded unpacked
extensions become disabled by runtime reload; the harness reenables the same ID
through Chrome's own extensions page in its dedicated profile. Restart likewise
reenables that unpacked test installation if necessary. This verifies retained
local state and startup recovery, not signed-store installation lifetime.

## Preserved contracts and audit

Local schema **5**, migrations 1–5, Sync representation **v1** and portable
**v2** semantics are unchanged by this hardening. Combined portable v1 and earlier
unscoped v2 remain readable as documented. New exports/imports exclude Preferences;
legacy preference sections are validated but never applied. Caches and Sync
bookkeeping never enter files, and imported intent follows ordinary Sync projection.

Library and Following gears reuse one Settings page. Author entry reuses the
Following author query/cache/filter/rows/save path with a transient name reference;
no separate author interface or identity algorithm was introduced. Namesakes are
disclosed rather than guessed; Unicode/encoding is fixture coverage. Recognition
remains restricted to known abstract author anchors; original hrefs remain intact.

Production permissions: Chromium `storage, alarms`; Firefox `storage` only;
export.arxiv.org host access and arxiv.org/abs content match unchanged. `alarms`
was the prior Sync milestone's addition, not a new hardening permission. No identity,
OAuth, tabs, downloads, native messaging, backend or broad host permission.
Only `lib/storage.js` accesses native storage; namespace selection stays in platform.
PRIVACY.md now includes transient author caches and the exact preference partition.

The complete audit found and corrected old-replica preference omission and an
unintended live-network dependency in the transient-author fixture smoke. Firefox
navigation/readiness issues and Chrome CDP reload readiness were harness defects;
production code was not changed to accommodate them. No debug instrumentation or
experimental permissions were added to the application.

## Packages and distribution

The accumulated additive desktop features justify the next existing 0.x minor
candidate, **0.2.0**, following the repository's package/manifest version match.
No versioning system, schema migration or new distribution identity is invented.

```sh
npm run package
npm run package:firefox
unzip -l dist/xivary-0.2.0-chromium.zip
unzip -p dist/xivary-0.2.0-firefox.zip manifest.json
sha256sum dist/xivary-0.2.0-*.zip
```

Both archives contain the expected manifest, runtime HTML/CSS/JS, bundled icons/
fonts and font license. Tests compare every non-manifest byte to source and to
both packages. No tests, fixtures, development scripts, hidden files, credentials,
repository metadata, source maps or generated junk are packaged. Firefox differs
only by generated manifest requirements. All directories/ZIPs remain ignored;
archives are unsigned and no store submission occurred.

Original candidate artifacts before the Following repair:

| Browser | Files | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Chromium | 59 | 202022 | `f80e3fb817938eb942ccc4c9a078034056e9e26146ca6d8a3d7b4edcc7779aa7` |
| Firefox | 59 | 202092 | `740be975644cc6a8d34e07dcaf079aec977419eabc53b31a4b830f702924209f` |

Packaging prints SHA-256;
report the hashes of the final artifacts because ZIP timestamps can change hashes.

## Following collection repair

The clean candidate HEAD `124f5e7994a391258e81f4192f7af9287fb139e4` was the
starting point (master, two local commits ahead). Baseline 131/131 passed. The
Following page did not read its organization setting or collection snapshot;
Settings, storage, Sync and portable files already supported collections. The
repair adds the missing opt-in sidebar workflow and reuses the author picker and
Library's shared sidebar CSS. Disabled mode keeps assignments and the simple list.
See [investigation, workflow and regression record](following-collections.md).

Current verification: **135/135 Node tests**, including four new workflow/legacy/
malformed/portable/independent-replica regressions (40 Sync simulations total).
Chrome 154 and Firefox 157 both exercise the full Following workflow with native
clicks/Enter/Escape; Chrome checks desktop/narrow geometry. The existing release
suite passes native Bookmarks/Following transfer, Sync lifecycle, remote preference
focus refresh and restored collection browsing after full Chrome profile restart.
This is automated real-browser evidence, not human review or account propagation.
The optional live-network harness now waits for completed feed metadata/error rather
than the initially enabled Refresh button before sampling retrieval results.

Schema 5, migrations, Sync v1, portable v2, permissions, dependencies and candidate
version 0.2.0 are unchanged. Package/source and cross-browser byte comparisons
pass; the new shared sidebar stylesheet is the only additional runtime file.
Both rebuilt packages contain **60 files**. Generated archives remain ignored.
The original evidence and hashes above are historical, not the repaired archives.
Live-network rerun passed on the same three real abstracts: five author views
rendered 3, 2, 39, 26 and 7 matching rows, with native primary/Enter/Ctrl/middle and
unrelated navigation retained. These counts are observations, not guarantees.
All manual distribution checks in the release assessment remain required; no signing, push, publishing or credential automation occurred.

Following-repair artifacts before the settings-only cutover (unsigned, ignored):

| Browser | Files | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Chromium | 60 | 205530 | `6da3099740bceeb3f31c1b3ec29c6fd83034b399050c264bfc13848cb2331881` |
| Firefox | 60 | 205600 | `169ae7108272bf952615843aacb94a1c80bb6b8fd6ff6176828e65bd3c20b296` |

## Settings-only Sync cutover

Started from clean `f33a925dd812ad04005cb864d7aae0defbb605e4` on master,
three commits ahead of origin. Baseline 135/135 passed. The nondestructive
[strategy was recorded before implementation](settings-only-sync-migration.md).
Only the two existing boolean preference registers are active. Library records,
collections/memberships, caches, unknown settings and last-used pointers stay local.
Existing local data and inert replica records/snapshots are retained. Remote legacy
records/tombstones are ignored, never repaired/deleted; fresh installations restore
only preferences. Older versions may still synchronize library data themselves.
Schema 5/migrations, Sync v1 preference encoding, portable v2, permissions,
dependencies and candidate version 0.2.0 are unchanged.

Deterministic evidence: **135/135 Node tests**, including **40 Sync simulations**.
Obsolete library-propagation/conflict expectations were replaced by explicit local
isolation and legacy-cutover regressions; preference bootstrap, ordering, replay,
restart, write/read failure, quota and coalescing coverage remains. The existing 15
portable tests preserve All/collection restoration, isolation, collisions, atomicity,
legacy compatibility and preference exclusion, now asserting no library upload.

Chrome 154/Firefox 157 fixture suites pass, including full Following organization.
The Chrome release suite passes native category transfer, existing local legacy
replica preservation, untouched remote legacy live/malformed records, a fresh
unsigned-in profile receiving preferences without library restoration, onChanged/
focus refresh, pending alarms/worker recovery, extension reload and full-profile
restart. No production permission or test-only behavior was added. These are native
browser tests with test-authored records, not account transport or human review.
Packages retain 60 source-matched runtime files each; only generated manifests
differ. Archives remain ignored and unsigned. The current artifact inspection is
recorded below. No push/signing/publishing or normal-profile credentials are used.

Settings-only cutover artifacts before interaction polish (unsigned, ignored):

| Browser | Files | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Chromium | 60 | 203799 | `22ad9feae74252d054fd87975726bd470aaf686f613d2d84dd78b6be1cb8ff6e` |
| Firefox | 60 | 203869 | `8a28ea746bc851c634c3e8d2c19617ac6547a3089206ffa81113b667ac6d8c62` |

## Author navigation and interaction polish

Started clean on master at `c0c1a1fab86a990f51904010fcb6bd00b95217eb`, matching
origin; baseline **135/135** passed. User reports the preceding extension was store
published; no published binary/ID is available for independent byte comparison.
Current implementation remains version 0.2.0 and is **not yet a new upload version**.
No push, publication, signing or credential automation is performed.

**149/149 Node tests pass** (41 Sync, 15 portable, 9 Undo). Chrome 154 complete
fixture/geometry smoke plus the new polish suite pass; Firefox 157 fixture smoke
passes author-heading Unfollow/Undo and expanded Following forms/dialog/Undo flows.
Chrome release suite passes native transfers, untouched legacy Sync cutover, three
eligible test-authored preference registers/focus, worker/alarm/reload/profile
recovery. These are real browsers with fixtures/simulated peer intent; neither
account transport nor human review is implied. Standard search HTML was fetched
from arXiv, but current live API and published-store binary behavior were not verified.

Packages inspected: 64 runtime files each, source-identical non-manifest bytes,
version 0.2.0, only intended platform manifest differences. No tests, fixtures,
scripts, repository metadata or development junk are packaged. API permissions,
export.arxiv.org host scope, schema 5/migrations and portable v1/v2 remain unchanged.
The manifest adds the narrow arXiv `/search/*` content match needed for the feature.
Archives remain ignored; previous artifact tables are historical.

| Browser | Files | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Chromium | 64 | 208789 | `9eae8b5c00669b30243f7f79dcd52b1eecce6f3e9bfcc544e720227ede100163` |
| Firefox | 64 | 208856 | `e8d33dcd4c100ed73f53d9d37844f4739fd9b4feb6ab8fd8c9015832ce2c71c7` |

See [implementation, compatibility, Undo contract and investigation](author-interaction-polish.md).
All automated commit gates pass. A subsequent store update still requires choosing
its next version and the manual checks below, including same-account delivery of
`openAuthorResultsInNewTab`, native context-menu/copy/Cmd interactions, minimum
versions and Firefox-native distribution/transfer surfaces. Do not upload this
same-version development archive over the published release.

## Git integration policy

Both required browser suites now pass, so the historical runtime gate no longer
prohibits commits. It was not relaxed. External/manual checks remain documented;
passing runtime simulation does not convert them to account/store evidence.

The accumulated implementation is integrated as one coherent dependency set:
repository/background/client/Settings files overlap portability, Sync and transfer,
and Firefox's real entry test depends on author integration. Artificial historical
splits would require reconstructing unverified intermediate implementations. Keep
that combined source/test/design commit separate from candidate version/release
metadata and status documentation. Inspect each staged diff, preserve actual
provenance, and commit no generated archives. Implementation/design integration
is commit `5a4e972`; the subsequent candidate
metadata/status commit contains the matched version, privacy, changelog and
verification record. No implementation or archive is intentionally left dirty.
No push or store publishing is part of this milestone.

## Release assessment

**RELEASE READY PENDING MANUAL VERIFICATION:**

1. Same-account, same-extension-ID Chrome **preference-only** propagation between
   dedicated A/B installations; offline convergence and unavailable/disabled Sync.
   Confirm saves/follows/collections/memberships/imports/last-used pointers/caches
   stay local, including upgrade/fresh-install behavior with old remote records.
   Legacy remote data must remain untouched. No credentials are automated.
2. Firefox's real toolbar popup and native download/file-picker All/collection
   flow, repeat/Cancel/malformed and legacy-category selection; signed installation
   and installed-extension browser restart.
3. Declared Chrome 102/Firefox 140 minimums and distribution identity/signing.
   Native context-menu/copy-link and macOS Cmd-click/assistive keyboard interaction
   require human checks. Edge/Brave compatibility is not claimed separately.

See [the browser checklist](browser-support.md#pending-manual-chrome-sync-checks).
All automated commit gates pass; this is a packaged candidate, not a claim that
account transport, store installation or every manual surface is verified.

## UI consistency and popup launcher milestone

Started clean at `7ab2856`, preserving both earlier local commits. Version remains
0.2.0; this milestone is preparation for a future 0.3.0 update, not an upload-ready
version or a publication. The popup stays; its Library/Following choices now use
the fourth default-true synchronized preference. Data formats/permissions are
unchanged. Node 156/156 and Chrome/Firefox fixture smoke pass. Popup/control/dialog
screenshots were inspected. Firefox toolbar, account propagation, minimum versions
and distribution/manual checks above remain unclaimed.

See [complete scope and final results](ui-launcher-polish.md).

All automated commit gates pass, including native category transfers and
fourth-preference pending publication through alarm/worker and profile recovery.
68-file archives were inspected against source, with no development artifacts.

| Browser | Bytes | SHA-256 |
| --- | --- | --- |
| Chromium | 211781 | `de60a1dbd0f57d014a64edbe893c6ec36bc46ceb6eab47f541be80629c6bcbdc` |
| Firefox | 211847 | `6d188860df9d6215151942406f794c643c05c34ff252d2c6832285925d90c4c0` |

## Compact UI polish and design guides

Started clean at `ab389a3`; 156/156 baseline Node tests. Final 158/158, complete
Chrome/Firefox fixture smoke, native transfer/Sync lifecycle, both packages and
`git diff --check` pass. Shared sidebars now preserve counts and expose compact
Rename/Delete menus; unchanged focus refresh retains menu/input focus. Library
filter count/Clear search and density, Following spacing, and the actual Chrome
300 × 159px popup were visually reviewed, including narrow/long-name/count fixtures.
Firefox desktop extension-page/menu/dialog screenshots were inspected separately.
Its native toolbar widget is still manual. See [evidence](browser-support.md) and
[implemented UI design](UI_DESIGN.md); [general principles](DESIGN_PRINCIPLES.md)
are reusable beyond the extension.

The complete diff was reviewed. No schema, storage/collection rules, preferences,
Sync/portable formats, arXiv behavior, launcher semantics, dependencies, permissions
or version change. No data reset, push, signing or publishing. These same-version
artifacts are development verification packages, not a store upload. External/
manual release checks above remain required before distribution.

Both 69-file ZIPs were inspected: runtime files match source byte-for-byte,
non-manifest files match across browsers, generated manifests retain justified
platform differences, and no development fixtures, credentials or repository
metadata are included. Generated archives remain ignored.

| Browser | Bytes | SHA-256 |
| --- | --- | --- |
| Chromium | 213806 | `1b39e014c0f927c0c1c61f15fd5b690f5112f27e6b36f1ff80e82d6db8429b6a` |
| Firefox | 213872 | `0dc74423f145917380e83b80c4b9fda372810bcb97665cd6f7ce852e4f3eec8d` |

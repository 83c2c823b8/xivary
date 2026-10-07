# Xivary 0.2.0 release record

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
See [Sync compatibility table](chrome-sync.md#settings-policy-and-compatibility).

## Evidence

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

Final inspected candidate artifacts:

| Browser | Files | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Chromium | 59 | 202022 | `f80e3fb817938eb942ccc4c9a078034056e9e26146ca6d8a3d7b4edcc7779aa7` |
| Firefox | 59 | 202092 | `740be975644cc6a8d34e07dcaf079aec977419eabc53b31a4b830f702924209f` |

Packaging prints SHA-256;
report the hashes of the final artifacts because ZIP timestamps can change hashes.

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

1. Same-account, same-extension-ID Chrome propagation between dedicated A/B
   installations: save/follow/collections/memberships/deletions, both boolean
   preferences, and non-propagation of valid last-used pointers/caches; offline
   convergence and disabled/unavailable Sync. No credentials are automated.
2. Firefox's real toolbar popup and native download/file-picker All/collection
   flow, repeat/Cancel/malformed and legacy-category selection; signed installation
   and installed-extension browser restart.
3. Declared Chrome 102/Firefox 140 minimums and distribution identity/signing.
   Native context-menu/copy-link and macOS Cmd-click/assistive keyboard interaction
   require human checks. Edge/Brave compatibility is not claimed separately.

See [the browser checklist](browser-support.md#pending-manual-chrome-sync-checks).
All automated commit gates pass; this is a packaged candidate, not a claim that
account transport, store installation or every manual surface is verified.

# Project guidance

This is a frequently used academic research utility. Secondary information should
be visually restrained, but primary actions such as Follow and Save must remain
immediately recognizable and comfortably clickable.

Optimize for learned efficiency rather than zero-learning discoverability. A
feature's existence does not justify a permanent button, tab, card, toolbar, or
explanation. Prefer a small predictable interaction model and progressive
disclosure: keep primary actions obvious and reveal infrequent operations only
when needed. Consistency, alignment, and functional density matter more than
visual novelty.

Keep the interface compact, conventional, desktop-oriented, and typography-led.
Use system UI fonts, normal blue links, restrained colors, subtle borders, and
information-dense rows. Do not add marketing copy, hero layouts, decorative cards,
gradients, gratuitous shadows, or generic SaaS styling.

All persistent operations must cross `PaperRepository` through `RepositoryClient`.
Only `extension/src/lib/storage.js` may access browser storage areas. Paper and
author collections are separate many-to-many models with separate last-used
settings. Preserve stable IDs, lossless/idempotent migrations, JSON-compatible
records for a future backend, and the documented same-name author limitation.
Paper collections are user-facing; author collections remain compatible in
storage but are hidden from the default Follow/Following UI. When organization is
enabled, Following uses Library's sidebar interactions and the existing author
membership picker. Disabling it hides controls without changing assignments.
All Following is a membership aggregate; default/migrated follows remain accessible.
Disclose final-membership unfollow and sole-collection deletion consequences.
See `docs/following-collections.md` for the workflow and regression evidence.
Search is hidden from
primary navigation. Paper notes are deferred and must not be exposed without a
separate, demonstrated product need.

Keep native extension API namespace selection inside `extension/src/platform/`.
Modules use `getBrowserApi()`; the classic content loader is the sole bootstrap
exception inside that boundary. Prefer native Promise APIs (`browser`, then
`chrome`); do not add browser checks in application code. Preserve one shared
background repository entry point and all schema-5 semantics. Each browser/profile
has a local schema-5 view. Chrome synchronizes only the four designated preferences;
Firefox stays local-only. Cross-browser execution does not imply shared state.

Chrome sync is below LocalRepository in `repository/sync-storage.js`, with pure
record projection/merge in `repository/sync-model.js`. Do not move storage access
into UI code or copy the whole schema-5 envelope to sync. Keep caches, full local
paper metadata and last-used collection settings local. Sync v1 is independent
of schema 5; preserve preference logical revisions and retained winners. Legacy
library records/generations/tombstones remain inert and must never upload, merge
or restore local library data. Leave remote legacy data untouched.
Local commits (including pending replica records) precede best-effort sync writes.
No wall-clock conflict ordering, toggle replay, tombstone expiry, or reset-on-error.
Only `openArxivLinksInNewTab`, `organizeFollowedAuthorsIntoCollections`,
`openAuthorResultsInNewTab` and `openXivaryFromToolbarInNewTab` enter
Sync registers. Bookmarks, Following, collections and memberships remain local.
Both last-used pointers remain local. Older replicas
missing preference registers seed only absent local/remote keys after validated
merge, at revision zero. See `docs/chrome-sync.md` for bootstrap, conflict, quota
and privacy decisions.

Portable import/export is a separate repository-level path. Never use the raw
local schema envelope or Chrome Sync records as the backup format. Preserve the
independent `xivary-library` format version, exclude caches, last-used pointers and
all sync bookkeeping, validate the whole document before one local write, and keep
merge behavior idempotent. Imported Bookmarks/Following state remains local and
must not enter Chrome Sync.
Preferences use the existing LocalRepository/SyncStorage boundary. See
`docs/import-export.md`.
Importing one portable category must never modify user-owned state belonging to
another category. Bookmarks own papers and paper collections/memberships;
Following owns followed authors and author collections/memberships. Preferences
have no manual import/export and remain on their existing Chrome Sync path.
Version-2 exports declare category and all/collection selection; a collection
file contains only that collection and its memberships. Combined v1 files remain
selectable by Bookmarks or Following during import, without applying preferences.
There is no unclassified saved/followed state: each live entity has a membership.

Two-device simulation tests are required for changes to synchronization. They do
not prove Google-account propagation. The Chromium-only `alarms` permission is
for deferred writes/recovery; Firefox's generated manifest omits it and never
enables its sync area. Keep browser verification limitations explicit.

`extension/manifest.json` remains the unpacked Chromium manifest and common source.
`scripts/browser-manifest.mjs` derives Firefox's MV3 event-page manifest. Generated
copies under `dist/` are artifacts, never separately maintained application trees.

Run `npm test`, `npm run test:browser`, `npm run test:firefox`, both packaging
commands (`npm run package`, `npm run package:firefox`), and `git diff --check`
before committing portability changes. Tests require zip/unzip; Firefox smoke
also requires Firefox, geckodriver, OpenSSL, and loopback networking. Do not weaken
Chrome geometry coverage for Firefox. Record blocked runtime checks explicitly;
see `docs/browser-support.md` for the current verification limits and manual checks.

Library and Following gears open the existing Settings page. arXiv author entry
reuses the author view/query/cache/paper rows without automatically following.
Keep recognition restricted to known abstract and standard search-result
author-search anchors, preserve the underlying href and intercept only unmodified primary activation. Names remain
name keys, not verified identities; preserve namesake disclosure and direct routes.

Run `npm run test:release` for native transfer and Chrome Sync lifecycle changes.
`npm run test:arxiv` is an optional live-network check, separate from deterministic
fixture suites. Never automate account credentials or use normal browser profiles.
See `docs/release.md` for package inspection and outstanding manual release checks.

Author-results Follow/Unfollow is explicit and membership-based. Inbound author
navigation has its own default-true `openAuthorResultsInNewTab` preference; outbound
`openArxivLinksInNewTab` remains default-false. Both use repository preferences.
Ordinary removals offer eight-second background-owned, nonpersistent Undo receipts;
restore only removed metadata/memberships and reject expired or changed items.
Collection deletion uses native confirmation with actual sole-member consequences.
Library and Following share creation keyboard/outside-click behavior. A non-Atom
response is an error; loading/error must never masquerade as genuine empty results.
See `docs/author-interaction-polish.md` for scope and release evidence.

Keep the toolbar popup and its counts/Settings gear. Only its Library/Following
rows use default-true `openXivaryFromToolbarInNewTab`; keep that fourth designated
Sync preference separate from inbound author and outbound arXiv navigation.
Use shared restrained control/dialog tokens; Following rows reuse Follow
presentation and the existing collection picker. Do not change deletion/Undo data rules.

Follow `docs/UI_DESIGN.md` for implemented compact UI conventions and
`docs/DESIGN_PRINCIPLES.md` for reusable principles. Library/Following share the
sidebar presentation helper: retain aggregate vs folder icons, stable counts and
always-accessible overflow triggers. Collection menus do not select rows; retain
keyboard/outside dismissal, focus return and existing deletion confirmation.
The actual toolbar popup is 300px wide; retain native geometry coverage and
launcher semantics. Inspect rendered screenshots alongside behavior tests.

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
background repository entry point and schema-5 many-to-many semantics. Current
local storage is schema 8, with automatic registered upgrades from schemas 1–7.
Chrome synchronizes only the four designated preferences;
Firefox stays local-only. Cross-browser execution does not imply shared state.

Chrome sync is below LocalRepository in `repository/sync-storage.js`, with pure
record projection/merge in `repository/sync-model.js`. Do not move storage access
into UI code or copy the whole local envelope to sync. Keep caches, full local
paper metadata and last-used collection settings local. Sync v1 is independent
of local schema 8; preserve preference logical revisions and retained winners. Legacy
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
Settings uses portable version-3 ZIP/JSON backups with explicit IDs/order and
self-contained individual collection files. It does not migrate obsolete portable
file formats. See docs/import-export.md; installed-data compatibility is a separate,
mandatory concern.
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
focusable rows with double-click/F2 rename and right-click/Shift+F10/Context Menu
actions; Library and organized Following reveal their contextual ellipsis on hover/focus. Library and Following author reorder handles appear on row hover/focus without an editing mode;
reserve separate handle and menu tracks so counts never overlap controls. Following author-array order is authoritative for All Following;
only live-author slots move there. Individual author collections use independent
`authorOrdering.collectionOrders`; never change global order or other collections
for a scoped move. Search hiding scope members disables movement. Portable v3
`ordering.following` and optional `ordering.authorsByCollection` preserve both;
do not re-sort by follow timestamp after migration.
The shared reorder controller owns input-specific focus: preserve keyboard focus
through saves, release pointer-drag focus on completion/cancellation, and never
unconditionally refocus a handle from a page save callback. Collection menus do not select rows; retain
keyboard/outside dismissal, focus return and existing deletion confirmation.
The actual toolbar popup is 300px wide; retain native geometry coverage and
launcher semantics. Inspect rendered screenshots alongside behavior tests.

Collection pickers share trigger-anchored viewport positioning: prefer below, flip
above or constrain to available space, clamp horizontally, and update on scroll,
resize and content changes without losing input state. Close when the trigger is
removed and clean up observers/listeners; preserve membership and Undo semantics.

Automatic upgrade safety is mandatory. Any code change that modifies persistent
storage must include the corresponding automatic migration and upgrade-path tests
in the same milestone. Keep schema versions independent of the manifest version;
register explicit, consecutive steps in repository/local-schema.js and validate
before activating a new schema. Preserve original user data in the local migration
recovery snapshot before transformations. Never clear/reset storage, overwrite
valid records with defaults, or auto-restore an old snapshot over newer work.
All reads/mutations cross the shared migration barrier and repository lock;
MigrationStorage remains below SyncStorage. Keep Offline IDB/Feed versions and
Library RPC snapshot versions explicit and independently tested. Current-schema
integrity failures must surface recoverable errors, never fake empty results.
See docs/storage-migrations.md for startup/reload/retry, recovery and developer rules.

Library remembers only its last selected collection in the separate local
`xivary:library-selection` version-1 UI preference. Keep it distinct from the
last-used bookmark destination, Chrome Sync and portable backups. Restore before
first render; explicit collection URLs win and missing IDs use All Saved. Do not
persist search, filters or scroll. See docs/library-selection.md.
Organized Following uses the same sidebar handles/menu tracks and keeps collection
array order (portable `ordering.authorCollections`) independent of author order.
Its separate `xivary:following-selection` version-1 UI preference is local-only,
excluded from backups, and restored before rendering. Hiding organization must not
rewrite it. Collection moves announce through the visually hidden live region.
See docs/following-collection-ordering.md.

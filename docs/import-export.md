# Bookmarks and Following import/export

Settings has compact Import and Export actions for Bookmarks and Following. Export
opens a native dialog with **All** and the existing collections for that category.
The selection is made through the repository, so Settings does not read browser
storage or manipulate raw IDs. Import merges the chosen file through the repository.
Preferences have no manual Import or Export action; the two boolean preferences
continue to use the existing Chrome Sync mechanism.

## Portable format

New files are human-readable JSON with `format: "xivary-library"`, `version: 2`,
`category: "bookmarks"` or `"following"`, `exportedAt`, and a `selection` object:

```json
{ "kind": "all" }
```

or:

```json
{ "kind": "collection", "collectionId": "paper-collection:example" }
```

The remainder contains only `papers`, `paperCollections`, `paperMemberships` for
Bookmarks or `authors`, `authorCollections`, `authorMemberships` for Following.
An All file includes every saved paper or currently followed author, every
collection (including empty ones), and all corresponding memberships. A
collection file includes exactly one collection, its members, and their
memberships **in that collection only**. Papers or authors with additional
memberships elsewhere do not carry those other classifications in this file.
Importing the file restores the exported collection, members, and relationships.
Empty collection files restore the collection without clearing existing data.

There is no Unclassified option: a saved paper must have a paper collection
membership, and a currently followed author must have an author collection
membership. Papers losing their final membership are unsaved; author entities
without memberships are retained locally but are not followed or exported.
Single-item export is omitted because the Settings selector presents collections;
adding a potentially long paper/author picker there would complicate an infrequent
operation. Individual items can be placed in a collection and that collection
exported.

The filenames are `xivary-bookmarks-all-YYYY-MM-DD.json`,
`xivary-bookmarks-collection-YYYY-MM-DD.json`, and corresponding `following`
names. The selected collection's name is in the file, while the filename stays
safe and predictable. `exportedAt` is informational, never conflict ordering.
Format version 2 is independent of local schema 5 and Chrome Sync v1.

## Validation and merge

Import parses and validates the entire document before touching the repository.
It checks exact fields, format/version/category, selection, records, timestamps,
duplicates, memberships and references. A collection file must contain exactly
its declared collection, and every membership must point to it. The repository
merges only the selected category into the current state, validates the complete
schema-5 proposal, and submits one local write. A malformed file causes no
mutation. A failed local write leaves previously stored data intact under the
storage behavior used by Xivary. Chrome Sync publication is separately best effort
after the local commit.

Import never clears existing records. Stable IDs and membership pairs union;
repeated import is idempotent. Existing nonempty paper metadata wins, while
imported tags and categories union and imported values fill appropriate empty
fields. Earliest creation/add/save dates and latest update dates are retained.
An existing collection ID keeps its local name, except for the pristine built-in
Saved Papers seed during a fresh restore. Distinct IDs with colliding names both
survive with deterministic ` (2)`, ` (3)` suffixes from the shared Chrome Sync
collection-name policy. Bookmarks imports leave Following, preferences, caches and
local-only settings untouched; Following imports likewise leave Bookmarks,
preferences, caches and local-only settings untouched.

## Older files

Combined `xivary-library` version-1 exports remain accepted by either Import
action. The entire old file is strictly validated, including its preferences, but
only the selected Bookmarks or Following portion is merged. Its preferences are
never applied by these actions. The combined export action is no longer present.
The previous combined file selection and download flow was manually verified
successfully in real Google Chrome before the collection-selector refactor.

The earlier dirty-tree version-2 category files without `selection` remain
importable as **All** for Bookmarks or Following. Those files were not released.
Earlier version-2 Preferences files are rejected; manual preference transfer is
not part of the corrected product model. Unknown future versions fail safely.

## Privacy and Sync

Files exclude author-feed caches, last-used collection pointers, unknown storage
fields, queues, and all Sync replica IDs, revisions, generations, tombstones,
bootstrap snapshots and retry state. Never use the raw schema-5 envelope or Sync
records as the portable format. Xivary does not upload these files. Imported
Bookmarks and Following changes reach Chrome Sync only through the ordinary
LocalRepository/SyncStorage projection. The Sync representation and conflict
semantics are unchanged. Firefox remains local-only.

## Release verification

Fifteen deterministic portable-file tests preserve scoped classification,
restoration, category isolation, repeat merge, malformed-file atomicity, collection
collisions, legacy combined v1, earlier unscoped v2 and ordinary Sync projection.
Preference Sync tests additionally verify imports leave preference values/revisions
unchanged. New files contain no Preferences.

`npm run test:release` passed the real Chrome All/collection selector, downloads,
native file-input upload, restoration after source-collection deletion, repeated
imports, unrelated category/preference preservation, Cancel focus/no download and
malformed JSON feedback. These are real browser operations using fixture library
data, not a manual human review. Firefox shows the two transfer entry points in its
smoke suite; its native file/download flow and legacy picker selection remain
manual release checks in [browser-support.md](browser-support.md).

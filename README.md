# Xivary

Version **0.3.0** is prepared for manual submission; see [release verification and
publication steps](docs/release.md#v030-release-preparation). No automatic upload occurs.

Library (Bookmarks) and Following have a Settings gear in their page header. Both
open the existing Settings page, including preferences and category-specific data
transfer.

On supported arXiv abstract and standard search-results pages, an ordinary click
or keyboard activation of an author-name search link opens the existing Xivary
author papers page. **Settings → General → Open arXiv author names in Xivary in a
new tab** defaults to enabled; disable it for the current tab.
Viewing does not follow the author. Follow/Unfollow beside the name is explicit.
The view matches full displayed names and may
include namesakes; arXiv's abbreviated author-search URL is not a verified person
identifier. Modified clicks, middle clicks, and unrelated links retain their native
arXiv destinations.

Xivary is a local-first extension for saving arXiv papers and following authors.
One application source tree targets Chromium-family browsers and Firefox desktop.
Chrome 154 and Firefox 157 fixture smoke suites pass; see
[browser support](docs/browser-support.md) for exact evidence and pending manual
distribution checks.
Chrome synchronizes only the four designated boolean user preferences through
its extension sync storage. Bookmarks, Following, collections and memberships
remain local to each installation. Real account/device propagation remains
unverified. Xivary has no
account, project-owned backend, or analytics.

## Features

- Compact **Follow** and **Following** controls beside authors on arXiv abstract pages.
- A Following list and per-author paper feeds retrieved from arXiv's public Atom API.
- Paper saving from arXiv pages and author feeds.
- Named paper collections with inline creation, double-click/F2 rename, context-menu deletion, and membership controls.
- Optional Following collections with the same sidebar management and collection
  browsing. Enable **Settings → Following → Organize followed authors into
  collections**; use each author's folder-icon collection picker to assign memberships.
  To move, select the destination before clearing the source. Disabling organization
  preserves assignments. [Workflow and data rules](docs/following-collections.md).
- Eight-second Undo for ordinary item/membership removals; confirmation for deleting
  an entire collection, including sole-membership consequences.
- Local text filtering of saved papers and author feeds, with shared rolling time
  presets and inclusive custom year ranges in Library and author feeds.
- A compact popup for opening Library and Following and viewing their counts.
  **Settings → General → Open Xivary from toolbar launcher in a new tab** defaults
  to enabled. Disable it to replace the active tab when choosing a popup row;
  the toolbar icon still opens the popup, and its Settings gear is unchanged.
- Settings for opening arXiv links in a new tab and optionally organizing followed
  authors into collections.
- Explicit JSON export/import for backing up or transferring Library and Following
  data without exposing storage or sync internals.

The separate field-aware Search page remains packaged for direct testing but is not
linked from primary navigation in this release.

## Data and privacy

Saved papers, followed authors, collections, preferences, and cached author-feed
results have a browser-local view in `storage.local`. In the Chromium package,
only `openArxivLinksInNewTab`, `organizeFollowedAuthorsIntoCollections`,
`openAuthorResultsInNewTab` and `openXivaryFromToolbarInNewTab` use
`storage.sync`. Both last-used collection pointers, all library records and feed
caches remain local. Chrome and Firefox installations have independent libraries;
Firefox settings remain local too. Filters and pickers remain ephemeral.

Existing local data is preserved, including anything restored by older versions.
Legacy Sync v1 library records are ignored and left untouched remotely; they cannot
restore, overwrite or delete local items. Older extensions can still sync library
data among themselves. New installations receive preferences only. Preferences
keep logical revision/replica conflict ordering, pending writes and local-first
retry behavior. No schema or portable-file migration is needed. See
[settings-only migration](docs/settings-only-sync-migration.md) and
[Sync design](docs/chrome-sync.md). Real Chrome-account propagation remains a
manual release check; dedicated test profiles do not prove it.
It sends author-name searches to `https://export.arxiv.org/` when loading or refreshing
an author feed. It does not send library data to a project-owned service.

Settings exports or imports Bookmarks and Following independently. Export opens a
small selector for all items or one existing collection. A version-2
`xivary-library` JSON file identifies that selection and contains only its
papers/authors, collection definitions and memberships. Import also accepts an
older combined version-1 backup but applies only the chosen Bookmarks or Following
section. Preferences have no manual file transfer; the four boolean settings use
Chrome Sync, while last-used collection pointers remain local. Files exclude feed
caches, last-used choices and every Chrome Sync
revision, tombstone, replica or retry field. See
[import/export](docs/import-export.md) for formats and merge rules.

See [PRIVACY.md](PRIVACY.md) for the stored data, network behavior, and permission
rationale.

## Install for development

1. Open `chrome://extensions` in Chromium or Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the `extension/` directory.
4. Open an `https://arxiv.org/abs/...` page. Reload the extension and refresh existing
   arXiv tabs after code changes.

For Firefox, run `npm run package:firefox`, open `about:debugging#/runtime/this-firefox`,
choose **Load Temporary Add-on**, and select `dist/firefox/manifest.json`.
Use Firefox desktop 140 or newer and allow the requested arXiv site access.
Repackage after source changes, reload the temporary add-on, and refresh arXiv tabs.
Temporary installation is for development; ordinary Firefox distribution requires
Mozilla signing. The generated ZIP is unsigned, and no store submission is automated.

Node.js 20 or newer and the standard `zip`/`unzip` utilities are required for tests
and packaging:

```sh
npm test
npm run test:browser
npm run test:firefox
npm run test:release
npm run package
npm run package:firefox
```

`npm run package` retains Chromium as the default and writes
`dist/xivary-0.3.0-chromium.zip`; `npm run package:firefox` writes
`dist/xivary-0.3.0-firefox.zip`. Unpacked artifacts are also generated under
`dist/chromium/` and `dist/firefox/`. Only the generated manifests differ;
application files are copied unchanged. Archives contain runtime files and the
bundled font license, with `manifest.json` at the root.

Chrome smoke testing uses `CHROME_BIN` (default `/usr/bin/google-chrome`).
Firefox smoke testing needs geckodriver, Firefox, OpenSSL, and permission to bind
loopback ports; set `GECKODRIVER_BIN` and `FIREFOX_BIN` for nonstandard installations.
The fixture suites use temporary profiles. `npm run test:release` additionally
checks native category downloads/file inputs and real Chrome Sync events,
alarm/worker recovery, reload and test-profile restart. It uses one unsigned-in
profile and does not verify Google-account delivery. `npm run test:arxiv` is the
separate live-network author-link check; the preceding milestone verified three
actual abstracts in Chrome. Current search support was checked against fetched
search HTML and native browser fixtures; current live API behavior was not verified.
See [release packaging and remaining checks](docs/release.md).

## Architecture

Every persistent operation crosses `PaperRepository` through `RepositoryClient`.
The background context owns the local repository: a Manifest V3 service worker on
Chromium and a nonpersistent module event page on Firefox. Both execute the same
entry point. `extension/src/platform/` isolates native API selection; only
`extension/src/lib/storage.js` accesses browser storage areas. A repository storage
adapter adds Chrome sync beneath the existing domain operations. IBM Plex Sans Regular
and SemiBold are bundled locally under the SIL Open Font License; no runtime font or
script is loaded from a third party.

See [docs/architecture.md](docs/architecture.md) and
[shared/schema/data-model.md](shared/schema/data-model.md) for implementation details.

## Known limitations

- Author identity uses normalized names rather than verified identifiers. Different
  people with the same normalized name share follow state, while spelling, initials,
  or name-order variants can appear as separate authors.
- Author feeds contain up to the 50 newest matching results returned by arXiv and
  depend on availability and name matching from the arXiv API.
- Chrome synchronizes only four preferences. Retained legacy remote library records
  can still occupy provider quota; Xivary leaves them untouched and keeps failed
  preference uploads local and pending. There is no Xivary account or custom backend.
- Real Google-account propagation, Firefox native transfer/toolbar flows, signed
  installation and declared minimum versions still require verification.
- There is no mobile application. The extension targets desktop browsers.

## License

Xivary is released under the [MIT License](LICENSE). The bundled IBM Plex font files
retain their separate SIL Open Font License in
[`extension/assets/fonts/LICENSE.txt`](extension/assets/fonts/LICENSE.txt).

See [author navigation and interaction polish](docs/author-interaction-polish.md)
for current verification, additive preference compatibility and the bounded API investigation.

See [Xivary UI design](docs/UI_DESIGN.md) for implemented compact sidebars,
collection menus, the 300px popup and keyboard conventions, and
[reusable design principles](docs/DESIGN_PRINCIPLES.md) for guidance across projects.

# Xivary

Version **0.5.1** fixes disabled Following author handles and adds independent
collection author ordering, direct collection/paper handles, keyboard/focus polish
and local last-selected collection restoration. See the
[release record](docs/release.md#v051--2026-10-15) for verification and remaining
manual distribution checks. No extension-store submission is included.

Library (Bookmarks), Following, Offline and Author Results share a Settings gear in their
page header. It opens the existing Settings page in the current tab, including
preferences and category-specific data transfer.

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

Optional library synchronization was [audited](docs/library-sync-audit.md).
Chrome Sync exposes no authoritative operation-acceptance log; strict arrival-order
library synchronization is blocked. The audit includes reproducible capacity
measurements and safety counterexamples. It does not enable library uploads.

## Features

- An incremental research Feed for recent papers by followed authors and direct
  coauthors, with a small terminology-backed related-area source. It retains a
  bounded local queue, finite pagination and stable bookmark behavior.
- Small, selectable, non-interactive canonical arXiv IDs on shared paper rows.
- Contextual drag/keyboard ordering of Library collections and their papers, with
  automatic upgrade safety and lossless version-3 portable backups.

- A compact **Offline** tab for local PDFs, with discreet save icons on paper rows
  and arXiv abstracts. Offline title clicks use Chrome’s native PDF viewer; PDF
  export/removal stay in the contextual menu. Bookmarks remain independent.
  [Storage, permissions and browser evidence](docs/offline-storage.md).
- Compact **Follow** and **Following** controls beside authors on arXiv abstract pages.
- A Following list and per-author paper results from arXiv’s public Atom API.
  New author pages display usable streamed entries before retrieval finishes.
  All extension API requests share one paced queue with HTTP 429 recovery.
  Results remain limited to the first 50 arXiv hits, with full-name matching.
- Search followed authors by part of their name, locally and case-insensitively.
  The temporary query combines with collection browsing and clears on page reload.
- Paper saving from arXiv pages and author feeds.
- Named paper collections with inline creation, double-click/F2 rename, context-menu deletion, and membership controls.
- Optional Following collections with the same sidebar management and collection
  browsing. Enable **Settings → Following → Organize followed authors into
  collections**; use each author's folder-icon collection picker to assign memberships.
  To move, select the destination before clearing the source. Disabling organization
  preserves assignments. [Workflow and data rules](docs/following-collections.md).
- Compact bottom-right Undo notices for ordinary removals: three seconds of
  visible time, paused during hover or keyboard focus. The background’s eight-second
  restoration validity remains unchanged. Whole-collection deletion still confirms
  sole-membership consequences; routine successful operations stay quiet.
- Local text filtering of saved papers and author feeds, with shared rolling time
  presets and inclusive custom year ranges in Library and author feeds.
- A compact popup for opening Library and Following and viewing their counts.
  **Settings → General → Open Xivary from toolbar launcher in a new tab** defaults
  to enabled. Disable it to replace the active tab when choosing a popup row;
  the toolbar icon still opens the popup, and its Settings gear is unchanged.
- Optional **Settings → Keyboard navigation → Vim Mode**, off by default, for
  Library, Following, Offline, Author Results and Settings. The preference stays local;
  typing, menus and native Tab navigation retain their keys.
  [Keyboard mappings](#keyboard-navigation) and [precise behavior](docs/vim-mode.md).
- Optional local KaTeX rendering in abstracts, enabled by default, with a compact
  custom macro editor. Unknown or invalid expressions retain their original LaTeX.
  [Syntax, safety and limitations](docs/latex-rendering.md).
- A shared Settings gear in Library, Following and Author Results.
- Settings for opening arXiv links in a new tab and optionally organizing followed
  authors into collections.
- Portable multi-file ZIP/JSON backups for transferring Library, Following and Collections
  data without exposing storage or sync internals.

The separate field-aware Search page remains packaged for direct testing but is not
linked from primary navigation in this release.

## Keyboard navigation

Enable **Settings → Keyboard navigation → Vim Mode**; it is off by default and
stays local to this installation. It works on Library, Following, Offline, Author Results
and Settings. The toolbar popup, separate Search page and arXiv pages retain their
native keys.

| Key | Action |
| --- | --- |
| `j` / `k` | Scroll down / up |
| `h` / `l` | Browser history back / forward |
| `J` / `K` | Adjacent browser tab on the left / right, wrapping at either end |
| `f` | Show hints for visible links and controls |
| `F` | Show hints; open selected navigational links in a new tab |
| `gi` | Focus the primary search field or eligible editor (macro editor in Settings) |
| `d` / `u` | Half-page down / up |
| `gg` / `G` | Smoothly scroll to top / bottom (immediate with reduced motion) |
| `Escape` / `Ctrl+[` | Cancel the current interaction or leave an ordinary editable field |
| `?` | Shortcut help |

Native Tab and Shift+Tab stay available. Normal shortcuts pause while typing,
composing with an IME, or using menus/dialogs. Escape and Ctrl+[ preserve ordinary
field values; existing creation, rename and dialog cancellation takes priority.
Hints activate noneditable controls once without leaving focus behind, and focus
editable targets intentionally. See [Vim Mode](docs/vim-mode.md) for precise
sequence, focus, scrolling and browser-verification limits.

## Data and privacy

Saved papers, followed authors, collections, preferences, and cached author-feed
results have a browser-local view in `storage.local`. In the Chromium package,
only `openArxivLinksInNewTab`, `organizeFollowedAuthorsIntoCollections`,
`openAuthorResultsInNewTab` and `openXivaryFromToolbarInNewTab` use
`storage.sync`. Vim Mode, the LaTeX rendering toggle and custom macro definitions, both last-used collection
pointers, all library records and feed caches remain local. Chrome and Firefox installations have independent libraries;
Firefox settings remain local too. Filters and pickers remain ephemeral.

Existing local data is preserved, including anything restored by older versions.
Legacy Sync v1 library records are ignored and left untouched remotely; they cannot
restore, overwrite or delete local items. Older extensions can still sync library
data among themselves. New installations receive preferences only. Preferences
keep logical revision/replica conflict ordering, pending writes and local-first
retry behavior. Installed storage upgrades run automatically; obsolete portable file formats are not imported. See
[settings-only migration](docs/settings-only-sync-migration.md) and
[Sync design](docs/chrome-sync.md). Real Chrome-account propagation remains a
manual release check; dedicated test profiles do not prove it.
It sends author-name searches to `https://export.arxiv.org/` when loading or refreshing
an author feed. It does not send library data to a project-owned service.

Settings offers Export All / Import All and independent Bookmarks/Following
transfers. Version-3 `xivary-library` backups use one ZIP with individual record
files, a manifest and explicit ordering. The selector offers all items as ZIP
or a self-contained collection as JSON; import accepts multiple JSON files.
Custom names/metadata and shared memberships survive a fresh-profile round trip.
Existing profiles merge conservatively without rearranging unrelated records.
Preferences, Offline PDF bytes, Feed caches, last-used pointers and Chrome Sync
bookkeeping are excluded. See [format and limits](docs/import-export.md).

Library collections and papers within a collection support direct handle-only
dragging and keyboard moves. Six-dot handles appear on row hover/focus, and moves
save immediately. All Saved and New collection remain fixed, with a subtle divider
below All Saved. Counts and contextual menus have separate reserved space. Each
collection owns its paper order; All Saved retains its existing ordering. Clear
filters that hide members before reordering a collection's papers. See
[ordering behavior](docs/collection-reordering.md). Library also remembers its
last selected collection locally across navigation and browser restart; search,
filters and scroll remain transient. See [selection behavior](docs/library-selection.md).

Following authors use the same direct handles and keyboard moves. Their global
manual order survives reload and portable backups. Each Following collection also
has its own independent author order; moving its authors leaves All Following and
other collections unchanged. Clear search hiding members before moving them. New follows append; author-paper date
sorting stays unchanged. Existing installations automatically retain their previous
visible Following order during automatic upgrades; schema 8 adds independent
collection author orders without changing existing order. See
[Following ordering](docs/following-reordering.md). With author organization
enabled, collection rows also support direct handle/keyboard ordering and remember
their last selection independently from Library. See
[Following collections](docs/following-collection-ordering.md).

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
npm run test:upgrade
npm run test:arxiv-loading
npm run package
npm run package:firefox
```

`npm run package` retains Chromium as the default and writes
`dist/xivary-0.5.1-chromium.zip`; `npm run package:firefox` writes
`dist/xivary-0.5.1-firefox.zip`. The ZIP builder sorts entries, fixes timestamps to
1980-01-01 UTC and includes the project and bundled dependency licenses. Rebuilding unchanged sources with
the same zip implementation produces byte-identical archives. Unpacked artifacts
are also generated under
`dist/chromium/` and `dist/firefox/`. Only the generated manifests differ;
application files are copied unchanged. Archives contain runtime files and the
bundled font and KaTeX licenses, with `manifest.json` at the root.

For an archive-free production build, run `npm run build`. It stages the same
runtime files and generated manifests in `dist/chromium/` and `dist/firefox/`
without creating ZIPs. When avoiding archives during verification, use
`npm test -- --test-skip-pattern='both ZIP artifacts'` and set
`XIVARY_NO_ARCHIVE=1` for Firefox smoke. The excluded test is the existing ZIP
creation/reproducibility check; unpacked builds have their own source-equality test.

Chrome smoke testing uses `CHROME_BIN` (default `/usr/bin/google-chrome`).
Firefox smoke testing needs geckodriver, Firefox, OpenSSL, and permission to bind
loopback ports; set `GECKODRIVER_BIN` and `FIREFOX_BIN` for nonstandard installations.
The fixture suites use temporary profiles. `npm run test:release` additionally
checks native category downloads/file inputs and real Chrome Sync events,
alarm/worker recovery, reload and test-profile restart. It uses one unsigned-in
profile and does not verify Google-account delivery. `npm run test:arxiv` is the
separate live-network author-link check; the initial 0.4.0 candidate run verified three actual
abstracts and live name-matched retrieval. The subsequent stability investigation
observed one production 429 and stopped further live requests; recovery is verified
with controlled fixtures, not claimed as live-network success. Search-result author
links use deterministic browser fixtures. `npm run test:upgrade` checks retained
0.2.0/0.3.0 source snapshots and the pre-candidate Vim/LaTeX build in same-ID test
profiles without uninstalling or resetting storage; it does not prove a store-installed update.
`npm run test:arxiv-loading` uses local TLS streaming/429 fixtures to measure first
results, request spacing, partial failures, cancellation and worker restart without
production traffic. See [API loading and recovery](docs/arxiv-loading.md).
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

## Discovery limits

Feed keeps up to 100 papers initially submitted within 30 days, with demand-driven
12-hour discovery and seven-day coauthor evidence caching. Name-based identity and
API budgets limit coverage. Selective terminology-backed related areas supplement
Following and direct coauthors; category-only and citation discovery remain deferred.
See [Feed semantics and budgets](docs/following-feed.md).

## License

Xivary is released under the [MIT License](LICENSE). The bundled IBM Plex font files
retain their separate SIL Open Font License in
[`extension/assets/fonts/LICENSE.txt`](extension/assets/fonts/LICENSE.txt).

See [author navigation and interaction polish](docs/author-interaction-polish.md)
for current verification, additive preference compatibility and the bounded API investigation.

See [Xivary UI design](docs/UI_DESIGN.md) for implemented compact sidebars,
collection menus, the 300px popup and keyboard conventions, and
[reusable design principles](docs/DESIGN_PRINCIPLES.md) for guidance across projects.

Bundled [KaTeX](https://katex.org/) 0.19.0 retains its MIT license in
[`extension/vendor/katex/LICENSE`](extension/vendor/katex/LICENSE). JavaScript, CSS
and math fonts are packaged locally; no CDN or extra permissions are used.

Storage upgrades run automatically through a shared repository barrier, independently
of the manifest version. Local schema 8 preserves installed data and retains a
local recovery snapshot before migration; normal updates do not require manual
Export/Import. See [upgrade safety](docs/storage-migrations.md).

# arxiv-tool

A local-first Chromium extension for saving arXiv papers, following researchers,
organizing papers and authors into collections, and running field-aware searches. Data stays
in the browser profile; there is no account or backend in this iteration.

## User experience

- **arXiv abstract pages** provide clear, compact Save and Follow actions in their
  natural title and author contexts.
- **Popup** is a small launcher showing Saved Papers and Following Authors counts,
  with links to Library and Following.
- **Library** (`src/library/library.html`) browses All Saved or a named paper
  collection and manages collections and memberships.
- **Following** (`src/authors/authors.html`) is a simple list of followed
  researchers with direct feed and unfollow actions.
- **Researcher feed** (`src/author/author.html?authorId=…`) shows a followed
  researcher's recent arXiv papers grouped by year.
- **Search** remains implemented at `src/search/search.html` but is hidden from
  primary navigation for now.

The old UI word “Favorite” is now **Save**, **Saved**, and **Library**. The internal
repository methods and persisted `favorites` property retain their old names for
backward compatibility. Existing saved papers are migrated losslessly.

The interface bundles IBM Plex Sans Regular and SemiBold WOFF2 assets from IBM's
official distribution under the SIL Open Font License 1.1. No font is loaded from
the network at runtime; provenance, checksums, and the license live beside the
font files in `extension/assets/fonts/`.

arXiv destinations opened from extension pages navigate in the current tab by
default. The popup gear opens a minimal Settings page with opt-in preferences for
new-tab links and author collections. Modifier-click behavior remains native because
paper and author destinations are ordinary links rather than scripted navigation.

## Paper collections

The first one-click save uses the last-used paper collection, falling back to
**Saved Papers**. Clicking a saved bookmark opens a multi-select picker where
memberships can be changed or a named collection created inline. Papers remain
globally saved while at least one membership exists. Paper and author collections,
including their last-used settings, are independent.

## Author identity and Following

Authors use a stable normalized-name key shared across papers. **Follow** acts
immediately and changes to **Following**; clicking **Following** unfollows by
default. This direct action stays available when author collections are off.
Existing author-collection records remain supported and are exposed through the
same control only when the author-organization preference is enabled.

This identity is an approximation. Different people with the same normalized name
share follow state and a name-based paper feed; spelling, initials, and name order
can produce separate identities. ORCID discovery is not implemented.

## Author paper cache

Opening a researcher feed fetches arXiv results on demand. Results are normalized
into portable paper records and cached separately from saved papers for 24 hours.
A fresh cache renders immediately. A stale cache renders immediately and refreshes
in the background; **Refresh** always requests new results. Following itself never
downloads a paper history.

The extension requests access only to `https://export.arxiv.org/*` for the public
Atom API. Search and author feeds fall back to links on arXiv when retrieval fails.
Saving a result explicitly sends it through the same repository used by the title
bookmark, so popup counts, Library, and later arXiv page loads agree.

## Search

Fields include All fields, Algebraic Geometry, Representation Theory, Homological
Algebra, Mirror Symmetry, Symplectic Geometry, Category Theory, and Persistence /
Applied Topology. Exact keeps the query, Balanced adds up to two close curated
alternatives, and Broad adds up to four and widens categories. Expansion is pure,
deterministic, and documented in [shared/search/README.md](shared/search/README.md).
This is curated query expansion, not AI or semantic search.

## Development

Load `extension/` through `chrome://extensions` with Developer mode and **Load
unpacked**. Reload the extension after changes and refresh open arXiv tabs.

```sh
npm test
npm run test:browser
```

The Node suites cover identifiers, saved-data migration, paper and author
collections, cache freshness/normalization, search expansion, repository message
boundaries, page packaging, and storage isolation. The browser smoke test uses a
temporary profile and synthetic arXiv pages, including author-line markup from
arXiv:2512.03554.

## Manual Chromium verification

1. Load `extension/`, open an arXiv abstract page, and confirm the outline bookmark
   sits naturally at the title and fills after saving.
2. Save the paper, reopen its picker, create a collection, and change memberships.
3. Open the popup; confirm the counts and open **Following** in a normal tab.
4. Confirm the researcher appears without collection controls, then open the feed.
5. Confirm cached or fetched papers render by year; open an abstract and PDF, then
   save a result and confirm it appears in **Library**.
6. Open the Search page directly when testing its retained Exact, Balanced, and
   Broad implementation; it is intentionally absent from primary navigation.
7. Visit another paper by the followed author and confirm follow state is shared.
8. Reload the extension and verify saved papers, follows, collections, and cache
   state persist without console errors.

## Repository layout

```text
extension/src/
  content/       arXiv page integration only
  popup/         launcher and counts
  library/       saved-paper browsing
  authors/       followed-author and collection management
  author/        one author's cached paper feed
  search/        field-aware search UI and pure expansion modules
  services/      portable arXiv query/result/cache rules
  domain/        paper, author, and identifier models
  repository/    persistence contract, client, and local implementation
  ui/            shared page and collection-picker components
shared/          portable contracts and schema documentation
tests/           Node tests
scripts/         Chromium browser smoke check
```

Only `extension/src/lib/storage.js` calls `chrome.storage.local`; every UI uses
`RepositoryClient`. Backend sync, Android, iPad/iOS, web clients, embeddings, and
AI semantic search remain out of scope. A future provider-independent REST/JSON
API may connect all clients to PostgreSQL on an ordinary server or Raspberry Pi.
Paper notes are also deferred; no note editor or indicator is exposed.

See [architecture](docs/architecture.md) and the [data model](shared/schema/data-model.md).

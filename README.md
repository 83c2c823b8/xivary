# arxiv-tool

A local-first Chromium extension for saving arXiv papers, following researchers,
organizing authors into collections, and running field-aware searches. Data stays
in the browser profile; there is no account or backend in this iteration.

## User experience

- **arXiv abstract pages** provide only contextual actions: a subtle bookmark at
  the title and compact Follow controls beside author names.
- **Popup** is a small launcher showing Saved Papers and Following Authors counts,
  with links to the three full-tab pages.
- **Library** (`src/library/library.html`) lists and filters saved papers and lets
  you remove them from the library.
- **Following** (`src/authors/authors.html`) manages followed researchers,
  collection filters, collection creation/rename/delete, and memberships.
- **Researcher feed** (`src/author/author.html?authorId=…`) shows a followed
  researcher's recent arXiv papers grouped by year.
- **Search** (`src/search/search.html`) provides the eight field presets and
  deterministic Exact, Balanced, and Broad expansion modes.

The old UI word “Favorite” is now **Save**, **Saved**, and **Library**. The internal
repository methods and persisted `favorites` property retain their old names for
backward compatibility. Existing saved papers are migrated losslessly.

## Author identity and collections

Authors use a stable normalized-name key shared across papers. The first Follow
adds the researcher to the last-used collection, or creates **Following**. Clicking
**Following ▾** opens a multi-select collection picker. An author remains followed
while at least one membership exists. Collection IDs are stable across renames.

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

The Node suites cover identifiers, saved-data migration, author identity and
collections, cache freshness/normalization, search expansion, repository message
boundaries, page packaging, and storage isolation. The browser smoke test uses a
temporary profile and synthetic arXiv page.

## Manual Chromium verification

1. Load `extension/`, open an arXiv abstract page, and confirm the outline bookmark
   sits naturally at the title and fills after saving.
2. Save/unsave the paper, then follow an author with the compact control.
3. Open the popup; confirm the counts and open **Following** in a normal tab.
4. Create/rename a collection, change membership, and click the researcher's name.
5. Confirm cached or fetched papers render by year; open an abstract and PDF, then
   save a result and confirm it appears in **Library**.
6. Open **Search arXiv**, compare Exact, Balanced, and Broad previews/results, and
   use **Open on arXiv** as a retrieval fallback.
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
`RepositoryClient`. Paper collections are a future extension of the saved-paper
page and data model. Backend sync, Android, iPad/iOS, web clients, embeddings, and
AI semantic search remain out of scope. A future provider-independent REST/JSON
API may connect all clients to PostgreSQL on an ordinary server or Raspberry Pi.

See [architecture](docs/architecture.md) and the [data model](shared/schema/data-model.md).

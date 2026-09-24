# arXiv Research Library

A local-first Chromium extension for saving arXiv papers and following authors.
Version 0.1.0 stores its data in the browser profile and has no account, project-owned
backend, or analytics.

## Features

- Compact **Follow** and **Following** controls beside authors on arXiv abstract pages.
- A Following list and per-author paper feeds retrieved from arXiv's public Atom API.
- Paper saving from arXiv pages and author feeds.
- Named paper collections with inline create, rename, delete, and membership controls.
- Local filtering of saved papers and author feeds, including preset and custom date ranges.
- A compact popup for opening Library and Following and viewing their counts.
- Settings for opening arXiv links in a new tab and optionally organizing followed
  authors into collections.

The separate field-aware Search page remains packaged for direct testing but is not
linked from primary navigation in this release.

## Data and privacy

Saved papers, followed authors, collections, preferences, and cached author-feed
results are stored in `chrome.storage.local`. The extension does not use Chrome Sync.
It sends author-name searches to `https://export.arxiv.org/` when loading or refreshing
an author feed. It does not send library data to a project-owned service.

See [PRIVACY.md](PRIVACY.md) for the stored data, network behavior, and permission
rationale.

## Install for development

1. Open `chrome://extensions` in Chromium or Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the `extension/` directory.
4. Open an `https://arxiv.org/abs/...` page. Reload the extension and refresh existing
   arXiv tabs after code changes.

Node.js 20 or newer is required for tests and packaging:

```sh
npm test
npm run test:browser
npm run package
```

The packaging command requires the standard `zip` utility and writes
`dist/arxiv-research-library-0.1.0.zip`. The archive contains only extension runtime
files and the bundled font license, with `manifest.json` at its root.

## Architecture

Every persistent operation crosses `PaperRepository` through `RepositoryClient`.
The Manifest V3 service worker owns the local repository, and only
`extension/src/lib/storage.js` accesses `chrome.storage.local`. IBM Plex Sans Regular
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
- Data remains in one Chromium profile. There is no account, backend sync, or built-in
  import/export workflow.
- There is no mobile application. The implemented client targets Chromium desktop.
- The repository does not currently declare a project-level software license. The
  bundled IBM Plex font files retain their separate SIL Open Font License.

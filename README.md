# arXiv Research Library

A local-first Chromium extension for collecting arXiv papers and following
authors. Plain JavaScript, HTML and CSS; no dependencies, build step, account,
or cloud service. Only the extension MVP is implemented.

## Current features

- Detect paper IDs, titles and authors on `https://arxiv.org/abs/*`.
- Toggle Favorite beside the title and Follow beside each author.
- Browse Favorites and Following in the extension popup.
- Open abstract pages and PDFs; remove favorites and unfollow authors.
- Persist your library in this browser profile with `chrome.storage.local`.
- Support modern and legacy arXiv IDs, with revisions sharing one paper ID.
- Keep storage behind an asynchronous repository contract and a service worker.

Author follows apply **across papers using a canonical name key**. Unicode,
whitespace, apostrophe/dash variants and case are normalized for matching while
the original display name is preserved. Different people with the same normalized
name share follow state; verified person identity is future work.
This MVP does not discover other papers by an author or deliver alerts.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome/Chromium (102 or newer).
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the repository's **`extension/`** directory.
5. Open an arXiv abstract page, for example <https://arxiv.org/abs/2401.00001>.
6. Select Favorite or Follow, then open the extension from the browser toolbar.
   Pin it using the browser's extensions menu if desired.

No `npm install` is required. After changing source files, select **Reload** on
the extension card and reload any open arXiv pages. Existing local data survives
extension reloads and browser restarts, but removing the extension or clearing
its storage deletes the library.

Existing paper-specific follows migrate automatically on the first library
operation after updating. Equivalent names merge into one follow, preserving the
earliest `followedAt`, latest `updatedAt`, and display name of the latest updated
record (first stored record wins ties). Paper provenance is removed from follows;
saved favorites are unchanged. See the [migration details](shared/schema/data-model.md#migration-from-schema-1).

## Repository structure

```text
extension/
  manifest.json           Manifest V3; only the storage API permission
  src/
    content/              arXiv extraction and page controls
    popup/                Favorites and Following UI
    background/           Repository message handler and composition root
    domain/               Paper, author and identifier rules
    repository/           Contract, message client and local implementation
    lib/storage.js        Chrome local-storage adapter
shared/schema/data-model.md  Shared JSON model and identity rules
shared/models/              Reserved for future shared implementations
docs/architecture.md        Current boundaries and future deployment
backend/                    Documentation placeholder only
android/                    Documentation placeholder only
tests/                      Node domain, repository and packaging tests
```

## Test

Use Node.js 20 or newer:

```sh
npm test
```

Tests cover identifiers, Unicode name normalization, extraction fallbacks,
repository toggles/removals, persistence across instances, overlapping writes,
storage failures, message validation, manifest/import paths and the storage
boundary. They use an in-memory implementation of Chrome's storage-area API;
they do not modify your installed extension's data.

Manual browser acceptance checks:

1. Load the unpacked extension. Check that its extension card has no errors.
2. On an abstract page, favorite the paper and follow an author. Reload the page
   and verify both states remain selected.
3. Open the popup. Verify the title and authors, and open Abstract
   and PDF links. Switch between Favorites and Following.
4. Remove a favorite and unfollow an author in the popup. Return focus to the
   arXiv page and verify its buttons update.
5. Visit a versioned URL and a legacy ID such as
   `https://arxiv.org/abs/hep-th/9901001`. Confirm revisions share a favorite.
6. Save different papers in separate tabs, restart the browser, and verify the
   library persists. Following remains independent of favorite removal.
7. Check empty lists and keyboard navigation. The popup Refresh button retries
   failed reads; failures should display a message rather than report success.
8. Follow an author on paper A, then open paper B by that author. It should show
   Following immediately after loading. Unfollow there and return to A; its
   button should show Follow. Other authors should remain independent.

## Limitations

- Data stays in one browser profile. No export/import or cross-device backup yet.
- Author identity is based on normalized names: namesakes share follow state,
  while spelling changes, initials and reordered names can still produce separate keys.
- Content extraction depends on arXiv citation metadata and abstract-page markup.
  Only the exact `https://arxiv.org/abs/*` host/path is supported.
- Controls refresh on page focus/visibility and popup opening/Refresh; no live
  background push across already-visible windows.
- Favorites link to the latest revision. Specific revision tracking is not included.
- Tags, notes and read state exist in the model, but have no editing UI yet.
- The local library uses one storage document and is intended for a modest
  collection. Browser storage quota errors are surfaced to the user.

## Future roadmap

1. Add user-facing tags, notes and read status, plus library export/import.
2. Introduce a provider-independent HTTPS REST/JSON backend and PostgreSQL.
3. Define authentication, conflict resolution and synchronization semantics,
   including record versions and deletion tombstones, before adding sync.
4. Add verified author identity/linking, periodic arXiv polling and notifications.
5. Add an Android client sharing the same backend and data contract.

The backend should run on an ordinary Linux machine or Raspberry Pi. Firebase,
Supabase and other hosted products are not required. See
[architecture](docs/architecture.md) and the [data model](shared/schema/data-model.md).

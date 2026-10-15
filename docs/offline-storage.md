# Offline papers

Offline is the third compact top-level navigation destination, beside Library,
Following and the fourth destination Feed. Library remains bookmark-only and has no Offline filter. Offline lists
all locally stored PDFs, using the shared paper rows, text filtering and publication
time controls. Count and PDF byte usage occupy the existing secondary count line.
An offline-only paper has no bookmark membership. A bookmarked paper appears once
in each relevant view; the Offline view prefers its current bookmark metadata.
Library title/PDF links keep their arXiv destinations and preference behavior.
Offline title/PDF links open the local native reader in a new browser tab.

The same 30px icon sits beside the existing bookmark on paper rows and supported
arXiv abstracts. First activation saves; saving pulses quietly (without animation
under reduced motion), availability uses a checkmark, and failures use a small error
icon with the diagnostic in its tooltip/menu. No persistent success message is
added. The saved/error icon opens a trigger-anchored keyboard menu with Read,
explicit Update, Retry and Remove. Escape/outside activation dismisses it and
returns focus. Removal asks for a second activation inside this menu, rather than
changing existing bookmark/Following Undo rules. Offline's menu additionally
exports an ordinary, version-named PDF. Settings shows count, PDF bytes, estimated
origin storage usage and a link to Offline. PDF export is a deliberate download;
ordinary offline saving never uses downloads or a download link.

## Repository and database

Every read/write/open action crosses `PaperRepository` through `RepositoryClient`
and the existing allowlisted, sender-validated background handler. Best-effort invalidations reach extension
pages through runtime messaging and supported abstracts through tab messaging. The shared
background `LocalRepository` delegates offline operations to `OfflineRepository`;
there is no second application repository or sync path. `OfflineStorage` owns the
extension-origin IndexedDB connection. Calls wait for the shared local schema-6
initialization barrier, then use independent PDF transactions. No PDF records or
bytes enter the local research envelope, migration recovery snapshots, Chrome Sync
projection or portable backups. See [upgrade safety](storage-migrations.md).

Database `xivary-offline` is at version 2:

| Store | Key | Value |
| --- | --- | --- |
| `copies` | unversioned `arxivId` | `arxivId`, numeric `version`, `versionedId`, `savedAt`, unique `revision`, `size`, JSON-compatible `paper` fallback metadata |
| `pdfs` | same unversioned ID | validated `application/pdf` Blob |

Version 1 creates both stores. Version 2 adds the `savedAt` index without rewriting
or deleting records. A blocked upgrade reports an actionable error; connections
close after transactions and on version changes. The paper fallback uses the
existing Paper normalizer; offline saving does not create a favorite, author,
collection or membership. It preserves display metadata for offline-only discovery
and survival of bookmark removal. Current bookmark metadata is preferred when
available; no offline operation edits bookmarks, tags, notes, Following or settings.

Operations are serialized per paper. Concurrent saves share the committed copy
and avoid fetching/storing it again. At most one PDF version is kept per paper.
Explicit versioned inputs retain their version, including legacy identifiers.
Unversioned saves and explicit updates fetch the abstract and resolve an exact
version before fetching the versioned PDF. Existing copies are never automatically
updated. Re-requesting the saved version performs no byte write.

HTTP success, PDF/octet-stream MIME, a PDF header, EOF marker and unencoded
Content-Length (when supplied) are checked before commit; unexpected PDF redirects
are rejected. This is transport/content validation, not a complete PDF parser or
malware scanner. Metadata and PDF replacement/removal share one IndexedDB
transaction. Network/validation/quota failures retain a prior copy. Pending status,
errors and AbortControllers are transient: worker termination cannot leave a
persisted “saving” or false “saved” record. Cancellation aborts fetch; removal
cancels active fetch and then waits for serialized deletion. Interrupted work must
be retried; there is no automatic background resume or arbitrary size cap.

## Native Chrome reader

`offline/read.html?id=…` is a stable extension URL, not a custom PDF renderer.
`RepositoryClient.readOfflinePdf` reconstructs a PDF Blob from bounded 512 KiB
base64 RPC chunks. Chrome messages are JSON-compatible; no entire large base64
PDF is kept in browser storage. Each chunk checks a unique copy revision and reads
metadata/bytes in the same IndexedDB snapshot. A concurrent replacement/removal
fails the read instead of mixing bytes. Legacy records without a revision use
their saved timestamp until replacement.

The reader document creates `blob:chrome-extension://…/…` and presents it in a
full-viewport iframe. Chrome's built-in PDF extension handles the MIME type and
provides its own toolbar, rendering and printing. The reader owns the object URL
for its document lifetime and revokes it on non-BFCache pagehide. Reload creates a
fresh URL from IndexedDB; service-worker suspension does not own or invalidate it.
Closing/navigating releases the document/Blob. No offscreen or downloads permission,
PDF library or custom renderer is introduced. Chrome documents the need for a DOM
context for Blob URLs in its [offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen);
this implementation uses the visible reader tab instead.

The native toolbar may display the Blob URL's UUID as its filename. The tab title
uses the paper title and exact version; explicit export uses `arxivIdvN.pdf`.
Tests use Chrome's default built-in PDF setting. If a browser/policy disables its
native viewer in favor of external downloads, this extension cannot override that
setting; no substitute renderer is supplied. Reading allocates the full Blob and
per-chunk decoding buffers, so extremely large PDFs remain subject to available
memory. 20 MiB is tested, not a maximum.

## Permissions and privacy

The only added permission is host access to `https://arxiv.org/*`, required for
background abstract version resolution and PDF retrieval. Existing export.arxiv.org
Atom access cannot fetch arxiv.org PDFs. API permissions and extension version are
unchanged. Fetches omit credentials. Copies, metadata and PDF bytes stay in the
browser profile, do not enter Chrome Sync or portable JSON files, and can be lost
if the extension/profile data is deleted. There is no automatic Downloads folder
file or notification on saving.

## Verification

Run `npm run test:offline` in a disposable Chrome profile. The deterministic CDP
fixtures intercept real arXiv-origin fetches; no credentials, normal profiles or
production arXiv traffic are used. Real IndexedDB and Chrome's installed native
PDF renderer are exercised. The test checks the native PDF extension target and
its loaded one-page toolbar, rather than just the presence of an iframe.

Chrome 154.0.8037.57 passed: v1-to-v2 IndexedDB upgrade, save without download
events, arXiv icon state, offline-only discovery and filtering in the top-level
Offline tab, unchanged bookmark-only Library, duplicate saves, explicit v1-to-v2
replacement, failed replacement preservation, interrupted network, modern/legacy
IDs, 20 MiB PDF rendering, title-click navigation, disconnected reader reload,
bookmark independence in both directions, saving/cancellation/error UI, small removal confirmation, injected quota rollback in real IndexedDB,
explicit worker suspension/recovery, secondary PDF export, extension reload and full same-profile browser restart with retained
PDF bytes/metadata and native reading. Screenshots are inspected separately from
behavior assertions. The suite's fixtures do not prove live arXiv availability,
Google-account behavior, other Chrome versions/policies or Firefox native viewing.

Initial milestone regression record (before finalization): the unit suite passed 250 tests with the single
archive-producing packaging test excluded; earlier full runs passed before the
additional identifier-validation case. `npm run test:release` and
`git diff --check` passed. The general Chrome browser suite completed successfully
once, but a later repeat reproduced the baseline Settings/Vim hint-gap assertion
(5.06 px); its geometry assertions were not weakened. A scroll-settling wait was
added to prevent hint activation during an unfinished native scroll. Firefox smoke
was attempted with `XIVARY_NO_ARCHIVE=1` (temporary unpacked manifest only), but the
installed Snap runtime failed to create its WebDriver profile/preferences session.
Firefox native PDF reading remains unverified. No release packaging commands,
version change, commit, push or publication were performed. Existing uncommitted
work was retained. The original full unit suite internally created and cleaned
temporary ZIP test fixtures; subsequent checks excluded that case.

## Finalization — 2026-10-14

The exact Support Xivary sentence is now “Even adding a donation link feels
fundamentally at odds with that philosophy.” The remaining Support section text
and markup are unchanged. Current release verification is recorded in
[the 0.5.0 release record](release.md#v050--2026-10-15).

Archive-free production staging is available with `npm run build`, using the same
packaging pipeline and browser-manifest derivation with archive creation disabled.
It stages 162 runtime files per browser, including licenses, and is covered by an
unpacked source-equality regression. The final unit command excludes only the ZIP
creation/reproducibility test. No ZIP is created during finalization.

The Settings hint-gap assertion now explicitly waits for font loading and two
animation frames so its geometry observer finishes even when optional screenshot
capture is disabled. The existing 3–5 px geometry bound is retained. Chrome's
full browser suite and Firefox's full fixture suite pass with the documented
direct Firefox/geckodriver binaries; the Snap-launcher failure was environmental.
Firefox native offline PDF viewing remains unverified. Offline fixture verification
passes in Chrome, including disconnected reading, worker suspension, restart,
cancellation, invalid/network/quota failures and bookmark independence.

The user authorized committing and pushing the completed Offline, wording and
verified pre-existing Xivary work to the configured upstream. Release ZIP creation,
version increments and publication remain outside this finalization.

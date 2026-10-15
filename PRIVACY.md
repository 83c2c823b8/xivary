# Privacy

This document describes Xivary 0.5.0, a local-first desktop extension. Browser
verification and remaining distribution checks are in [the release record](docs/release.md).

## Data stored locally

The extension stores one JSON-compatible library in browser-local extension
storage (`storage.local`, through the native Chromium or Firefox API). It can
contain:

- saved-paper titles, arXiv identifiers, author names, categories, abstracts, and dates;
- followed author names and normalized name identifiers;
- paper and author collection names, memberships and explicit Library ordering;
- the bounded Feed queue, seen-ID ledger and coauthor/topic evidence with public
  paper provenance and cache/refresh timestamps;
- local migration recovery snapshots retaining the original research envelope;
- user preferences, including local Vim Mode, the LaTeX rendering toggle and custom macro definitions;
- the local arXiv API pacing/cooldown deadline, without a persisted request queue;
- cached public arXiv results for viewed author feeds, including non-followed
  names and their retrieval times.

Full local paper metadata, caches and last-used collection choices remain in the
browser profile. Chrome and Firefox installations have independent libraries.
Removal and retention are therefore also subject to the browser profile and extension
lifecycle.

Offline PDFs and their exact arXiv versions, timestamps, sizes and fallback paper
metadata are stored separately in extension-origin IndexedDB. Copies stay local,
are excluded from Chrome Sync and portable backups, and can be lost when
extension/profile data is deleted. Saving creates no Downloads file; the secondary
Export PDF menu action deliberately creates an ordinary PDF file.

## Data synchronized by Chrome

The [library synchronization audit](docs/library-sync-audit.md) uses synthetic data
and disposable test profiles. It adds no runtime library uploads or external
service. The behavior below remains the implemented policy.

The Chromium package writes only four explicitly designated boolean preferences to
Chrome's extension `storage.sync`: `openArxivLinksInNewTab`,
`organizeFollowedAuthorsIntoCollections`, `openAuthorResultsInNewTab` and `openXivaryFromToolbarInNewTab`, with
their logical revision/replica metadata.
Google Chrome handles propagation when enabled for the same extension ID/account.
Xivary receives no Google credentials and operates no account or server. Other
Chromium distributions' sync infrastructure is not verified or promised.

Bookmarks, Following records, collection names and memberships, paper metadata,
author-feed caches, Vim Mode, LaTeX rendering/macros, unknown settings and both last-used collection pointers remain
local. Firefox does not access its sync storage; its preferences remain local.
Disabling Chrome sync is controlled by Chrome, not by Xivary.

Previous versions uploaded small library records. Updated installations ignore
those legacy remote records and never upload or restore them, but do not erase or
rewrite them. Existing local data, including earlier downloads and inert replica
bookkeeping/snapshots, is preserved. This is not a claim of retroactive remote
purging. Older extension versions may continue syncing library data themselves.
See [migration strategy](docs/settings-only-sync-migration.md).

## User-controlled backup files

Settings exports one version-3 ZIP for all research data or a complete section,
with separate JSON records and explicit ordering. One selected collection exports
self-contained JSON. Import accepts current ZIP/JSON files, including multiple
individual JSON files, and validates them all before applying one merge. A category
import changes only that category. Custom names, aliases and supported edited
metadata are preserved. Older portable file versions are not accepted by Settings;
installed-data migrations remain automatic and independent.

Backups exclude preferences, Offline PDF bytes, Feed and coauthor/topic caches,
migration recovery snapshots, last-used collection pointers, unknown storage fields,
authentication/runtime state and all Chrome Sync bookkeeping. Preferences continue
on their existing four-boolean Chrome Sync path.

Xivary does not upload backup files. A downloaded file is governed by the user's
device, browser download settings, backup software, and any transfer service the
user chooses. Import reads a file only after the user selects it, validates the
whole file, and merges it into local data through the same repository used by
ordinary saves/follows. Imported library data stays local; it does not enter
Chrome Sync. New portable files continue to exclude preferences.

Local deletion follows the existing membership rules and does not remove remote
legacy records. Retained author metadata and old local replica snapshots are not
purged automatically. New preference replicas snapshot only those preferences.
See [Sync design](docs/chrome-sync.md).

## Network use

The extension has no project-owned backend and includes no analytics, advertising,
or telemetry service.

Feed, Author Results and the retained Search page use a shared background request queue.
It spaces API starts by at least three seconds, uses one connection at a time and
retries temporary HTTP 429 responses within bounded attempts/waiting. Queue entries
and streamed response buffers are temporary; only the pacing/cooldown deadline
persists locally, outside Chrome Sync and portable backups.

When an author feed needs current results, the extension sends an author-name query
directly to arXiv's public Atom API at `https://export.arxiv.org/api/query`. The
response is cached locally for 24 hours. Opening paper, PDF, author-search, or other
arXiv links navigates the browser to arXiv. Those requests are governed by arXiv and
the browser's own privacy behavior.

Feed discovery sends bounded author-name, category and specific terminology
queries directly to the same arXiv API. It runs on demand when opened and due
(default twelve hours), or through manual refresh, and reuses coauthor evidence
for seven days. No requests run merely because the browser is closed. Discovery
relationships remain name-based and are not uploaded to a recommendation service.
See [request budgets](docs/following-feed.md). Migration recovery snapshots are
local-only, in extension local storage or an independent IndexedDB recovery store.

No remote JavaScript, CSS, fonts, or other executable code is loaded at runtime.

## Permissions and site access

- `storage`: stores the local library, collections, cached author-feed results, and
  settings, and accesses Chrome extension sync storage for the four designated preferences.
- `alarms` (Chromium package only): resumes deferred sync writes and failure recovery.
- `https://arxiv.org/abs/*` content-script access: reads public title and author
  metadata on arXiv abstract pages, inserts Save and Follow controls, and opens
  Xivary author views for recognized unmodified author-link activations. Viewing
  alone does not follow an author.
- `https://arxiv.org/search/*` content-script access: recognizes standard result
  author links and passes full displayed names to the existing Xivary author view.
  It leaves original destinations and modified-click behavior intact.
- `https://arxiv.org/*` host access: resolves exact paper versions from abstracts
  and internally fetches PDFs only when saving or updating an offline copy, without
  credentials. Native offline reading requires no arXiv network request.
- `https://export.arxiv.org/*` host access: retrieves public Atom results for author
  feeds, research discovery and the retained field-aware search page.

The Firefox manifest declares `searchTerms` under its data-transmission settings
because author-name and field-search queries are sent to arXiv. This declaration
describes existing retrieval behavior; it does not add analytics or remote library
storage. Firefox packaging targets desktop 140+ for built-in consent support.

The extension does not request browsing-history, identity, cookies, downloads,
geolocation, clipboard, or broad all-sites access.

## Project access to data

Because Xivary has no account, project-owned server, or analytics endpoint, the
project does not receive the locally stored library through the extension. This is
an implementation description, not a claim about protections supplied by the browser,
operating system, arXiv, or other software on the device.

Undo receipts are temporary background memory, expire after eight seconds, and
are never written to local storage, Sync, or portable files.

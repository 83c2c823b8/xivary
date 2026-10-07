# Privacy

This document describes Xivary 0.2.0, a local-first desktop extension. Browser
verification and remaining distribution checks are in [the release record](docs/release.md).

## Data stored locally

The extension stores one JSON-compatible library in browser-local extension
storage (`storage.local`, through the native Chromium or Firefox API). It can
contain:

- saved-paper titles, arXiv identifiers, author names, categories, abstracts, and dates;
- followed author names and normalized name identifiers;
- paper and author collection names and memberships;
- the two user settings shown on the Settings page;
- cached public arXiv results for viewed author feeds, including non-followed
  names and their retrieval times.

Full local paper metadata, caches and last-used collection choices remain in the
browser profile. Chrome and Firefox installations have independent libraries.
Removal and retention are therefore also subject to the browser profile and extension
lifecycle.

## Data synchronized by Chrome

The Chromium package also writes small records to Chrome's extension `storage.sync`:
saved arXiv IDs, full titles and author names, save/follow dates, followed-author
identities, paper/author collection names and memberships, both boolean preferences,
logical revision identifiers and deletion markers. Google Chrome handles propagation
through its sync infrastructure when enabled for the same extension ID and account.
Xivary does not receive your Google credentials and has no account or server.
Other Chromium distributions' sync infrastructure is not verified or promised.

Abstracts, categories, publication metadata, notes/tags/read fields, unknown local
metadata, author-feed caches and last-used choices are not uploaded by this layer.
Firefox does not access its sync storage. Disabling Chrome sync is controlled by
Chrome; the extension sync area then behaves locally.

## User-controlled backup files

The Settings page can download separate human-readable, versioned JSON files for
all Bookmarks or one paper collection, and all Following or one author collection.
A selected category import changes only that category. Preferences have no manual
file export/import; the two boolean preferences use Chrome Sync while last-used
collection pointers remain local. Older combined backups are accepted by either
category action, without applying their preference values. Files exclude
author-feed caches and queries, last-used collection
choices, unknown storage fields, Chrome Sync replica/revision/tombstone/bootstrap/
retry data, and ephemeral UI or request state.

Xivary does not upload backup files. A downloaded file is governed by the user's
device, browser download settings, backup software, and any transfer service the
user chooses. Import reads a file only after the user selects it, validates the
whole file, and merges it into local data through the same repository used by
ordinary saves/follows. In Chrome, that resulting user-owned state may then enter
Chrome Sync normally; the file itself and its export timestamp are not synchronized
as backup objects.

Removing a paper or unfollowing changes visible library intent. Display records
and deletion markers remain in sync storage to avoid stale resurrection. Local
replica bookkeeping and a one-time pre-sync user-data snapshot also remain; that
snapshot excludes feed caches. There is no automatic purge/compaction or data-reset
UI. Do not treat removing a row as erasing all historical metadata from browser
storage or Google's sync infrastructure. See [sync design](docs/chrome-sync.md).

## Network use

The extension has no project-owned backend and includes no analytics, advertising,
or telemetry service.

When an author feed needs current results, the extension sends an author-name query
directly to arXiv's public Atom API at `https://export.arxiv.org/api/query`. The
response is cached locally for 24 hours. Opening paper, PDF, author-search, or other
arXiv links navigates the browser to arXiv. Those requests are governed by arXiv and
the browser's own privacy behavior.

No remote JavaScript, CSS, fonts, or other executable code is loaded at runtime.

## Permissions and site access

- `storage`: stores the local library, collections, cached author-feed results, and
  settings, and accesses Chrome extension sync storage for the small durable subset.
- `alarms` (Chromium package only): resumes deferred sync writes and failure recovery.
- `https://arxiv.org/abs/*` content-script access: reads public title and author
  metadata on arXiv abstract pages, inserts Save and Follow controls, and opens
  Xivary author views for recognized unmodified author-link activations. Viewing
  alone does not follow an author.
- `https://export.arxiv.org/*` host access: retrieves public Atom results for author
  feeds and the retained field-aware search page.

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

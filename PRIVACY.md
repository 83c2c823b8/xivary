# Privacy

This document describes Xivary v0.1.0.

## Data stored locally

The extension stores one JSON-compatible library in `chrome.storage.local`. It can
contain:

- saved-paper titles, arXiv identifiers, author names, categories, abstracts, and dates;
- followed author names and normalized name identifiers;
- paper and author collection names and memberships;
- the two user settings shown on the Settings page;
- cached public arXiv results for followed-author feeds and their retrieval times.

This data remains in the Chromium profile used by the extension. The extension does
not use `chrome.storage.sync`, provide an account, or implement its own backup or sync.
Removal and retention are therefore also subject to the browser profile and extension
lifecycle.

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
  settings in `chrome.storage.local`.
- `https://arxiv.org/abs/*` content-script access: reads public title and author
  metadata on arXiv abstract pages and inserts the Save and Follow controls.
- `https://export.arxiv.org/*` host access: retrieves public Atom results for author
  feeds and the retained field-aware search page.

The extension does not request browsing-history, identity, cookies, downloads,
geolocation, clipboard, or broad all-sites access.

## Project access to data

Because v0.1.0 has no account, project-owned server, or analytics endpoint, the
project does not receive the locally stored library through the extension. This is
an implementation description, not a claim about protections supplied by the browser,
operating system, arXiv, or other software on the device.

# Release notes

## 0.1.0 — 2026-09-24

Initial public-quality release of the Chromium extension.

### Included

- Save and unsave papers from arXiv abstract pages and author feeds.
- Follow and unfollow authors directly on arXiv author lines.
- Browse followed authors and retrieve cached author feeds from arXiv's public API.
- Organize saved papers into named collections.
- Filter the Library and author feeds locally, including date-range filtering.
- Configure link behavior and optional author-collection controls in Settings.
- Local-only persistence through the Manifest V3 service worker and repository layer.

### Known limitations

- Author identity is based on normalized names and cannot distinguish namesakes.
- Author feeds are limited to the 50 newest matching arXiv API results.
- There is no account, backend sync, built-in data import/export, or mobile client.
- The field-aware Search page is retained internally but is not part of primary
  navigation.

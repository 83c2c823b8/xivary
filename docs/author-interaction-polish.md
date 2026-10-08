# Author navigation and interaction polish — 2026-10-09

## Starting state and scope

Clean `master` at `c0c1a1fab86a990f51904010fcb6bd00b95217eb`, matching origin.
Baseline **135/135 Node tests pass**. The user reports the preceding extension is
published on the Chrome Web Store. No store ID/downloaded published artifact was
provided; this run neither downloads credentials nor publishes an update.
Version remains 0.2.0 during implementation; a store update needs its next version
selected during release preparation. Prior release/candidate evidence remains historical.

## Navigation and Following

The existing `openArxivLinksInNewTab` controls outbound Xivary → arXiv links and
defaults to false. Inbound author entry was always new-tab. Reusing the outbound
boolean would change current users' defaults or couple two opposing directions.
The additive `openAuthorResultsInNewTab` therefore defaults to true, preserving
inbound behavior. Settings exposes both distinctly. The background rereads it for
each ordinary activation and uses native `tabs.create`/source `tabs.update`; failed
handoff navigates to the original arXiv href. No synthetic modified-click behavior.

The author heading derives Follow/Unfollow from memberships, rereads on focus,
submits desired-state operations with a busy guard and exposes the existing
Collections picker when organized. Opening/refreshing never follows. Name keys and
namesake disclosure remain; no verified-person identity algorithm was added.

## Real DOM investigation and support

Fetched the [current standard search page](https://arxiv.org/search/?query=Yuya+Nakamura&searchtype=author)
over HTTPS on 2026-10-09. Its results are `li.arxiv-result`, with `p.authors`, a
semantic `Authors:` label and same-origin `/search/?searchtype=author&query=...`
anchors. The first two result structures are captured in `arxiv-search.html`:
visible Yoshiki Nakamura and Yuya Nakamura both have abbreviated `Nakamura, Y` URLs.
Recognition uses the full visible name and requires the known paragraph/label,
result structure and validated author-search destination together. Abstract links
retain their established `.authors` + author-search contract, including archive paths.

Only `/abs/*` and `/search/*` content-script match patterns are enabled. URL parsing
restricts recognized search paths to the standard root/one-archive forms. Advanced
or unsupported layouts/links fail open. Titles, PDF/category/pagination/search
controls remain native. One delegated document listener also handles new result
nodes; no rewriting, added anchors, observers or per-link listeners. Ctrl/Meta/
Shift/Alt/middle/prevented events, context menus and copied hrefs keep native arXiv
destinations. Enter on an ordinary anchor follows the configured Xivary behavior.

## Undo and collections

Ordinary paper removal, Unfollow and membership removals return opaque background
receipts through RepositoryClient. Detached records/removed memberships live only
in bounded memory (up to 100), expire after eight seconds and are lost safely on
background recreation. No persistent history/schema/Sync/portable fields exist.
Undo executes under the existing repository queue, checks per-entity changes,
post-removal state and collection generations, then restores only removed members
and missing original metadata. It leaves other items/settings/local pointers intact.
Even re-add/remove ABA sequences, deleted/reimported classifications, duplicate
Undo and expired/restarted receipts cannot restore stale intent. Failed writes
retain the original local state; a failed Undo write remains retryable until expiry.
The toast retains its button after a rejected request. A committed Undo followed
by a refresh failure cannot submit that Undo twice. Chrome tests simulate one RPC
rejection then exercise a successful retry; Node tests exercise failed writes.

Each successful ordinary removal gets its own nonblocking toast. Independent items
can Undo in either order. A newer change to the same item invalidates its older
receipt, with a clear message. Closing/reloading the page dismisses its UI; no
persistent notification is promised. Native timer expiry was observed in Chrome.

Whole-collection deletion instead uses a native modal naming the collection.
Library warns that papers saved only there are removed from Bookmarks; Following
warns that authors followed only there become unfollowed. Other memberships remain.
Cancel/Escape change nothing; confirm is guarded and errors keep the dialog open.
Creation shares focus, Enter, Escape, outside-pointer cancellation even with text,
whitespace cancellation and one submission path. Outside clicks never create.

## Bounded transient-search investigation

- Packaging copies runtime source byte-for-byte; there is no bundled/minified or
  store-specific request path, build flag or production endpoint. Package tests
  compare every runtime file. Published bytes cannot be compared without the actual
  store artifact; a store-specific slowdown was not reproduced.
- Queries retain full-name `au:"name"`, HTTPS Atom endpoint, start 0, newest-first,
  max 50. Results require one individual full-name match; initials/spelling variants
  can still be excluded, and namesakes remain possible.
- Cache TTL remains 24 hours; valid empty feeds can be cached. Explicit Refresh
  retries. Existing HTTP/parser/entry failures reject and retain previous cache.
  There is no explicit timeout, automatic retry or shared cross-tab request pool.
  None was added without evidence for changing the networking contract.
- Demonstrated defects: a focus/local read could reveal empty UI during the initial
  fetch, and an HTTP-200 non-Atom document with no entries could become an empty
  cache. The view now uses loading/ready/error phases and single-flight refresh;
  the service requires an Atom feed root. Unexpected successful responses become
  errors; cached rows remain available after refresh failure. These defects are
  not evidence of the cause of the reported temporary store-installed slowdown.

## Compatibility and verification

Schema 5/migrations/IDs and portable v1/v2 semantics remain unchanged. Missing new
boolean normalizes to true; invalid values fail without resetting storage. Existing
Sync v1 absent-register seeding/revisions/recovery apply to the new third eligible
preference. Older settings-only clients ignore it. Libraries/caches/pointers remain
local; legacy remote library records stay ignored/untouched. Manual transfers still
exclude every preference/receipt. Firefox remains local-only. No API permission,
broad host permission or dependency was added; content access now also matches the
specific arXiv search path required by this feature.

Verification results and current package inspection are recorded in
[release.md](release.md#author-navigation-and-interaction-polish) and
[browser-support.md](browser-support.md). Live search HTML inspection and browser
fixture exercise are distinguished; this run does not claim a live API or account
propagation test. Remaining distribution/account/minimum-version/macOS/native
context-menu and Firefox-native-transfer checks remain manual release requirements.

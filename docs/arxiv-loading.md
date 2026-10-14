# arXiv pacing and progressive author results — 0.4.0

## Investigation and scope

Started at `72a0d3fde811c4728e403c3fb24602c22aaf9992` with the preceding
0.4.0 preparation intact: 12 modified tracked files and the new upgrade script.
Inspected project guidance, recent commits, architecture/release procedures and
all API call sites. No product version, permission or local schema bump is needed.
Research Feed remains deferred to 0.5.0.

Before this change, each Author Results page called `fetchArxivPapers` directly
from its own context; the retained Search page did the same. The per-page busy
flag prevented duplicates in that view, but did not coordinate different tabs.
Library/Following themselves do not fetch; their author links open those views.
There was **no pagination loop**: one request asked for the first 50 submitted-date
results. Retrieval awaited the entire response text before parsing/rendering.
Every non-200 response, including 429, immediately failed without cooldown/retry.

[arXiv’s API terms](https://info.arxiv.org/help/api/tou.html) require at most one
legacy-API request every three seconds and one connection at a time, across the
machines under a caller’s control. Independent tabs could violate that limit.
The [manual](https://info.arxiv.org/help/api/user-manual.html) also advises avoiding
large result sets. No smaller initial request is introduced solely for display.

One diagnostic GET to the existing `https://export.arxiv.org/api/query` returned
**429**, body `Rate exceeded.`, `Server: Google Frontend`, `Via: 1.1 google,
1.1 varnish, 1.1 varnish, 1.1 varnish`, `X-Cache: MISS, MISS, MISS`, and no
Retry-After. No configured HTTP/HTTPS/ALL_PROXY environment host was found.
The extension contains no intermediary endpoint/proxy. These headers establish
an upstream/edge response at the configured URL; they do not identify the exact
internal quota layer or the issuer of the user’s original response. A single
request also failing means a shared/pre-existing upstream limit can remain even
with compliant scheduling. No further live API calls were made to provoke/retest it.

## Scheduler and transport

The shared background entry instantiates one ArxivScheduler in either the Chrome
MV3 worker or Firefox event page. Author Results and Search use short-lived native
runtime ports; only known internal senders and bounded queries are accepted.
The endpoint, first-50 limit and sort order remain fixed. Redirects are rejected
rather than issuing hidden, unpaced requests to another endpoint.

- FIFO jobs, one connection until its body finishes/cancels, at least 3000ms
  between starts. Retries join the tail behind already queued authors.
- Identical in-flight URLs share one job. New consumers receive accumulated
  response text; aborting one does not cancel another consumer’s job.
- 429 honors Retry-After seconds or HTTP dates. Headerless failures use shared
  consecutive-failure exponential backoff with up to 25% jitter (bounded at
  37.5 seconds). The resulting cooldown applies to every queued query.
- Waiting consumers receive a status update at most 20 seconds apart while
  queued/cooling down, keeping ordinary MV3 idle shutdown from aborting an active
  permitted wait. [Chrome’s lifecycle documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) describes messaging keepalive. Updates stop when no consumer needs the job.
- At most three retries/four attempts per job, 120 seconds per consumer and a
  25-second connection budget. Long Retry-After remains retained; a consumer
  whose wait budget cannot cover it gets a clear retry-later error immediately.
- A single private repository field, `_arxivApi.until`, holds the pacing/cooldown
  deadline in the local schema-5 envelope. Before fetching, the worker commits a
  connection-timeout lease plus spacing. Normal completion releases it to the
  pacing deadline; a killed worker’s replacement observes the retained lease or
  server cooldown. No queue, queries, bodies or retry promises are persisted or
  replayed. Storage-read/reservation errors fail closed.

Pacing persistence uses PaperRepository in the existing shared worker; UI cache
commits remain through RepositoryClient. Only storage.js accesses browser storage.
The deadline never enters preference Sync or portable backups. Existing settings,
bookmarks, follows, collections, memberships, IDs and cache format remain intact.
Coordination covers one installation/profile, not other browsers, programs or
machines sharing the upstream quota. The client does not evade limits or guarantee
that upstream rate limiting disappears.

## Progressive results, cache and cancellation

Response chunks cross the port. The page parses only well-formed Atom prefixes
ending at a complete entry, normalizes/deduplicates stable arXiv IDs, and appends
usable rows in server order. A complete final feed must still validate before any
cache write. Cached results appear immediately and remain on screen during a
refresh; failed refreshes never erase them. Incomplete first-load rows stay usable
with an explicit incomplete/error status and no Updated timestamp or fresh cache.
A failed retry with fewer provisional entries retains the previously usable
partial rows until replacement results catch up or a complete feed validates.
An interrupted first load writes **no partial cache**; an interrupted refresh
retains the previous complete cache. Valid empty feeds remain genuine empty results.

Year sections and unchanged rows retain DOM identity. Bookmark state updates in
place, including during loading; local text/date filters apply to incoming papers.
Loading and completion use matching compact status-line geometry. Results remain
**the first 50 API hits filtered by full name**, not a complete bibliography.
Streaming improves response-body latency only when the upstream releases bytes;
it cannot remove server time-to-first-byte or buffering.

Pagehide aborts its port and invalidates the view revision. Search input changes
abort obsolete remote Search work; author-page filters are local and do not restart
retrieval. Queued jobs with no consumers are dropped, active abandoned jobs abort,
and stale callbacks cannot overwrite the current view. Port disconnect/worker
restart is a recoverable error with Refresh available. Timers/listeners are removed
on settlement; other consumers retain shared requests.

## Related UI cleanup requested during verification

The shared paper-row renderer removes its duplicate Abstract action everywhere.
The title retains the same native abstract-page link, PDF/bookmark controls remain,
and Vim hint targets update from the live DOM without a mapping change.

Undo notices now use the shared bottom-right, compact surface and three seconds
of visible time. Pointer hover, keyboard focus and pending Undo pause dismissal;
leaving resumes the remaining time. One receipt yields one notice. Page exit and
successful Undo clean up timers/notices. Routine bookmark/collection/follow success
messages are removed, while errors, loading and consequential warnings remain.
Background receipts still expire after eight seconds and reject changed items;
hover pauses the notice, **not** that restoration validity window.

## Verification and controlled performance

237 Node tests pass, including deterministic-clock pacing, multiple authors and
pagination URLs, both Retry-After formats, shared headerless backoff, exhaustion,
timeout/total budget, consumer dedup/cancellation, stale port events, restart leases,
complete-cache preservation and Undo timer pause/resume. Existing migration,
preference-only Sync simulations, import/export and bookmark regressions pass.

Installed Chrome 154 and Firefox 157 smoke/interaction suites pass. Native tests
cover title Ctrl/middle/current/new-tab behavior, PDF/bookmark presentation, Vim
hints, author matching/filtering, existing collections, Undo restoration and
three-second notice geometry/hover/focus/dedup. Chrome’s harness now brings the
author tab forward before clicking Undo; background-tab native input was unreliable.
Native timer/fetch defaults use wrappers to preserve browser API receivers.

`npm run test:arxiv-loading` uses a disposable installed Chrome extension and local
TLS streaming/429 fixtures, with production traffic blocked. It verifies filtering
and bookmarking while incomplete, two rapidly opened authors sharing pacing,
worker termination during cooldown followed by reload/recovery, duplicate entries,
row/section identity and unchanged scroll, queued-close/query cancellation, partial
failure without cache and failure retaining a prior complete cache. It also checks
Search shares the queue. This is actual installed-extension verification with
controlled responses, not production availability evidence.

The measured fixture supplies 30 initial entries, then later entries including a
duplicate, yielding 49 unique papers. Healthy retrieval uses one HTTP request both
before and after. Latest controlled run:

| Measure | Previous full-response path | Progressive path |
| --- | --- | --- |
| First usable response/display | Body unavailable until 1726ms; display could only follow | First visible paper at 268ms |
| Full response/loading | Body ready at 1726ms (baseline omits render/cache overhead) | Complete at 1925ms, including render/cache |
| Requests per healthy author | 1 | 1 |
| Cross-tab minimum spacing | None in implementation | 3015ms observed; exact >=3000ms in deterministic tests |
| Second author during first | Could issue independently | Queues; one fixture 429 then cooldown/restart recovery, two total attempts |

These are local fixture measurements, not live speed claims. No claim is made
that the server will stream early, that total retrieval is faster, or that a
3-second client interval eliminates server-side 429s.

Native release transfer/Sync lifecycle and same-ID source-upgrade checks also
pass. Reproduce with npm test, test:browser, test:firefox, test:release,
test:upgrade, test:arxiv-loading, both package commands and git diff --check.
Firefox uses the documented direct binary paths; screenshots use
ARXIV_SCREENSHOT_DIR. Reviewed current Undo, stripped paper rows and partial-error
screenshots. Logs/screenshots are retained in ignored
`dist/verification-0.4.0-stability/`.

Store-installed upgrades, account preference delivery, minimum versions, physical
IME/assistive/macOS checks remain manual. Production API recovery after the observed
429 is intentionally unverified. No upload, publication, push or commit is made.

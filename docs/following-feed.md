# Incremental research discovery Feed

Feed answers “What new papers relevant to my research have appeared recently?”
It extends the existing Following Feed, shared paper rows and paced arXiv client.
Discovery uses local deterministic rules, without a backend, external recommendation
service, engagement tracking, polling, notifications or additional navigation tabs.
Citation APIs, citation graphs and citation-author recommendations are deferred.
The extension version is 0.5.0; Feed queue versions remain independent.

## Eligibility, retention and ordering

Eligibility is exactly **30 × 24 hours**, inclusive, from the original arXiv
submission timestamp to the explicit discovery timestamp. Atom `published`, not
`updated`, supplies that date. API `submittedDate` bounds round outward to UTC
minutes; local millisecond comparisons enforce the exact window, including its
cutoff and excluding future dates. Local timezone/daylight saving does not change
eligibility. Dates display in UTC. See the
[arXiv API manual](https://info.arxiv.org/help/api/user-manual.html).

The persistent queue contains at most **100 papers**, ordered by original timestamp
descending, then canonical arXiv ID ascending. This tie-break does not fluctuate
with relationship strength or terminology. Recency is an ordering rule, not a
judgment of scientific quality. Metadata and the reason freeze at admission;
a revised version neither reinserts nor promotes a paper. The highest retrieved
version supplies metadata on initial admission and `versionedId` is preserved
for the existing Offline action.

Existing eligible entries are retained on discovery. Expired entries and excess
oldest entries are pruned; category-only entries have a separate five-entry limit.
Nothing backfills the queue with older papers. Pagination is entirely local,
25 entries at a time, up to four pages, with a finite end state. A page can be short
when there are fewer eligible candidates or discovery limits have been reached.
A compact coverage message appears when raw-hit, author, relationship, category,
queue or API budgets truncate results. This is bounded discovery, not exhaustive
coverage of arXiv or a historical bibliography.

Reads and a local UI aging timer apply the current rolling cutoff, including when
offline. Pruning does not alter bookmarks or Offline copies. Empty discovery says
**No recent papers**; failures do not masquerade as first-time empty success. Older
papers remain accessible through Following's existing author-results workflow.

## Discovery sources and identity limitations

**Following** is the primary source. Membership aggregates include default/migrated
follows and compatible hidden author collections. Queries and individual full-name
matching reuse the existing author mechanism: NFKC, whitespace, case and
apostrophe/dash normalization preserve significant initials, accents and name order.
Separate people supplying a given/family name do not establish a match. A reason
shows `Following: [name]`, with +N for additional matches and full names in its
tooltip. Xivary has name keys, not verified identities; namesakes can share results.

**Direct coauthors** are the second source. A historical evidence query looks back
1095 days for papers actually containing explicitly followed names. Recent direct
results can augment those seeds. Only followed-author papers establish edges;
discovered coauthors' publications and category candidates never seed another hop.
A coauthor's new paper can appear without any followed author in its author list.
No discovered name is automatically added to Following.

Evidence retains actual canonical paper IDs, original timestamps and followed-name
provenance. Duplicate/version IDs count once. Discovery ignores author teams over
12, names over 160 characters, initials, single-token names and collaboration
labels. An edge needs two distinct papers, or one paper within 90 days for a
sufficiently complete name. Short surnames (three letters or fewer) require repeated
evidence. Selection prioritizes recent evidence (90 days, then one year), repeated
papers, latest evidence date and stable name ID. At most four coauthors per follow
and twenty overall are explored; the latest eight papers supply each relation's
provenance.

A candidate must match a selected coauthor's full name and share a category **and
at least two nongeneric terminology tokens** with a provenance paper. This
conservative guard reduces common-name collisions while intentionally missing some
legitimate cross-area work. It cannot verify identity. `Coauthor of [followed name]`
has a tooltip naming the matched coauthor and actual evidence IDs.

**Related areas** remain a small supplementary source. Actual recent followed-author
publications seed at most two categories, up to thirty specific tokens and three
adjacent title phrases per category. Queries require a real phrase in title or
abstract, category and submission bounds. Local selection requires at least three
specific shared words and an overlapping phrase; general prose, boilerplate and
LaTeX command names do not count. At most five related-only papers are admitted per
cycle and five remain in the queue. Broad categories such as math.AG, math.RT and
math.SG never admit candidates independently. Without selective evidence, this
source contributes nothing. Category-only recommendations and scientific-quality
inference from categories are deferred. `Related: [category]` retains seed IDs and
terminology in its tooltip.

Admission chooses one supported reason: Following, then Coauthor, then Related.
Later cycles do not replace that reason or rerank existing papers. Title, authors,
original date, shared bookmark/PDF/Offline actions and collapsed native abstracts
retain the compact row presentation. Author-name ambiguity is disclosed on the page
and in relevant tooltips.

## Incremental persistence and atomic commits

`followingFeedCache` has independent **format version 3** inside the existing local
research envelope (currently schema 6). It holds normalized entries/reasons/provenance, canonical IDs,
original timestamps, followed-name scope, last full successful discovery time,
last committed partial/full cycle time, coverage flags and a bounded area cache.
An eligible seen-ID ledger (maximum 5000 IDs/timestamps, without duplicate metadata)
prevents repeated insertion after bookmark removal or capacity pruning. Seen records
expire with the same 30-day window. If this exceptional bound is reached, admission
stops and incomplete coverage is reported until records expire.

A discovery cycle:

1. Reserves a persistent repository lease and loads the current queue, aggregate
   Following, Library IDs and matching evidence.
2. Fetches/parses bounded candidate sources without clearing the queue.
3. Normalizes and deduplicates candidates, excludes Library bookmarks and seen IDs,
   and retains existing metadata and supported reasons.
4. On a complete cycle, removes bookmarked entries and entries whose followed-name
   provenance no longer intersects Following. Partial cycles retain them.
5. Sorts by original date/ID, prunes expiration/capacity and commits the queue and
   lease completion in one local write.

The commit rechecks current Following and current Library, so bookmarking during a
fetch also takes effect. Partial valid responses may add genuinely new papers while
retaining cached entries; feedback and timestamps explicitly distinguish partial
results. Partial cycles do not advance the last full successful timestamp. If all
candidate requests fail, cancellation interrupts a cycle, scope changes before
commit or a quota write fails, the previous persisted queue remains intact.
Independently validated coauthor evidence may still be reusable.

Version-1 and version-2 Feed caches migrate only validated recent, supported papers
into the queue. Migration/pruning is idempotent and touches only disposable Feed
metadata. Incompatible/corrupt caches return an empty recovery view while their raw
field is preserved until a successful new commit. They never block Library or
Following or rewrite owned records. Persisted leases survive worker suspension and
browser restart; stale operations cannot overwrite a newer lease.

All operations cross `PaperRepository` through `RepositoryClient`, the validated
background handler and serialized `LocalRepository`. Only the storage adapter
accesses browser storage. Queue, evidence, area cache, seen ledger, leases and retry
bookkeeping remain local; they do not enter Chrome Sync or portable exports.
Bookmarks, memberships, collections, preferences and both last-used settings retain
their existing storage/sync semantics. No PDF bytes, raw responses, personal browsing
history, engagement events or durable network jobs enter the Feed cache.

## Demand-driven scheduling and request budgets

A Feed opening/focus checks discovery against the last full successful cycle.
**Fresh within twelve hours means no arXiv request.** Due discovery runs on demand;
there is no periodic browser alarm, continuously running service or closed-browser
request. Manual Refresh uses the same incremental path. Successful cycles impose a
one-minute cooldown to prevent repeated clicks from creating request bursts.

Web Locks coordinate live views; a durable three-minute repository lease prevents
simultaneous refreshes and survives worker/view loss. Calls in the same view share
one promise. Another view sees committed data through a best-effort notification
and repository read. Abandoned leases impose failure backoff when reclaimed.
Transient or partial discovery failures use five-minute exponential backoff, doubling
up to twelve hours; quick navigation and manual clicks respect this deadline.
This complements, rather than shortens, the shared scheduler's server cooldown.

Historical coauthor evidence expires after **seven days**, with matching Following
scope. Changing Following invalidates that scope; new recent direct papers can
augment evidence without extending its historical fetch timestamp. Area profiles
also reuse actual bounded seed metadata for seven days and always revalidate seed
recency. Neither historical coauthorship nor categories is re-fetched on every
opening or twelve-hour discovery.

Routine new-paper queries start at the later of the current 30-day cutoff and the
last full success minus one day. The overlap catches delayed indexing within that
period; first population and changed Following use the full window. Delays longer
than the overlap can be missed. Manual refresh uses the same efficient range.

- **12 query jobs per cycle total**, including evidence and raw pagination. The
  shared scheduler has one connection, at least three-second spacing, a 25-second
  connection timeout, 120-second consumer wait and up to four attempts for 429
  responses, respecting Retry-After and persistent cooldowns. Feed operations have
  a 180-second cancellation limit. Retry attempts are not extra admitted jobs.
- At most **four stable followed-name groups**, each up to forty names/3500 query
  characters (usually at most 160 followed names; long names reduce this). The
  entire local Following list is preserved; larger lists have incomplete coverage.
- Historical evidence fetches one fifty-hit page per selected group, at most 200
  seed records. Direct/coauthor groups fetch at most 200 raw hits each at offsets
  0/50/100/150. Coauthor groups contain at most twenty selected names overall.
- At most two related-area queries fetch fifty raw hits each. All share the same
  twelve-job budget. Category terms/phrases and candidate verification are bounded.
- The collector seeks up to 100 eligible candidates after name/date/topic/bookmark
  filtering; chronological frontiers prevent unfetched newer results being silently
  treated as exhausted. Native More never contacts arXiv.

Many followed groups, prolific/common names, duplicate hits, false name matches and
bookmarks can consume the budget and leave short pages. Historical seed truncation
can miss real coauthor relationships. Offset pagination is not an immutable upstream
snapshot: submissions can shift offsets between requests. Canonical deduplication
and the next demand cycle's overlap reduce, but cannot eliminate, those coverage gaps.

## Bookmark, Offline and reading stability

Newly bookmarked visible papers immediately update their icons and retain the same
mounted row and expanded abstract. The next **complete successful discovery cycle**
removes them from the persisted queue. Partial failures retain them. An offline-only,
unbookmarked paper remains eligible. Unbookmarking does not trigger an arXiv request
or automatically reinsert a previously admitted paper; Library and Offline never
receive writes from Feed maintenance.

Refresh completion stages changed entries behind a small conditional **N new papers**
(or **Update feed**) control. The current visible list does not jump while reading;
applying changes preserves a surviving reading row's offset where practical. A new
opening reads the persisted queue. A subtle **Updated 4h ago** indicator describes
the most recent cycle; partial cycles are labeled. Controls are native buttons,
abstracts native details/summary with accessible names, counts/status polite live
regions, and local pagination focuses the first newly displayed title. No permanent
filters, scores, colorful badges, large cards or scheduling settings are added.

## Verification

Current 0.5.0 source/package verification is in the
[release record](release.md#v050--2026-10-15). The records below describe the
earlier Feed milestone before release preparation.

The incremental milestone began from the existing uncommitted discovery implementation.
Its archive-free baseline passed 268 unit tests and the installed Chrome discovery
suite. All unrelated changes were preserved; the file baseline is under
`/tmp/xivary-incremental-baseline/`. Development created no ZIP/release package
and did not change the version. Commit preparation rechecks the verified tree
separately; no push or publication is included.

```sh
npm test -- --test-skip-pattern='both ZIP artifacts'
npm run build
npm run test:feed
npm run test:feed:live # production arXiv, disposable Chrome profile
npm run test:browser
npm run test:offline
npm run test:arxiv-loading
XIVARY_NO_ARCHIVE=1 \
FIREFOX_BIN=/snap/firefox/8995/usr/lib/firefox/firefox \
GECKODRIVER_BIN=/snap/firefox/8995/usr/lib/firefox/geckodriver \
npm run test:firefox
git diff --check
```

Final verification: **283 unit tests pass**, with the ZIP fixture test excluded.
The archive-free production build stages **169 runtime files** for Chromium and
Firefox at 0.4.0. Full Chrome 154, Firefox 157, Offline and shared arXiv loading
regressions pass. The installed incremental Feed and live lifecycle checks pass.
Desktop, narrow and live screenshots were inspected. Physical screen readers and
minimum browser versions remain manual checks.

Commit preparation re-ran the archive-free 283-test suite, both production builds,
installed Feed, full Chrome/Firefox, Offline and shared arXiv loading checks. All
passed. An initial parallel Offline run hit an existing post-reload DOM timing
race; its unchanged suite passed when re-run in isolation. `git diff --check` passed.
The prior live arXiv verification remains recorded above; commit preparation did
not repeat production network queries.

Tests cover first population, insertion/retention/frozen metadata, versions,
canonical IDs/seen records, UTC millisecond cutoffs, capacity/expiration/order,
filtered local pagination, twelve-hour freshness, manual cooldown, coauthor
seven-day expiry/scope/one-hop/ambiguity, category selectivity, concurrent calls,
durable leases/backoff, partial/all-source failures, atomic quota failure,
v1/v2 migration, corrupt-cache recovery, restart and unchanged owned/sync/export
records. Installed Chrome checks use actual repository/IndexedDB, native input,
shared pacing/Atom parsing, bookmark/Offline actions, collapsed abstracts and AX
semantics, reading stability, concurrent views, worker suspension and profile
restart. Full Chrome/Firefox/Offline/shared-loading regression geometry remains
intact. New Feed-specific native coverage is Chrome-specific.

Live verification uses real metadata for Michael Brandenbursky, Sebastian Opper
and Atsushi Takahashi. Paper **2610.12279**, “Invariant sets and spectral rigidity
of Hamiltonian diffeomorphisms,” was initially submitted **2026-10-08T16:38:20Z** by
Habib Alizadeh and Egor Shelukhin. It appears as Coauthor of Michael Brandenbursky,
whose name is absent from its author list. Actual coauthored papers **2512.15375**
and **2509.07270** supply the relationship evidence. The initial live cycle used
five jobs and contributed one Following, one Coauthor and two narrowly Related
papers. These are point-in-time results, not verified author identities or an
upstream-availability guarantee.

The live lifecycle check reloads a fresh Feed without requests, bookmarks a row
without disappearance, ages a controlled prior queue and withholds one actual
candidate to exercise due incremental insertion/retention, then restarts Chrome
with the same disposable profile. This simulates elapsed prior state; it does not
pretend that a new real submission occurred during the test. Screenshots/logs are
under `/tmp/xivary-discovery-live/` and `/tmp/xivary-incremental-*.log`.

## Remaining limitations

Namesake/changed-name identity, wider collaboration graphs, coverage beyond the
stated budgets, indexing delays beyond the overlap, physical screen-reader use,
minimum browser versions and scientific-relevance judgments remain limitations.
No cross-profile Feed synchronization, two-hop expansion, unread tracking,
recently-revised-paper mode, category-only filler or verified author-ID integration
is implemented. Citation discovery is explicitly deferred, including citation APIs,
graphs and citation-author recommendations. Custom TeX examples now use
`\Hom = \operatorname{Hom}`; parser syntax and settings behavior are unchanged.

## Milestone files

Review identified the following files as belonging to the completed Feed and TeX
example milestone, including the navigation/API integration from its preceding
Following Feed implementation. No unrelated working-tree changes are included.

- Documentation: `docs/following-feed.md`, `docs/UI_DESIGN.md`,
  `docs/architecture.md`, `docs/offline-storage.md`, `docs/latex-rendering.md`.
- Feed UI/model: `extension/src/feed/discovery.js`, `feed.js`, `feed.html`,
  `feed.css`, `queue.js`.
- Retrieval: `extension/src/services/following-feed.js`, `feed-refresh.js`,
  `arxiv-client.js`, `arxiv-paper-service.js`.
- Repository: `extension/src/repository/local-repository.js`, `paper-repository.js`,
  `repository-client.js`.
- Background integration: `extension/src/background/arxiv-requests.js`,
  `repository-handler.js`, `service-worker.js`, `tab-navigation.js`.
- Navigation: `extension/src/author/author.html`, `authors/authors.html`,
  `library/library.html`, `offline/offline.html`, `search/search.html`,
  `settings/settings.html` (also the TeX placeholder).
- Verification: `scripts/feed-smoke.mjs`, `scripts/feed-live-smoke.mjs`,
  `scripts/browser-smoke.mjs`, `scripts/offline-smoke.mjs`,
  `tests/feed.test.js`, `tests/feed-queue.test.js`, `tests/arxiv-client.test.js`.
- Commands: `package.json` adds the two Feed test scripts; its version is unchanged.

Generated `dist/` trees are artifacts and are excluded from the commit. No manifest
or package version changes, release archives, push or publication are included.

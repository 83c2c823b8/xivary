# Optional LaTeX rendering and custom macros

Settings → Abstracts → **Render LaTeX in abstracts** defaults to On. Turning it
off displays the original notation. It applies to Author Results and direct Search
results (Search remains outside primary navigation). Library still hides abstracts;
Following lists authors. Xivary does not change native arXiv page rendering.

Settings → **Custom LaTeX macros** accepts one zero-argument definition per line:

```text
\Stab = \operatorname{Stab}
\Hom = \operatorname{Hom}
\Ext = \operatorname{Ext}
\Db = D^{\mathrm{b}}
```

Click **Save macros** to apply. Edit or remove lines and save again; an empty
editor removes all custom macros. Backslashes are literal: do not double them in
the editor. Names start with one backslash and use ASCII letters only. Blank lines
are ignored. Each line splits at its first `=`, so `\Equation = x=y=z` is valid.
Whitespace around the name and replacement is ignored. References to other defined
macros, including later lines, are supported. Parameters (`#`) and comments (`%`)
are not supported. Built-in command names cannot be overridden. Duplicate names,
unknown replacement commands, malformed replacements and recursive definitions
produce line-numbered feedback. Invalid drafts never replace the saved configuration.
Focus refresh preserves unsaved drafts; reloading discards them.

The toggle and definitions persist locally through the repository across restarts.
They are excluded from Chrome Sync and portable Bookmarks/Following files. Chrome
still synchronizes only the original four designated navigation/organization
preferences. Firefox remains local-only. No library data, memberships, last-used
choices, schema number or portable format changes are required.

## Rendering and fallback

Supported delimiters are `$...$`, `\(...\)`, `$$...$$` and `\[...\]`. Text outside
them remains literal, including HTML-looking text and escaped `\$`. Internal
whitespace and paragraph breaks are preserved; newly retrieved API abstracts no
longer collapse them. Existing stored abstracts are not rewritten, so whitespace
already collapsed by older versions cannot be reconstructed.

Unknown macros have no inferred meaning. `\Stab(X)` renders only after an explicit
definition. Unknown, malformed, restricted or oversized expressions display their
exact original source including delimiters. A failed expression does not stop
other expressions. No red KaTeX error output is shown. Abstract text is never
inserted as HTML. Rendering uses supported `katex.render`, with `trust: false`,
`throwOnError: true`, `strict: "error"` and HTML/MathML accessibility output.
Definitions are tested with `renderToString`, never JavaScript evaluation.
Each render uses a fresh macro map; definitions cannot leak between expressions,
papers or views. URLs, images, HTML extension commands, definition operations and
dynamic command construction are restricted even within macro replacements.

The scanner deliberately favors raw text for ambiguous dollars: single-dollar
math cannot start with a digit or whitespace, end with whitespace, border a digit
outside, or cross a newline. Thus `$2$` stays raw; use `\(2\)` for numeric math.
Dollar quoting and currency are inherently ambiguous and not universally detected.
Unmatched delimiters remain text. Recognized expressions are at most 4096 characters,
macro configuration at most 16384 characters/100 definitions, expansion at most
200 operations, and rendered sizes at most 10em. Scanning has a linear work budget;
remaining unsupported content stays raw. These are conservative resource limits,
not a promise to render arbitrary LaTeX. Deep syntax, document preambles, packages,
domain-specific commands and full paper sources are outside this feature.

KaTeX 0.19.0 JavaScript, CSS and all fonts referenced by that CSS are bundled under
`extension/vendor/katex/` with their licenses. No CDN requests, source fetching,
AI inference, accounts, telemetry or new permissions are introduced. The existing
MV3 script policy remains unchanged. Abstracts expand naturally without internal
scroll containers. Display equations wrap at KaTeX break points where available;
indivisible expressions remain visible rather than being clipped. Prose retains
the existing compact reading layout.
Author Results reuses rendered rows during filtering and invalidates its cache
when settings change. Open result pages reread settings on focus or reopening.

Implementation follows KaTeX's [supported API](https://katex.org/docs/api),
[untrusted-input options](https://katex.org/docs/options) and
[security guidance](https://katex.org/docs/security).

## Verification record — 2026-10-09

Started with a clean `master` at
`8bbf3fdd22d40327486d41f0f63de2e9d1efd5b1` (0.3.0 preparation). Baseline Node:
170/170. Baseline Chromium initially raced font loading in its existing Follow
geometry assertion; the harness now waits for fonts before the same assertion.
Firefox's Snap launchers could not create their temporary profile. Using the
installed executable and geckodriver directly resolved that environment boundary;
no profile permissions or coverage were relaxed.

Final automated gates:

| Check | Result |
| --- | --- |
| `npm test` | PASS, 179/179 |
| `npm run test:browser` | PASS, Chrome 154.0.8037.57; full smoke and polish suites |
| `npm run test:firefox` | PASS, Firefox 157.0; generated package and full fixture suite |
| `npm run test:release` | PASS, native category transfer, Sync events/alarm/worker/reload/profile restart |
| `npm run package` | PASS, 143 files; 1,261,478 bytes |
| `npm run package:firefox` | PASS, 143 files; 1,261,545 bytes |
| `git diff --check` | PASS |

Node tests cover real KaTeX output through a DOM sink, delimiter reconstruction,
prose/whitespace, all four delimiters, requested math examples, macros/forward
references/first-equals/edit/removal/reserved names, malformed/unknown/recursive/
restricted input, literal HTML, long input, local defaults/RPC/invalid-save atomicity,
portable category isolation and two independent sync replicas. Packaging tests
compare ZIP contents to source and verify every CSS font URL is local and present.

Native browser workflows use the actual Author Results cache and Settings, then
restore fixtures. They verify font loading, MathML, exact raw fallback, custom macro
saving/editing/removal/reload/invalid drafts, focus-driven updates, reuse of rendered
nodes during filtering and bounded wide equations. The release harness additionally
verifies local LaTeX settings after a full Chrome profile restart, with no new Sync
keys. Existing popup, Library, Following, author actions, collection management,
publication-date filters and Undo checks remain in the full suites.

Reproduce screenshots with `ARXIV_SCREENSHOT_DIR=/tmp/xivary-latex-chrome` on the
Chromium command. In this environment Firefox uses:

```sh
GECKODRIVER_BIN=/snap/firefox/current/usr/lib/firefox/geckodriver \
FIREFOX_BIN=/snap/firefox/current/usr/lib/firefox/firefox \
ARXIV_SCREENSHOT_DIR=/tmp/xivary-latex-firefox npm run test:firefox
```

Inspected both browsers' `latex-math-heavy.png`, `latex-custom-macro.png`,
`latex-unknown.png`, `latex-disabled.png`, `latex-prose.png`, `latex-settings.png`,
`latex-settings-invalid.png` and narrow/top/bottom screenshots. Firefox names have
`firefox-` prefixes. Chromium's narrow viewport is 360px; Firefox's native minimum
is 500px here. Inline alignment, paragraph breaks, display scrolling from the first
term, wrapping, literal fallback and compact Settings controls were reviewed.
Screenshots and test logs remain in `/tmp/`, outside packages and Git.

Package SHA-256:

- Chromium: `7225f94136eb120385fb14b4cc98de3f4c1e0ed212ea6c37a58f00291c92e6f1`
- Firefox: `a3b74556419deafcb6c9076722337a7726222bbfd19e4b9b56d06a48ef06a16d`

These are fixture checks with disposable profiles, not Google-account propagation,
minimum-version or signed/store-installation evidence. Screen readers, physical
keyboard access to overflowing equations, platform themes and Firefox signed-addon
restart remain manual checks alongside the existing [release checklist](release.md).
No live arXiv check was needed for this rendering milestone. Arbitrary LaTeX and
ambiguous currency remain intentionally limited as described above.

Changed source areas:

- New `extension/src/domain/latex.js`, `extension/src/ui/abstract.js` and
  `extension/vendor/katex/` (module, CSS, fonts, licenses and provenance).
- `extension/src/ui/paper-row.js`, `page.css`, `author/author.js`, `search/search.js`
  and `services/arxiv-paper-service.js` for shared rendering, caching and whitespace.
- `extension/src/settings/settings.{html,css,js}`, repository
  `paper-repository.js`, `repository-client.js`, `local-repository.js` and background
  `repository-handler.js` for compact local preferences and validated writes.
- New `tests/latex.test.js` and `scripts/latex-workflow.mjs`; updated repository,
  sync, author-paper and packaging tests and Chromium/Firefox/release smoke scripts.
- README, CHANGELOG, PRIVACY, UI design, architecture, Sync, import/export,
  browser-support and release documentation, plus this guide.

Product/package version, manifest/CSP/permissions, Sync projection and portable
formats remain unchanged. Generated archives are ignored development artifacts;
no push, signing, submission, Vim Mode or Research Feed is included. The final
local implementation commit is the Git HEAD containing this verification record.

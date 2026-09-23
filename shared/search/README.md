# Search contract v1

`index.js` exposes `FIELD_PRESETS`, `SEARCH_MODES`, `expandQuery` and
`buildArxivSearchUrl` without Chrome APIs, DOM, network, storage or dependencies.
The single implementation is packaged under `extension/src/search/` so selecting
`extension/` in Load unpacked still works without a build or generated copies.
Other JavaScript clients can import this entry point. Native clients can port the
following JSON contract and deterministic rules; test vectors live in
`tests/search.test.js`.

## Field preset schema

```js
{
  id: "mirror-symmetry",                 // stable key
  name: "Mirror Symmetry",               // display label
  arxivCategories: ["math.AG", "math.SG"], // Exact/Balanced scope
  broadCategories: ["math.AG", "math.SG", "math.QA"],
  terms: ["mirror symmetry", "Landau-Ginzburg", "Fukaya category"],
  rules: [{
    match: ["mirror symmetry", "mirror"],
    balanced: ["mirror symmetry", "homological mirror symmetry"],
    broad: ["Landau-Ginzburg", "Fukaya category", "matrix factorization"]
  }]
}
```

All values are strings or arrays of strings except `rules`, which is an array of
the shown rule objects. IDs are unique. Category lists contain arXiv category
identifiers. Array order is significant: it determines deterministic suggestion
priority. `terms` describes the field vocabulary; **only explicit `rules` expand
queries**. The complete configuration is `field-presets.js`.

Presets cover All fields, Algebraic Geometry, Representation Theory, Homological
Algebra, Mirror Symmetry, Symplectic Geometry, Category Theory and Persistence /
Applied Topology. Category boundaries overlap; the selected categories are a
practical filter rather than a complete classification of a mathematical field.
Neighboring terms are useful discovery suggestions, not assertions that concepts
are equivalent. The lists intentionally omit inferred author identities,
unbounded thesaurus expansion and AI-generated associations.

## Input and deterministic expansion

```js
expandQuery({ query: "mirror symmetry for K3", fieldId: "mirror-symmetry", mode: "balanced" })
// {
//   version: 1, query: "mirror symmetry for K3", fieldId: "mirror-symmetry",
//   mode: "balanced",
//   terms: ["mirror symmetry for K3", "homological mirror symmetry for K3"],
//   categories: ["math.AG", "math.SG"],
//   expandedQuery: '(ALL("mirror symmetry for K3") OR ... ) AND (CATEGORY(math.AG) OR ...)'
// }
```

- Trim surrounding query whitespace; preserve internal text, case and punctuation.
  Reject empty queries, more than 200 characters, unknown fields and unknown modes.
- **Exact:** original query only, plus the selected preset's base category scope.
  It is minimal transformation, not an instruction to quote every word. User
  quotes/wildcards are passed to arXiv and keep arXiv's native meaning.
- **Balanced:** at most two close alternatives, using `balanced` rules.
- **Broad:** at most four alternatives, using `balanced` followed by `broad` rules,
  and the preset's broader category scope.
- Match phrases case-insensitively at Unicode letter/number boundaries. Within
  each rule prefer the longest match. Substitute the first matching phrase into
  the original query, preserving surrounding words. Do not recursively expand
  generated alternatives. Deduplicate case-insensitively; original query comes first.
- All fields uses matching rules from every preset in configuration order and
  **never applies category filters**. Unknown phrases stay unchanged. An arbitrary
  vague phrase is not given semantic meaning by this version.

The plan's `expandedQuery` is a human-readable diagnostic expression, **not** a
raw arXiv API query. Its meaning is `(term1 OR term2 …) AND (category1 OR category2 …)`.

## arXiv navigation adapter

`buildArxivSearchUrl(plan)` constructs `https://arxiv.org/search/advanced` using
the native form's indexed `terms-N-term`, `terms-N-field=all` and
`terms-N-operator` parameters. Subcategory IDs use All fields, following the
[arXiv advanced search guidance](https://arxiv.org/search/advanced).

Each alternative is paired with each allowed category and joined as
`term1 AND cat1 OR term1 AND cat2 OR term2 AND cat1 …`. This distributes the filter
across every branch and follows the native [AND-before-OR grouping implementation](https://github.com/arXiv/arxiv-search/blob/develop/search/services/index/advanced.py).
Do not send API `all:`/`cat:` syntax or parenthesized diagnostic expressions to
the HTML form: those interfaces have different query grammars.

Results, relevance ranking and pagination stay on arXiv. No local ranking, API
fetch, backend proxy, embedding model or result cache exists. The popup contains
only form binding, preview rendering and browser navigation. Search rules can
later be shared with Android, iPad/iOS, web and a Linux/Raspberry Pi backend.

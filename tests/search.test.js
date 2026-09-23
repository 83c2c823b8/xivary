import test from "node:test";
import assert from "node:assert/strict";
import { expandQuery, FIELD_PRESETS, buildArxivSearchUrl } from "../shared/search/index.js";

test("Exact preserves the user's query and adds no expansion", () => {
  const query = '"mirror symmetry" for K3 & elliptic surfaces';
  const plan = expandQuery({ query, fieldId: "mirror-symmetry", mode: "exact" });
  assert.deepEqual(plan.terms, [query]);
  assert.deepEqual(plan.categories, ["math.AG", "math.SG"]);
});

test("Balanced adds limited close terms and retains surrounding user terms", () => {
  const plan = expandQuery({ query: "mirror symmetry for K3", fieldId: "mirror-symmetry", mode: "balanced" });
  assert.equal(plan.terms[0], "mirror symmetry for K3");
  assert.ok(plan.terms.includes("homological mirror symmetry for K3"));
  assert.ok(plan.terms.length <= 3);
  assert.ok(plan.terms.every(term => term.endsWith(" for K3")));
  assert.ok(!plan.terms.some(term => term.includes("Fukaya")));
});

test("Broad adds neighbors and widens categories while retaining a field restriction", () => {
  const options = { query: "mirror symmetry for K3", fieldId: "mirror-symmetry" };
  const balanced = expandQuery({ ...options, mode: "balanced" });
  const broad = expandQuery({ ...options, mode: "broad" });
  assert.ok(broad.terms.length > balanced.terms.length);
  assert.ok(broad.terms.includes("Fukaya category for K3"));
  assert.ok(broad.categories.includes("math.QA"));
  assert.ok(broad.expandedQuery.includes("AND (CATEGORY(math.AG) OR"));
  assert.ok(broad.terms.every(term => term.endsWith(" for K3")));
});

test("expansion is deterministic, deduplicated and needs no Chrome APIs", () => {
  assert.equal(globalThis.chrome, undefined);
  const options = { query: "persistent homology", fieldId: "applied-topology", mode: "broad" };
  const a = expandQuery(options);
  assert.deepEqual(expandQuery(options), a);
  assert.equal(new Set(a.terms.map(term => term.toLowerCase())).size, a.terms.length);
  assert.equal(buildArxivSearchUrl(a), buildArxivSearchUrl(expandQuery(options)));
});

test("All fields expands only recognized phrases and never adds category restrictions", () => {
  const plan = expandQuery({ query: "mirror symmetry", mode: "broad" });
  assert.ok(plan.terms.length > 1);
  assert.deepEqual(plan.categories, []);
  assert.deepEqual(expandQuery({ query: "unlisted technical phrase", mode: "broad" }).terms, ["unlisted technical phrase"]);
  assert.deepEqual(expandQuery({ query: "mirrored", fieldId: "mirror-symmetry" }).terms, ["mirrored"]);
});

test("empty queries and invalid selections fail clearly instead of opening a huge search", () => {
  for (const query of ["", "  \n", null]) assert.throws(() => expandQuery({ query }), /query/);
  assert.throws(() => expandQuery({ query: "x".repeat(201) }), /200/);
  assert.throws(() => expandQuery({ query: "x", fieldId: "missing" }), /Unknown/);
  assert.throws(() => expandQuery({ query: "x", mode: "AI" }), /Unknown/);
});

test("all eight presets have deterministic exact, balanced and broad category behavior", () => {
  assert.equal(FIELD_PRESETS.length, 8);
  assert.equal(new Set(FIELD_PRESETS.map(field => field.id)).size, 8);
  for (const field of FIELD_PRESETS) {
    const query = field.terms[0] || "mirror symmetry";
    for (const mode of ["exact", "balanced", "broad"]) {
      const plan = expandQuery({ query, fieldId: field.id, mode });
      assert.deepEqual(plan.categories, mode === "broad" ? field.broadCategories : field.arxivCategories);
      assert.equal(plan.terms[0], query);
    }
  }
});

test("advanced-search URL encodes each alternative AND category branch without leaking ORs", () => {
  const plan = expandQuery({ query: "mirror symmetry & K3", fieldId: "mirror-symmetry", mode: "broad" });
  const url = new URL(buildArxivSearchUrl(plan));
  assert.equal(url.origin, "https://arxiv.org");
  assert.equal(url.pathname, "/search/advanced");
  let index = 0;
  for (const term of plan.terms) {
    for (const category of plan.categories) {
      assert.equal(url.searchParams.get(`terms-${index}-term`), term);
      assert.equal(url.searchParams.get(`terms-${index}-operator`), index ? "OR" : "AND");
      assert.equal(url.searchParams.get(`terms-${index + 1}-operator`), "AND");
      assert.equal(url.searchParams.get(`terms-${index + 1}-term`), category);
      index += 2;
    }
  }
  assert.equal(url.searchParams.get(`terms-${index}-term`), null);
  const all = new URL(buildArxivSearchUrl(expandQuery({ query: "C++ & K3", mode: "exact" })));
  assert.equal(all.searchParams.get("terms-0-term"), "C++ & K3");
  assert.equal(all.searchParams.get("terms-1-term"), null);
});

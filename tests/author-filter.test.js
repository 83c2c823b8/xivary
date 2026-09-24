import test from "node:test";
import assert from "node:assert/strict";
import { filterAuthorPapers } from "../extension/src/author/filter-papers.js";

const papers = [
  { title: "Mirror symmetry", authors: ["Atsushi Takahashi"], abstract: "Derived categories", categories: ["math.AG"], publishedAt: "2026-09-20T00:00:00Z" },
  { title: "Persistent homology", authors: ["Alex Kim"], abstract: "Applied topology", categories: ["math.AT"], publishedAt: "2023-10-10T00:00:00Z" },
  { title: "Representation theory", authors: [{ displayName: "Renée Smith" }], abstract: "Quiver methods", categories: ["math.RT"], publishedAt: "2020-01-05T00:00:00Z" },
];
const now = new Date("2026-09-24T12:00:00Z");

test("author feed filtering searches title, authors, abstract, and categories locally", () => {
  for (const query of ["mirror", "takahashi", "derived", "math.ag"]) {
    assert.deepEqual(filterAuthorPapers(papers, { query }, now), [papers[0]]);
  }
  assert.deepEqual(filterAuthorPapers(papers, { query: "renée quiver" }, now), [papers[2]]);
  assert.deepEqual(filterAuthorPapers(papers, { query: "missing" }, now), []);
});

test("author feed date presets and custom inclusive bounds filter normalized dates", () => {
  assert.deepEqual(filterAuthorPapers(papers, { range: "any" }, now), papers);
  assert.deepEqual(filterAuthorPapers(papers, { range: "year" }, now), [papers[0]]);
  assert.deepEqual(filterAuthorPapers(papers, { range: "three-years" }, now), [papers[0], papers[1]]);
  assert.deepEqual(filterAuthorPapers(papers, { range: "custom", from: "2023-10-10", to: "2023-10-10" }, now), [papers[1]]);
});

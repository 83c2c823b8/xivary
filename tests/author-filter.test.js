import test from "node:test";
import assert from "node:assert/strict";
import { filterAuthorPapers, validateYearRange } from "../extension/src/author/filter-papers.js";

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
  assert.deepEqual(filterAuthorPapers(papers, { range: "custom", from: "2023", to: "2023" }, now), [papers[1]]);
});


test('custom years validate four-digit supported endpoints and preserve open ranges', () => {
  for (const [from,to] of [['2020','2026'],['','2026'],['2020',''],['',''],['1000','9999']]) assert.equal(validateYearRange(from,to),'');
  for (const from of ['202','20x0','0000','0999','10000']) assert.notEqual(validateYearRange(from,'2026'),'');
  assert.notEqual(validateYearRange('2026','2020'),'');
  assert.throws(()=>filterAuthorPapers(papers,{range:'custom',from:'202'}),RangeError);
});
test('year endpoints include the whole local-calendar year using publication date', () => {
  const start=new Date(2020,0,1).getTime(), end=new Date(2027,0,1).getTime();
  const examples=[start-1,start,end-1,end].map(time=>({publishedAt:new Date(time).toISOString(),updatedAt:'2023-01-01T00:00:00Z'}));
  assert.deepEqual(filterAuthorPapers(examples,{range:'custom',from:'2020',to:'2026'}),examples.slice(1,3));
  assert.deepEqual(filterAuthorPapers(examples,{range:'custom',from:'',to:'2026'}),examples.slice(0,3));
  assert.deepEqual(filterAuthorPapers(examples,{range:'custom',from:'2020',to:''}),examples.slice(1));
  const missing={title:'No date'};
  assert.deepEqual(filterAuthorPapers([missing],{range:'any'}),[missing]);
  assert.deepEqual(filterAuthorPapers([missing],{range:'custom',from:'1970'}),[]);
});
test('presets remain rolling one/three years and compose with unchanged text matching', () => {
  const now=new Date(2026,9,9,12), boundary=new Date(now);boundary.setFullYear(2025);
  const examples=[boundary.getTime()-1,boundary.getTime(),now.getTime()].map(time=>({title:'Research',publishedAt:new Date(time).toISOString()}));
  assert.deepEqual(filterAuthorPapers(examples,{range:'year'},now),examples.slice(1));
  assert.deepEqual(filterAuthorPapers(examples,{range:'three-years'},now),examples);
  assert.deepEqual(filterAuthorPapers(papers,{range:'custom',from:'2020',to:'2026',query:'renée quiver'},now),[papers[2]]);
});

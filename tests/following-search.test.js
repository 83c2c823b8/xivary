import test from "node:test";
import assert from "node:assert/strict";
import { filterFollowedAuthors } from "../extension/src/authors/filter-authors.js";
import { createAuthor } from "../extension/src/domain/author.js";

const authors = ["Renée O’Connor", "Alex Kim", "Boundary Researcher"].map(name => createAuthor({ displayName: name }));

test("Following name filtering preserves order and records across empty, exact, partial, case and whitespace queries", () => {
  for (const query of ["", "   ", "\n\t"]) assert.equal(filterFollowedAuthors(authors, query), authors);
  for (const query of ["Alex Kim", "kim", "ALEX", "  Alex Kim  "]) assert.deepEqual(filterFollowedAuthors(authors, query), [authors[1]]);
  assert.deepEqual(filterFollowedAuthors(authors, "r"), [authors[0], authors[2]]);
  assert.deepEqual(filterFollowedAuthors(authors, "missing"), []);
  assert.deepEqual(filterFollowedAuthors([], "Alex"), []);
  assert.deepEqual(filterFollowedAuthors(authors, ""), authors);
});

test("Following search reuses canonical name normalization without accent folding or ranking", () => {
  assert.deepEqual(filterFollowedAuthors(authors, "RENÉE O'CONNOR"), [authors[0]]);
  assert.deepEqual(filterFollowedAuthors(authors, "ＡＬＥＸ   ＫＩＭ"), [authors[1]]);
  assert.deepEqual(filterFollowedAuthors(authors, "Renee"), []);
  const fallback = [{ displayName: "Jean–Paul" }];
  assert.deepEqual(filterFollowedAuthors(fallback, "jean-p"), fallback);
});

test("search is a pure linear filter over large followed lists", () => {
  const list = Array.from({ length: 3000 }, (_, i) => createAuthor({ displayName: `Researcher ${i}` }));
  const before = structuredClone(list);
  list.forEach(Object.freeze);
  Object.freeze(list);
  assert.deepEqual(filterFollowedAuthors(list, "researcher 29"), list.filter(author => author.displayName.startsWith("Researcher 29")));
  assert.deepEqual(list, before);
});

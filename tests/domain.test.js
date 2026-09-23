import test from "node:test";
import assert from "node:assert/strict";
import { normalizeArxivId } from "../extension/src/domain/identifiers.js";
import { createPaper } from "../extension/src/domain/paper.js";
import { createAuthor, createAuthorReference, normalizeAuthorName, stableAuthorKey } from "../extension/src/domain/author.js";
import { extractPaper } from "../extension/src/content/extract-paper.js";

const now = "2026-09-24T01:02:03.000Z";
const input = { arxivId: "2401.00001v2", title: " A  paper ", authors: ["Renée Smith", "Alex Kim"] };

test("modern and legacy arXiv IDs are canonical across versions and URLs", () => {
  for (const value of ["2401.00001", "arXiv:2401.00001v2", "https://arxiv.org/abs/2401.00001v3?x=1", "https://arxiv.org/pdf/2401.00001v2.pdf"]) {
    assert.equal(normalizeArxivId(value), "2401.00001");
  }
  assert.equal(normalizeArxivId("https://arxiv.org/abs/hep-th/9901001v12"), "hep-th/9901001");
  assert.equal(normalizeArxivId("0704.0001v1"), "0704.0001");
  for (const value of ["", "2401.1", "2401.00001v0", "https://evil.example/abs/2401.00001", "javascript:alert(1)"]) {
    assert.throws(() => normalizeArxivId(value));
  }
});

test("paper model supplies stable identifiers, canonical safe URLs, and metadata defaults", () => {
  const paper = createPaper({ ...input, absUrl: "javascript:bad()", pdfUrl: "https://evil.example" }, now);
  assert.equal(paper.arxivId, "2401.00001");
  assert.equal(paper.title, "A paper");
  assert.equal(paper.absUrl, "https://arxiv.org/abs/2401.00001");
  assert.equal(paper.pdfUrl, "https://arxiv.org/pdf/2401.00001");
  assert.equal(paper.savedAt, now);
  assert.equal(paper.updatedAt, now);
  assert.deepEqual(paper.tags, []);
  assert.equal(paper.note, "");
  assert.equal(paper.read, false);
  assert.equal(paper.authors[1].sourceAuthorIndex, 1);
  assert.equal(paper.authors[0].sourceArxivId, paper.arxivId);
  assert.deepEqual(input.authors, ["Renée Smith", "Alex Kim"]);
});

test("paper metadata is validated and retained", () => {
  const paper = createPaper({ ...input, tags: [" ML ", "ML", ""], note: "Read section 3", read: true }, now);
  assert.deepEqual(paper.tags, ["ML"]);
  assert.equal(paper.note, "Read section 3");
  assert.equal(paper.read, true);
  for (const patch of [{ title: "" }, { authors: [] }, { tags: [3] }, { note: 7 }, { read: "yes" }]) {
    assert.throws(() => createPaper({ ...input, ...patch }, now));
  }
});

test("name normalization is explicit, Unicode aware and conservative", () => {
  assert.equal(normalizeAuthorName("  Ａlex\t KIM \n"), "alex kim");
  assert.equal(normalizeAuthorName("RENE\u0301E Smith"), "renée smith");
  assert.notEqual(normalizeAuthorName("Renée Smith"), normalizeAuthorName("Renee Smith"));
  assert.notEqual(normalizeAuthorName("A. Smith"), normalizeAuthorName("A Smith"));
});

test("canonical author identity is independent of paper, position and display formatting", () => {
  const reference = { displayName: "Alex Kim", sourceArxivId: "2401.00001", sourceAuthorIndex: 0 };
  const author = createAuthor(reference, now);
  assert.equal(author.id, createAuthorReference({ ...reference, displayName: " ALEX  KIM ", sourceArxivId: "2401.00001v2" }).id);
  assert.equal(author.id, createAuthorReference({ ...reference, sourceArxivId: "2401.00002" }).id);
  assert.equal(author.id, createAuthorReference({ ...reference, sourceAuthorIndex: 1 }).id);
  assert.equal(author.id, stableAuthorKey(" Ａlex\t  KIM \n"));
  assert.equal(author.id, "arxiv-author:name:v1:alex%20kim");
  assert.equal("sourceArxivId" in author, false);
  assert.equal("sourceAuthorIndex" in author, false);
  assert.equal(author.followedAt, now);
  assert.equal(author.updatedAt, now);
  assert.throws(() => createAuthorReference({ ...reference, sourceAuthorIndex: -1 }));
});

test("punctuation variants normalize only in the key and preserve the original display name", () => {
  const displayName = "  Anne–Marie O’Neill  ";
  const author = createAuthor({ displayName }, now);
  assert.equal(author.displayName, displayName);
  assert.equal(author.normalizedName, "anne-marie o'neill");
  assert.equal(author.id, stableAuthorKey("Anne-Marie O'Neill"));
  assert.equal(author.id, stableAuthorKey("Anne—Marie OʼNeill"));
  assert.notEqual(author.id, stableAuthorKey("Anne Marie ONeill"));
  assert.notEqual(author.id, stableAuthorKey("Alex Kim"));
});

function fakeDocument({ title, visibleTitle, names = [], visibleNames = [] }) {
  return {
    querySelector: selector => selector === "h1.title" ? { textContent: visibleTitle }
      : selector === 'meta[name="citation_title"]' && title ? { content: title } : null,
    querySelectorAll: selector => selector === ".authors a"
      ? visibleNames.map(textContent => ({ textContent }))
      : names.map(content => ({ content })),
  };
}

test("extraction prefers visible author names over reversed citation names", () => {
  const document = fakeDocument({ title: "A title", names: ["Yang, Runjia"], visibleNames: ["Runjia Yang"] });
  const paper = extractPaper(document, "https://arxiv.org/abs/2401.00001v2");
  assert.equal(paper.authors[0].displayName, "Runjia Yang");
  assert.equal(paper.arxivId, "2401.00001");
  assert.equal(paper.title, "A title");
});

test("extraction supports title and author fallbacks and rejects non-abstract pages", () => {
  const document = fakeDocument({ visibleTitle: "Title: A legacy paper", names: ["A. Author"] });
  const paper = extractPaper(document, "https://arxiv.org/abs/hep-th/9901001");
  assert.equal(paper.title, "A legacy paper");
  assert.equal(paper.authors[0].displayName, "A. Author");
  assert.throws(() => extractPaper(document, "https://arxiv.org/pdf/2401.00001"));
  assert.throws(() => extractPaper(document, "https://example.com/abs/2401.00001"));
});

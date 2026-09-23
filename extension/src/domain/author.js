import { cleanText, isoDate, normalizeArxivId } from "./identifiers.js";

/** Name normalization v1: NFKC, trim, collapse whitespace, Unicode lowercase.
 * Punctuation and diacritics are preserved. This is NOT a person identifier.
 */
export function normalizeAuthorName(name) {
  return cleanText(name, "Author name").toLowerCase();
}

/** Conservative identity: a named author occurrence on an unversioned paper.
 * Two papers with the same name intentionally produce distinct references.
 */
export function createAuthorReference({ displayName, sourceArxivId, sourceAuthorIndex }) {
  const name = cleanText(displayName, "Author name");
  const paperId = normalizeArxivId(sourceArxivId);
  if (!Number.isSafeInteger(sourceAuthorIndex) || sourceAuthorIndex < 0) {
    throw new TypeError("Author position must be a nonnegative integer.");
  }
  const normalizedName = normalizeAuthorName(name);
  return {
    id: `arxiv-author:v1:${paperId}:${sourceAuthorIndex}:${encodeURIComponent(normalizedName)}`,
    displayName: name,
    normalizedName,
    sourceArxivId: paperId,
    sourceAuthorIndex,
  };
}

export function createAuthor(input, now = new Date().toISOString()) {
  const reference = createAuthorReference(input);
  return { ...reference, followedAt: isoDate(now), updatedAt: isoDate(now) };
}

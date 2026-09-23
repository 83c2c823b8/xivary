import { cleanText, isoDate, normalizeArxivId } from "./identifiers.js";

/** Name-key normalization v1: NFKC, whitespace, apostrophe/dash variants, lowercase.
 * Accents, initials and name order remain significant. Names can still collide.
 */
export function normalizeAuthorName(name) {
  return cleanText(name, "Author name")
    .replace(/[\u2018\u2019\u02bc]/gu, "'")
    .replace(/[\u2010-\u2015\u2212]/gu, "-")
    .toLowerCase();
}

export function stableAuthorKey(name) {
  return `arxiv-author:name:v1:${encodeURIComponent(normalizeAuthorName(name))}`;
}

function authorIdentity(displayName) {
  return {
    id: stableAuthorKey(displayName),
    displayName,
    normalizedName: normalizeAuthorName(displayName),
  };
}

/** Paper provenance is metadata only; it never contributes to author identity. */
export function createAuthorReference({ displayName, sourceArxivId, sourceAuthorIndex }) {
  const paperId = normalizeArxivId(sourceArxivId);
  if (!Number.isSafeInteger(sourceAuthorIndex) || sourceAuthorIndex < 0) {
    throw new TypeError("Author position must be a nonnegative integer.");
  }
  return {
    ...authorIdentity(displayName),
    sourceArxivId: paperId,
    sourceAuthorIndex,
  };
}

export function createAuthor(input, now = new Date().toISOString()) {
  return { ...authorIdentity(input.displayName), followedAt: isoDate(now), updatedAt: isoDate(now) };
}

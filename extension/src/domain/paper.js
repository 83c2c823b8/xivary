import { cleanText, isoDate, normalizeArxivId } from "./identifiers.js";
import { createAuthorReference } from "./author.js";

export function createPaper(input, now = new Date().toISOString()) {
  const arxivId = normalizeArxivId(input.arxivId);
  if (!Array.isArray(input.authors) || input.authors.length === 0) {
    throw new TypeError("A paper must have at least one author.");
  }
  const tags = input.tags ?? [];
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== "string")) {
    throw new TypeError("Tags must be an array of strings.");
  }
  if (input.note !== undefined && typeof input.note !== "string") {
    throw new TypeError("Note must be a string.");
  }
  if (input.read !== undefined && typeof input.read !== "boolean") {
    throw new TypeError("Read must be a boolean.");
  }
  return {
    arxivId,
    title: cleanText(input.title, "Paper title"),
    authors: input.authors.map((author, sourceAuthorIndex) => createAuthorReference({
      displayName: typeof author === "string" ? author : author.displayName,
      sourceArxivId: arxivId,
      sourceAuthorIndex,
    })),
    // Derive safe, canonical links rather than persisting arbitrary page URLs.
    absUrl: `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    savedAt: isoDate(now),
    updatedAt: isoDate(now),
    tags: [...new Set(tags.map(tag => tag.trim()).filter(Boolean))],
    note: input.note ?? "",
    read: input.read ?? false,
  };
}

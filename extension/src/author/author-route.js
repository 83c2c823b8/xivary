import { normalizeAuthorName, stableAuthorKey } from "../domain/author.js";

/** Reconstruct the same name-key author view from Following or an arXiv link. */
export function resolveAuthorRoute(search, library) {
  const params = new URLSearchParams(search);
  const authorId = params.get("authorId");
  if (authorId !== null) {
    const author = library.authors.find(item => item.id === authorId);
    if (!author) throw new Error("This researcher is not in the local author library.");
    return { author, external: false };
  }
  const name = params.get("name");
  if (!name || name.length > 200 || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error("A valid researcher name is required.");
  const displayName = name.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!displayName) throw new Error("A valid researcher name is required.");
  const id = stableAuthorKey(displayName);
  return {
    author: library.authors.find(item => item.id === id) ?? { id, displayName, normalizedName: normalizeAuthorName(displayName) },
    external: true,
  };
}

export function authorResultsUrl(name, runtime) {
  resolveAuthorRoute(`?name=${encodeURIComponent(name)}`, { authors: [] });
  const url = new URL(runtime.getURL("src/author/author.html"));
  url.searchParams.set("name", name);
  return url.href;
}

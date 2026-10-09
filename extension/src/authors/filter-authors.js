import { normalizeAuthorName } from "../domain/author.js";

/** Local view filter over already-followed authors; retain input order/records. */
export function filterFollowedAuthors(authors, query) {
  if (!query.trim()) return authors;
  const name = normalizeAuthorName(query);
  return authors.filter(author => (author.normalizedName ?? normalizeAuthorName(author.displayName)).includes(name));
}

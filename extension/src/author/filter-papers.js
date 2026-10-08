import { filterPublicationDates } from "../domain/publication-date.js";
export { validateYearRange } from "../domain/publication-date.js";

export function filterAuthorPapers(papers, { query = "", range = "any", from = "", to = "" } = {}, now = new Date()) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return filterPublicationDates(papers, { range, from, to }, now).filter(paper => {
    const searchable = [
      paper.title,
      ...(paper.authors || []).map(author => typeof author === "string" ? author : author.displayName),
      paper.abstract,
      ...(paper.categories || []),
    ].filter(Boolean).join(" ").toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  });
}

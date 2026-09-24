export function filterAuthorPapers(papers, { query = "", range = "any", from = "", to = "" } = {}, now = new Date()) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const { start, end } = dateBounds(range, from, to, now);
  return papers.filter(paper => {
    const searchable = [
      paper.title,
      ...(paper.authors || []).map(author => typeof author === "string" ? author : author.displayName),
      paper.abstract,
      ...(paper.categories || []),
    ].filter(Boolean).join(" ").toLocaleLowerCase();
    if (!terms.every(term => searchable.includes(term))) return false;
    const published = Date.parse(paper.publishedAt);
    return (!start || published >= start) && (!end || published <= end);
  });
}

function dateBounds(range, from, to, now) {
  if (range === "year" || range === "three-years") {
    const start = new Date(now);
    start.setFullYear(start.getFullYear() - (range === "year" ? 1 : 3));
    return { start: start.getTime(), end: 0 };
  }
  if (range === "custom") {
    return {
      start: from ? Date.parse(`${from}T00:00:00`) : 0,
      end: to ? Date.parse(`${to}T23:59:59.999`) : 0,
    };
  }
  return { start: 0, end: 0 };
}

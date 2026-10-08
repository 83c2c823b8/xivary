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
    return (start === null || published >= start) && (end === null || published < end);
  });
}

function dateBounds(range, from, to, now) {
  if (range === "year" || range === "three-years") {
    const start = new Date(now);
    start.setFullYear(start.getFullYear() - (range === "year" ? 1 : 3));
    return { start: start.getTime(), end: null };
  }
  if (range === "custom") {
    const error = validateYearRange(from, to);
    if (error) throw new RangeError(error);
    return {
      start: from ? new Date(Number(from), 0, 1).getTime() : null,
      end: to ? new Date(Number(to) + 1, 0, 1).getTime() : null,
    };
  }
  return { start: null, end: null };
}

export function validateYearRange(from, to) {
  if ([from, to].some(year => year && (!/^\d{4}$/.test(year) || Number(year) < 1000 || Number(year) > 9999))) return 'Enter four-digit years from 1000 to 9999, or leave an endpoint blank.';
  if (from && to && Number(from) > Number(to)) return 'From year must not be later than To year.';
  return '';
}

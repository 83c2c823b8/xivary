/** Pure adapter for arXiv's advanced HTML search form. AND binds before OR.
 * Distribute alternatives over categories so every OR branch stays in-field:
 * (term1 AND cat1) OR (term1 AND cat2) OR (term2 AND cat1) ...
 * Parenthesized API syntax must NOT be pasted into the HTML search box.
 */
export function buildArxivSearchUrl(plan) {
  const url = new URL("https://arxiv.org/search/advanced");
  const params = url.searchParams;
  params.set("advanced", "1");
  let index = 0;
  function row(term, operator) {
    params.set(`terms-${index}-operator`, operator);
    params.set(`terms-${index}-term`, term);
    params.set(`terms-${index}-field`, "all");
    index++;
  }
  for (const term of plan.terms) {
    for (const category of plan.categories.length ? plan.categories : [null]) {
      row(term, index ? "OR" : "AND");
      if (category) row(category, "AND");
    }
  }
  params.set("classification-include_cross_list", "include");
  params.set("date-filter_by", "all_dates");
  params.set("date-date_type", "submitted_date");
  params.set("abstracts", "show");
  params.set("size", "50");
  params.set("order", ""); // arXiv's native relevance order
  return url.href;
}

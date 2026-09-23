import { FIELD_PRESETS } from "./field-presets.js";

export const SEARCH_MODES = ["exact", "balanced", "broad"];

/** Pure, deterministic query plan, suitable for any client. User text remains
 * the first alternative. Only recognized phrases are substituted, so unrelated
 * words in the user's query are retained in every expanded alternative.
 */
export function expandQuery({ query, fieldId = "all", mode = "balanced" }) {
  if (typeof query !== "string") throw new TypeError("Enter a search query.");
  const text = query.trim();
  if (!text) throw new Error("Enter a search query.");
  if (text.length > 200) throw new Error("Use at most 200 characters for a search.");
  const field = FIELD_PRESETS.find(item => item.id === fieldId);
  if (!field || !SEARCH_MODES.includes(mode)) throw new Error("Unknown search field or mode.");
  const terms = [text];
  const seen = new Set([text.toLowerCase()]);
  const rules = (fieldId === "all" ? FIELD_PRESETS : [field]).flatMap(item => item.rules);
  const limit = mode === "exact" ? 0 : mode === "balanced" ? 2 : 4;
  for (const rule of rules) {
    if (terms.length > limit) break;
    // Prefer the longest matching phrase (e.g. "mirror symmetry" over "mirror").
    const matches = [...rule.match].sort((a, b) => b.length - a.length);
    let match;
    for (const phrase of matches) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      match = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, "iu").exec(text);
      if (match) break;
    }
    if (!match) continue;
    const alternatives = mode === "broad" ? [...rule.balanced, ...rule.broad] : rule.balanced;
    for (const replacement of alternatives) {
      if (terms.length > limit) break;
      const offset = match.index + match[1].length;
      const expanded = text.slice(0, offset) + replacement + text.slice(offset + match[2].length);
      if (!seen.has(expanded.toLowerCase())) { seen.add(expanded.toLowerCase()); terms.push(expanded); }
    }
  }
  const categories = [...(mode === "broad" ? field.broadCategories : field.arxivCategories)];
  const alternatives = terms.map(term => `ALL(${JSON.stringify(term)})`).join(" OR ");
  const categoryFilter = categories.map(category => `CATEGORY(${category})`).join(" OR ");
  return {
    version: 1, query: text, fieldId, mode, terms, categories,
    expandedQuery: `(${alternatives})${categories.length ? ` AND (${categoryFilter})` : ""}`,
  };
}

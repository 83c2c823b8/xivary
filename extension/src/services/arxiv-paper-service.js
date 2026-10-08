import { normalizeArxivId } from "../domain/identifiers.js";
import { normalizeAuthorName } from "../domain/author.js";

export const AUTHOR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function buildAuthorQuery(author) {
  if (!author || typeof author.displayName !== "string" || !author.displayName.trim()) {
    throw new TypeError("An author name is required.");
  }
  return `au:\"${author.displayName.trim().replaceAll('"', '\\"')}\"`;
}

export function buildApiQuery(plan) {
  const terms = plan.terms.map(term => `all:\"${term.replaceAll('"', '\\"')}\"`);
  const text = terms.length === 1 ? terms[0] : `(${terms.join(" OR ")})`;
  if (!plan.categories.length) return text;
  const categories = plan.categories.map(category => `cat:${category}`).join(" OR ");
  return `${text} AND (${categories})`;
}

export function buildArxivApiUrl(searchQuery, maxResults = 50) {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", searchQuery);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");
  return url.href;
}

export function normalizeApiEntry(entry) {
  const arxivId = normalizeArxivId(entry.arxivId ?? entry.id);
  const authors = entry.authors.map(author => author.trim()).filter(Boolean);
  if (!authors.length) throw new Error("arXiv result has no authors.");
  return {
    arxivId,
    title: entry.title.replace(/\s+/gu, " ").trim(),
    authors,
    abstract: entry.abstract.replace(/\s+/gu, " ").trim(),
    publishedAt: new Date(entry.publishedAt).toISOString(),
    categories: [...new Set(entry.categories)],
    absUrl: `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
  };
}

export function normalizeCachedAuthorResults({ authorId, papers, fetchedAt, queryUsed }) {
  if (typeof authorId !== "string" || !Array.isArray(papers) || Number.isNaN(Date.parse(fetchedAt))
      || typeof queryUsed !== "string") throw new Error("Invalid author paper cache.");
  return {
    authorId, fetchedAt: new Date(fetchedAt).toISOString(), queryUsed,
    papers: papers.map(normalizeApiEntry),
  };
}

export function isAuthorCacheFresh(cache, now = Date.now(), ttlMs = AUTHOR_CACHE_TTL_MS) {
  return Boolean(cache) && Number.isFinite(ttlMs) && ttlMs >= 0
    && now - Date.parse(cache.fetchedAt) < ttlMs;
}

/** Require one returned author to match the followed full name. This prevents a
 * query result from passing when given and family names occur on different people.
 * Name-key matching still cannot distinguish two people with the same full name.
 */
export function paperMatchesAuthor(paper, author) {
  if (!paper || !Array.isArray(paper.authors) || !author) return false;
  const target = normalizeAuthorName(author.displayName);
  return paper.authors.some(item => normalizeAuthorName(typeof item === "string" ? item : item.displayName) === target);
}

export async function fetchArxivPapers(searchQuery, fetchImpl = fetch) {
  const response = await fetchImpl(buildArxivApiUrl(searchQuery), { headers: { Accept: "application/atom+xml" } });
  if (!response.ok) throw new Error(`arXiv returned ${response.status}.`);
  const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
  if (xml.documentElement?.localName !== "feed" || xml.documentElement?.namespaceURI !== "http://www.w3.org/2005/Atom") throw new Error("arXiv returned an unexpected response.");
  if (xml.querySelector("parsererror")) throw new Error("arXiv returned an unreadable response.");
  return [...xml.querySelectorAll("entry")].map(entry => normalizeApiEntry({
    id: entry.querySelector("id")?.textContent || "",
    title: entry.querySelector("title")?.textContent || "",
    abstract: entry.querySelector("summary")?.textContent || "",
    publishedAt: entry.querySelector("published")?.textContent || "",
    authors: [...entry.querySelectorAll("author > name")].map(node => node.textContent || ""),
    categories: [...entry.querySelectorAll("category")].map(node => node.getAttribute("term") || "").filter(Boolean),
  }));
}

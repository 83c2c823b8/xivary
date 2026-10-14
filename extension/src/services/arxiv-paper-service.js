import { normalizeArxivId } from "../domain/identifiers.js";
import { normalizeAuthorName } from "../domain/author.js";
import { requestArxiv } from './arxiv-client.js';

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

export function buildArxivApiUrl(searchQuery, maxResults = 50, start = 0) {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", searchQuery);
  url.searchParams.set("start", String(start));
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");
  return url.href;
}

export function normalizeApiEntry(entry) {
  const arxivId = normalizeArxivId(entry.arxivId ?? entry.id);
  const versionInput = entry.versionedId ?? entry.id ?? entry.arxivId;
  const version = String(versionInput).match(/v([1-9]\d*)$/u)?.[1];
  if (version && (!Number.isSafeInteger(Number(version)) || normalizeArxivId(versionInput) !== arxivId)) throw new Error('Invalid arXiv result version.');
  const authors = entry.authors.map(author => author.trim()).filter(Boolean);
  if (!authors.length) throw new Error("arXiv result has no authors.");
  return {
    arxivId,
    ...(version ? { versionedId: `${arxivId}v${version}` } : {}),
    title: entry.title.replace(/\s+/gu, " ").trim(),
    authors,
    abstract: entry.abstract.trim(),
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

function parseAtom(text) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.documentElement?.localName !== "feed" || xml.documentElement?.namespaceURI !== "http://www.w3.org/2005/Atom") throw new Error("arXiv returned an unexpected response.");
  if (xml.querySelector("parsererror")) throw new Error("arXiv returned an unreadable response.");
  return xml;
}

export function parseArxivPapers(text) {
  return papersFromAtom(parseAtom(text));
}

export function parseArxivPage(text, start = 0) {
  const xml = parseAtom(text);
  const number = name => {
    const node = xml.getElementsByTagNameNS('http://a9.com/-/spec/opensearch/1.1/', name)[0];
    if (!node || !/^\d+$/u.test(node.textContent.trim())) throw new Error('arXiv returned invalid pagination metadata.');
    const value = Number(node.textContent.trim());
    if (!Number.isSafeInteger(value)) throw new Error('arXiv returned invalid pagination metadata.');
    return value;
  };
  const total = number('totalResults'), returnedStart = number('startIndex');
  const count = xml.querySelectorAll('entry').length;
  if (returnedStart !== start || count > 50 || (count && start + count > total)
      || (count < 50 && total > start + count)) throw new Error('arXiv returned inconsistent pagination metadata.');
  return { papers: papersFromAtom(xml, true), count, total };
}

function papersFromAtom(xml, preferLatest = false) {
  const unique = new Map();
  for (const entry of xml.querySelectorAll("entry")) {
    const paper = normalizeApiEntry({
    id: entry.querySelector("id")?.textContent || "",
    title: entry.querySelector("title")?.textContent || "",
    abstract: entry.querySelector("summary")?.textContent || "",
    publishedAt: entry.querySelector("published")?.textContent || "",
    authors: [...entry.querySelectorAll("author > name")].map(node => node.textContent || ""),
    categories: [...entry.querySelectorAll("category")].map(node => node.getAttribute("term") || "").filter(Boolean),
    });
    const previous = unique.get(paper.arxivId);
    const version = value => Number(value?.versionedId?.match(/v(\d+)$/u)?.[1] || 0);
    if (!previous || (preferLatest && version(paper) > version(previous))) unique.set(paper.arxivId, paper);
  }
  return [...unique.values()];
}

/** Parse only fully closed entries; final whole-feed validation remains required.
 * Full text is retained for validation, never persisted as an incomplete cache.
 */
export function progressiveAtom(onBatch, parse = parseArxivPapers) {
  let text = '', emitted = 0;
  return chunk => {
    text += chunk;
    // XML CDATA/comments may contain literal closing-entry text. Only a prefix
    // which is itself a well-formed Atom feed may produce provisional rows.
    const end = text.lastIndexOf('</entry>');
    if (end < 0) return;
    let papers;
    try { papers = parse(text.slice(0, end + 8) + '</feed>'); } catch { return; }
    if (papers.length > emitted) { emitted = papers.length; onBatch(papers); }
  };
}

export async function fetchArxivPapers(searchQuery, options = {}) {
  // Explicit injected transport is retained for parser/HTTP unit tests only.
  if (typeof options === 'function') {
    const response = await options(buildArxivApiUrl(searchQuery), { headers: { Accept: 'application/atom+xml' } });
    if (!response.ok) throw new Error(`arXiv returned ${response.status}.`);
    return parseArxivPapers(await response.text());
  }
  const progress = progressiveAtom(papers => options.onBatch?.(papers));
  const text = await requestArxiv(searchQuery, { signal: options.signal, onEvent: event => {
    if (event.type === 'chunk') progress(event.text);
    else options.onStatus?.(event);
  } });
  return parseArxivPapers(text);
}

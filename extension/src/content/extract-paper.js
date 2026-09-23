import { createPaper } from "../domain/paper.js";

/** Read citation metadata, with visible DOM fallbacks. Links are canonicalized. */
export function extractPaper(document, pageUrl) {
  const url = new URL(pageUrl);
  if (url.origin !== "https://arxiv.org" || !url.pathname.startsWith("/abs/")) {
    throw new Error("This is not an arXiv abstract page.");
  }
  const meta = name => document.querySelector(`meta[name="${name}"]`)?.content;
  const heading = document.querySelector("h1.title");
  const title = meta("citation_title") || heading?.textContent.replace(/^\s*Title:\s*/i, "");
  // Citation names may be "Surname, Given" while visible names are "Given Surname".
  // Prefer visible author text so buttons and stored display names agree.
  const authorNames = [...document.querySelectorAll(".authors a")]
    .map(element => element.textContent).filter(name => name.trim());
  const authors = authorNames.length ? authorNames
    : [...document.querySelectorAll('meta[name="citation_author"]')].map(element => element.content);
  const category = document.querySelector(".primary-subject")?.textContent?.match(/\(([^)]+)\)/)?.[1];
  const publishedAt = meta("citation_date");
  return createPaper({
    arxivId: url.pathname.slice(5), title, authors,
    categories: category ? [category] : [],
    abstract: meta("citation_abstract") || "",
    publishedAt: publishedAt ? new Date(publishedAt).toISOString() : undefined,
  });
}

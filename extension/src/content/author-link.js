import { stableAuthorKey } from "../domain/author.js";

/** Known abstract and standard search-result author-search anchors only. */
export function authorFromArxivLink(link, pageUrl) {
  if (!link?.matches?.(".authors a[href]")) return null;
  try {
    const page = new URL(pageUrl);
    const destination = new URL(link.getAttribute("href"), page);
    const supported = page.pathname.startsWith("/abs/") || (/^\/search\/(?:[^/]+)?\/?$/.test(page.pathname)
      && link.matches("li.arxiv-result p.authors a[href]")
      && link.closest("p.authors")?.querySelector("span")?.textContent.trim() === "Authors:");
    if (page.origin !== "https://arxiv.org" || !supported
        || destination.origin !== page.origin || !/^\/search\/(?:[^/]+)?\/?$/.test(destination.pathname)
        || destination.searchParams.get("searchtype") !== "author"
        || !destination.searchParams.get("query") || destination.searchParams.has("id")) return null;
    const name = link.textContent?.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (!name || name.length > 200 || /[\u0000-\u001f\u007f]/u.test(name)) return null;
    return { name, authorId: stableAuthorKey(name) };
  } catch { return null; }
}

export function shouldOpenAuthorInXivary(event) {
  return event.type === "click" && !event.defaultPrevented && event.button === 0
    && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

export const authorFromAbstractLink = authorFromArxivLink;

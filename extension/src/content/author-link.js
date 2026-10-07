import { stableAuthorKey } from "../domain/author.js";

/** Only abstract-page author anchors with arXiv's author-search destination. */
export function authorFromAbstractLink(link, pageUrl) {
  if (!link?.matches?.(".authors a[href]")) return null;
  try {
    const page = new URL(pageUrl);
    const destination = new URL(link.getAttribute("href"), page);
    if (page.origin !== "https://arxiv.org" || !page.pathname.startsWith("/abs/")
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

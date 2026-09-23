/** The unversioned arXiv identifier is the paper's primary key. */
export function normalizeArxivId(value) {
  if (typeof value !== "string") throw new TypeError("An arXiv ID is required.");
  let id = value.trim().replace(/^arxiv:\s*/i, "");
  if (/^https?:\/\//i.test(id)) {
    const url = new URL(id);
    if (url.hostname !== "arxiv.org" || !/^\/(abs|pdf)\//.test(url.pathname)) {
      throw new TypeError("Expected an arxiv.org abstract or PDF URL.");
    }
    id = url.pathname.replace(/^\/(abs|pdf)\//, "").replace(/\.pdf$/, "");
  }
  id = id.replace(/v[1-9]\d*$/, "");
  if (!/^(?:\d{4}\.\d{4,5}|[a-z][a-z.\-]*\/\d{7})$/i.test(id)) {
    throw new TypeError("Invalid arXiv ID.");
  }
  return id;
}

export function cleanText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} is required.`);
  }
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function isoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Invalid timestamp.");
  return date.toISOString();
}

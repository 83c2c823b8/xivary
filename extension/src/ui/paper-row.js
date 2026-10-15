export function createBookmarkButton({ saved, title, onToggle }) {
  const button = document.createElement("button"); button.type = "button"; button.className = "bookmark";
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.75 3.75h10.5v16.5L12 16.5l-5.25 3.75V3.75Z"/></svg>';
  setBookmarkState(button, saved, title); button.addEventListener("click", () => void onToggle(button)); return button;
}
export function setBookmarkState(button, saved, title) { button.setAttribute("aria-pressed", String(saved)); button.setAttribute("aria-label", `${saved ? "Manage collections for" : "Save paper"}: ${title}`); button.title = saved ? "Manage collections" : "Save paper"; if(saved){button.setAttribute("aria-haspopup","dialog");if(!button.hasAttribute("aria-expanded"))button.setAttribute("aria-expanded","false")}else{button.removeAttribute("aria-haspopup");button.removeAttribute("aria-expanded")} }
export function paperRow(paper, { repository, onOfflineChange, offlineLinks, allowOfflineExport = false, saved = false, onToggle, showAbstract = true, openArxivLinksInNewTab = false, datePrefix = "", dateTimeZone, renderAbstract = createAbstractRenderer() } = {}) {
  const row = document.createElement("li"); row.className = "paper-row"; const heading = document.createElement("h2");
  const title = link(paper.title, offlineLinks || paper.absUrl, offlineLinks ? true : openArxivLinksInNewTab, Boolean(offlineLinks)); heading.append(title); row.append(heading);
  const authors = (paper.authors || []).map(author => typeof author === "string" ? author : author.displayName).join(", "); row.append(paragraph(authors,"metadata"));
  row.append(paperMetadata(paper, { datePrefix, dateTimeZone }));
  if (showAbstract && paper.abstract) row.append(renderAbstract(paper.abstract));
  const actions = document.createElement("div"); actions.className = "actions"; actions.append(link("PDF",offlineLinks || paper.pdfUrl,offlineLinks ? true : openArxivLinksInNewTab, Boolean(offlineLinks)));
  if (onToggle) actions.append(createBookmarkButton({saved,title:paper.title,onToggle})); if (repository) actions.append(offlineAction(paper, repository, { onChange: onOfflineChange, allowExport: allowOfflineExport })); row.append(actions); return row;
}
export function arxivIdText(value) {
  try { return `arXiv:${normalizeArxivId(value)}`; }
  catch { return ""; } // Missing or malformed identity is omitted, never guessed.
}
export function paperMetadata(paper, { datePrefix = "", dateTimeZone } = {}) {
  const metadata = paragraph("", "metadata");
  const date = paper.publishedAt ? new Date(paper.publishedAt).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric", ...(dateTimeZone ? { timeZone: dateTimeZone } : {}),
  }) : "";
  const label = arxivIdText(paper.arxivId);
  const identifier = label ? document.createElement("span") : null;
  if (identifier) { identifier.className = "arxiv-id"; identifier.textContent = label; }
  const parts = [date ? `${datePrefix}${date}` : "", identifier, ...(paper.categories || [])].filter(Boolean);
  parts.forEach((part, index) => { if (index) metadata.append(" · "); metadata.append(part); });
  return metadata;
}
function paragraph(text,className){const p=document.createElement("p");p.textContent=text;p.className=className;return p}
function link(label,href,openInNewTab,local=false){const a=document.createElement("a");a.textContent=label;a.href=href;if(local){a.rel="noopener";a.target="_blank";return a}return configureArxivLink(a,openInNewTab)}
import { configureArxivLink } from "./arxiv-link.js";
import { createAbstractRenderer } from "./abstract.js";
import { normalizeArxivId } from "../domain/identifiers.js";

import { offlineAction } from "./offline-action.js";

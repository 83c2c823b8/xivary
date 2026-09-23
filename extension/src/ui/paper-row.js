export function createBookmarkButton({ saved, title, onToggle }) {
  const button = document.createElement("button"); button.type = "button"; button.className = "bookmark";
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.75 3.75h10.5v16.5L12 16.5l-5.25 3.75V3.75Z"/></svg>';
  setBookmarkState(button, saved, title); button.addEventListener("click", () => void onToggle(button)); return button;
}
export function setBookmarkState(button, saved, title) { button.setAttribute("aria-pressed", String(saved)); button.setAttribute("aria-label", `${saved ? "Saved" : "Save paper"}: ${title}`); button.title = saved ? "Saved" : "Save paper"; }
export function paperRow(paper, { saved = false, onToggle, showAbstract = true } = {}) {
  const row = document.createElement("li"); row.className = "paper-row"; const heading = document.createElement("h2");
  const title = link(paper.title, paper.absUrl); heading.append(title); row.append(heading);
  const authors = (paper.authors || []).map(author => typeof author === "string" ? author : author.displayName).join(", "); row.append(paragraph(authors,"metadata"));
  const date = paper.publishedAt ? new Date(paper.publishedAt).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}) : "";
  row.append(paragraph([date,...(paper.categories || [])].filter(Boolean).join(" · "),"metadata"));
  if (showAbstract && paper.abstract) row.append(paragraph(paper.abstract,"abstract"));
  const actions = document.createElement("div"); actions.className = "actions"; actions.append(link("abstract",paper.absUrl),link("PDF",paper.pdfUrl));
  if (onToggle) actions.append(createBookmarkButton({saved,title:paper.title,onToggle})); row.append(actions); return row;
}
function paragraph(text,className){const p=document.createElement("p");p.textContent=text;p.className=className;return p}
function link(label,href){const a=document.createElement("a");a.textContent=label;a.href=href;a.target="_blank";a.rel="noopener";return a}

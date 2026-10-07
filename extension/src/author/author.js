import { RepositoryClient } from "../repository/repository-client.js";
import { buildAuthorQuery, fetchArxivPapers, isAuthorCacheFresh, paperMatchesAuthor } from "../services/arxiv-paper-service.js";
import { paperRow, setBookmarkState } from "../ui/paper-row.js";
import { openPaperCollectionPicker } from "../ui/paper-collection-picker.js";
import { configureArxivLink } from "../ui/arxiv-link.js";
import { filterAuthorPapers } from "./filter-papers.js";
import { resolveAuthorRoute } from "./author-route.js";

const repository = new RepositoryClient();
const element = id => document.getElementById(id);
let author;
let savedIds = new Set();
let query;
let openArxivLinksInNewTab = false;
let loadedPapers = [];
let loadedAt = "";
let localStateRevision = 0;

element("refresh").addEventListener("click", () => void refresh(true));
element("show-filters").addEventListener("click", openFilters);
element("paper-query").addEventListener("input", renderFiltered);
element("date-range").addEventListener("change", () => {
  element("custom-dates").hidden = element("date-range").value !== "custom";
  renderFiltered();
});
element("date-from").addEventListener("input", renderFiltered);
element("date-to").addEventListener("input", renderFiltered);
document.addEventListener("keydown", event => {
  if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditing(event.target)) {
    event.preventDefault();
    openFilters();
  } else if (event.key === "Escape" && !element("filters").hidden) {
    event.preventDefault();
    closeFilters();
  }
});
void init();
window.addEventListener("focus", () => void refreshLocalState());

async function refreshLocalState() {
  if (!author) return;
  const revision = localStateRevision;
  try {
    const [papers, preferences] = await Promise.all([repository.listFavorites(), repository.getPreferences()]);
    if (revision !== localStateRevision) return;
    savedIds = new Set(papers.map(p => p.arxivId));
    openArxivLinksInNewTab = preferences.openArxivLinksInNewTab;
    configureArxivLink(element("open-search"), openArxivLinksInNewTab);
    renderFiltered();
  } catch (error) { setStatus(error.message, true); }
}

async function init() {
  try {
    const library = await repository.getAuthorLibrary();
    const route = resolveAuthorRoute(location.search, library);
    author = route.author;
    query = buildAuthorQuery(author);
    element("name").textContent = author.displayName;
    element("identity").textContent = "Matched by author name; namesakes may share results.";
    document.title = `${author.displayName} — Xivary`;
    openArxivLinksInNewTab = library.settings.openArxivLinksInNewTab;
    element("open-search").href = `https://arxiv.org/search/?query=${encodeURIComponent(author.displayName)}&searchtype=author`;
    configureArxivLink(element("open-search"), openArxivLinksInNewTab);
    savedIds = new Set((await repository.listFavorites()).map(paper => paper.arxivId));
    const cache = await repository.getAuthorPaperCache(author.id);
    if (cache) {
      render(cache.papers, cache.fetchedAt);
      if (!isAuthorCacheFresh(cache)) void refresh(false);
    } else await refresh(false);
  } catch (error) {
    setStatus(error.message, true);
    element("refresh").disabled = true;
    element("open-search").removeAttribute("href");
    element("open-search").setAttribute("aria-disabled", "true");
    element("show-filters").disabled = true;
  }
}

async function refresh(manual) {
  element("refresh").disabled = true;
  setStatus(manual ? "Refreshing from arXiv…" : "Loading papers from arXiv…");
  try {
    const papers = await fetchArxivPapers(query);
    const cache = await repository.putAuthorPaperCache({ authorId: author.id, papers, fetchedAt: new Date().toISOString(), queryUsed: query });
    savedIds = new Set((await repository.listFavorites()).map(paper => paper.arxivId));
    render(cache.papers, cache.fetchedAt);
    setStatus("");
  } catch (error) { setStatus(`Could not refresh: ${error.message}`, true); }
  finally { element("refresh").disabled = false; }
}

function render(papers, fetchedAt) {
  loadedPapers = papers.filter(paper => paperMatchesAuthor(paper, author));
  loadedAt = fetchedAt;
  renderFiltered();
}

function renderFiltered() {
  const filters = {
    query: element("paper-query").value,
    range: element("date-range").value,
    from: element("date-from").value,
    to: element("date-to").value,
  };
  const active = Boolean(filters.query.trim()) || filters.range !== "any";
  const papers = filterAuthorPapers(loadedPapers, filters);
  element("updated").textContent = loadedAt ? `Updated ${new Date(loadedAt).toLocaleString()}` : "";
  element("filter-count").textContent = active ? `${papers.length} ${papers.length === 1 ? "paper" : "papers"}` : "";
  const groups = new Map();
  for (const paper of papers) {
    const year = new Date(paper.publishedAt).getFullYear();
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(paper);
  }
  const fragment = document.createDocumentFragment();
  for (const [year, items] of groups) {
    const section = document.createElement("section");
    section.className = "year-group";
    const heading = document.createElement("h2");
    heading.className = "year";
    heading.id = `year-${year}`;
    heading.textContent = year;
    section.setAttribute("aria-labelledby", heading.id);
    const list = document.createElement("ul");
    list.className = "year-list";
    list.append(...items.map(paper => paperRow(paper, {
      saved: savedIds.has(paper.arxivId),
      onToggle: button => save(paper, button),
      openArxivLinksInNewTab,
    })));
    section.append(heading, list);
    fragment.append(section);
  }
  element("papers").replaceChildren(fragment);
  element("empty").textContent = active ? "No matching papers." : "No papers were returned for this author name.";
  element("empty").hidden = papers.length > 0;
}

async function save(paper, button) {
  if (savedIds.has(paper.arxivId)) {
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    await openPaperCollectionPicker({ repository, paper, anchor: button, onChange: () => syncBookmark(paper, button) });
    return;
  }
  button.disabled = true;
  localStateRevision++;
  try {
    await repository.savePaper(paper);
    localStateRevision++;
    savedIds.add(paper.arxivId);
    setBookmarkState(button, true, paper.title);
    setStatus("Paper saved.");
  } catch (error) { setStatus(error.message, true); }
  finally { button.disabled = false; }
}

async function syncBookmark(paper, button) {
  localStateRevision++;
  savedIds = new Set((await repository.listFavorites()).map(item => item.arxivId));
  localStateRevision++;
  setBookmarkState(button, savedIds.has(paper.arxivId), paper.title);
  setStatus(savedIds.has(paper.arxivId) ? "Paper collections updated." : "Paper removed from the library.");
}

function openFilters() {
  element("filters").hidden = false;
  element("show-filters").setAttribute("aria-expanded", "true");
  element("paper-query").focus();
}

function closeFilters() {
  element("filters").hidden = true;
  element("show-filters").setAttribute("aria-expanded", "false");
  element("paper-query").value = "";
  element("date-range").value = "any";
  element("date-from").value = "";
  element("date-to").value = "";
  element("custom-dates").hidden = true;
  renderFiltered();
  element("show-filters").focus();
}

function isEditing(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement || target?.isContentEditable;
}

function setStatus(message, error = false) {
  element("status").textContent = message;
  element("status").classList.toggle("error", error);
}

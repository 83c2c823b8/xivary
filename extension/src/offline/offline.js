import { RepositoryClient } from "../repository/repository-client.js";
import { paperRow } from "../ui/paper-row.js";
import { publicationTimeFilter } from "../ui/publication-time-filter.js";
import { filterPublicationDates } from "../domain/publication-date.js";
import { openPaperCollectionPicker } from "../ui/paper-collection-picker.js";
import { bindVimMode } from "../ui/vim-mode.js";

const repository = new RepositoryClient();
bindVimMode(repository);
const element = id => document.getElementById(id);
let offline, library, revision = 0;
const rows = new Map();
const timeFilter = publicationTimeFilter(render);
element("filter").addEventListener("input", render);
element("clear-filter").addEventListener("click", () => { element("filter").value = ""; render(); element("filter").focus(); });
const unsubscribe = repository.subscribeOffline(() => { void load(); });
window.addEventListener("focus", load);
window.addEventListener("pagehide", event => { if (!event.persisted) unsubscribe(); });
void load();

async function load() {
  const current = ++revision;
  try {
    const [copies, bookmarks] = await Promise.all([repository.getOfflineLibrary(), repository.getPaperLibrary()]);
    if (current !== revision) return;
    offline = copies; library = bookmarks; render(); element("status").textContent = ""; element("status").classList.remove("error");
  } catch (error) { if (current === revision) { element("status").textContent = error.message; element("status").classList.add("error"); } }
}

function render() {
  if (!offline) return;
  const query = element("filter").value.trim().toLowerCase(), date = timeFilter.values();
  const bookmarked = new Map(library.papers.map(paper => [paper.arxivId, paper]));
  const papers = offline.copies.map(copy => bookmarked.get(copy.arxivId) || copy.paper);
  const visible = filterPublicationDates(papers.filter(paper => [paper.title, ...paper.authors.map(author => author.displayName), ...paper.categories].join(" ").toLowerCase().includes(query)), date);
  const nodes = visible.map(paper => {
    const saved = bookmarked.has(paper.arxivId), signature = JSON.stringify([paper, saved]);
    let cached = rows.get(paper.arxivId);
    if (cached?.signature !== signature) {
      cached = { signature, node: paperRow(paper, {
        repository, saved, showAbstract: false, allowOfflineExport: true, onOfflineChange: load,
        offlineLinks: `read.html?id=${encodeURIComponent(paper.arxivId)}`,
        onToggle: async button => {
          try {
            if (saved) await openPaperCollectionPicker({ repository, paper, anchor: button, onChange: load });
            else { await repository.savePaper(paper); await load(); }
          } catch (error) { element("status").textContent = error.message; }
        },
      }) };
      rows.set(paper.arxivId, cached);
    }
    return cached.node;
  });
  const existing = [...element("papers").children];
  if (nodes.length !== existing.length || nodes.some((node, i) => node !== existing[i])) element("papers").replaceChildren(...nodes);
  const live = new Set(papers.map(paper => paper.arxivId));
  for (const id of rows.keys()) if (!live.has(id)) rows.delete(id);
  const count = visible.length === papers.length ? `${papers.length} ${papers.length === 1 ? "paper" : "papers"}` : `${visible.length} of ${papers.length} papers`;
  element("count").textContent = `${count} · ${(offline.size / 1048576).toFixed(1)} MB`;
  element("count").title = `${offline.size.toLocaleString()} PDF bytes${offline.localUsage === null ? "" : `; ${offline.localUsage.toLocaleString()} bytes of local storage (estimated)`}`;
  element("empty").hidden = visible.length > 0;
  element("empty").textContent = query || date.range !== "any" ? "No matching papers." : "No offline papers.";
  element("clear-filter").hidden = !query || visible.length > 0;
}

import { createAbstractRenderer } from "../ui/abstract.js";
import { RepositoryClient } from "../repository/repository-client.js";
import { FIELD_PRESETS } from "./field-presets.js";import { expandQuery } from "./expand-query.js";import { buildArxivSearchUrl } from "./arxiv-search-url.js";
import { buildApiQuery, fetchArxivPapers } from "../services/arxiv-paper-service.js";import { paperRow, setBookmarkState } from "../ui/paper-row.js";
import { openPaperCollectionPicker } from "../ui/paper-collection-picker.js";
import { configureArxivLink } from "../ui/arxiv-link.js";
const repository=new RepositoryClient();const element=id=>document.getElementById(id);let searchController;let searchRevision=0;window.addEventListener("pagehide",()=>{searchRevision++;searchController?.abort()});let currentPlan;let loadedPapers=[];let renderAbstract=createAbstractRenderer();let mathSignature;let savedIds=new Set();let openArxivLinksInNewTab=false;for(const field of FIELD_PRESETS)element("field").append(new Option(field.name,field.id));
element("search-form").addEventListener("input",preview);element("search-form").addEventListener("submit",event=>{event.preventDefault();void search()});void loadSaved();
function planFromForm(){return expandQuery({query:element("query").value,fieldId:element("field").value,mode:document.querySelector('input[name="mode"]:checked').value})}function preview(){searchRevision++;searchController?.abort();try{currentPlan=planFromForm();element("preview").textContent=currentPlan.expandedQuery;element("native-search").href=buildArxivSearchUrl(currentPlan);setStatus("")}catch(error){element("preview").textContent=error.message}}
async function loadSaved(){const [papers,preferences]=await Promise.all([repository.listFavorites(),repository.getPreferences()]);savedIds=new Set(papers.map(p=>p.arxivId));openArxivLinksInNewTab=preferences.openArxivLinksInNewTab;const signature=JSON.stringify([preferences.renderLatexInAbstracts,preferences.customLatexMacros]);if(signature!==mathSignature){mathSignature=signature;renderAbstract=createAbstractRenderer(preferences);renderResults()}configureArxivLink(element("native-search"),openArxivLinksInNewTab)}
async function search(){
  searchController?.abort();const controller=new AbortController();searchController=controller;const revision=++searchRevision;
  const current=()=>revision===searchRevision&&!controller.signal.aborted;
  try{
    currentPlan=planFromForm();element("preview").textContent=currentPlan.expandedQuery;element("native-search").href=buildArxivSearchUrl(currentPlan);
    setStatus("Searching arXiv…");await loadSaved();if(!current())return;
    const papers=await fetchArxivPapers(buildApiQuery(currentPlan),{signal:controller.signal,onStatus:event=>{
      if(current()&&event.type==='waiting')setStatus('Waiting for arXiv'+(event.retry?' rate limit; retrying':'')+'…');
    }});
    if(!current())return;loadedPapers=papers;renderResults();element("empty").hidden=papers.length>0;setStatus("");
  }catch(error){if(current())setStatus(`Direct results unavailable: ${error.message} Use “Open on arXiv” to view the same search.`,true)}
}
async function toggle(paper,button){if(savedIds.has(paper.arxivId)){button.setAttribute("aria-haspopup","dialog");button.setAttribute("aria-expanded","false");await openPaperCollectionPicker({repository,paper,anchor:button,onChange:()=>syncBookmark(paper,button)});return}button.disabled=true;try{await repository.savePaper(paper);savedIds.add(paper.arxivId);setBookmarkState(button,true,paper.title)}catch(error){setStatus(error.message,true)}finally{button.disabled=false}}
async function syncBookmark(paper,button){await loadSaved();setBookmarkState(button,savedIds.has(paper.arxivId),paper.title)}
function setStatus(message,error=false){element("status").textContent=message;element("status").classList.toggle("error",error)}

function renderResults(){element("results").replaceChildren(...loadedPapers.map(p=>paperRow(p,{repository,saved:savedIds.has(p.arxivId),onToggle:b=>toggle(p,b),openArxivLinksInNewTab,renderAbstract})))}
window.addEventListener("focus",()=>void loadSaved().catch(error=>setStatus(error.message,true)));

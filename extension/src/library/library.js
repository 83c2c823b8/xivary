import { RepositoryClient } from "../repository/repository-client.js";
import { paperRow } from "../ui/paper-row.js";
const repository = new RepositoryClient(); const element = id => document.getElementById(id); let papers = [];
element("filter").addEventListener("input", render); window.addEventListener("focus", () => void load()); void load();
async function load(){try{papers=await repository.listFavorites();render();setStatus("")}catch(error){setStatus(error.message,true)}}
function render(){const query=element("filter").value.trim().toLowerCase();const visible=papers.filter(p=>[p.title,...p.authors.map(a=>a.displayName),...(p.categories||[])].join(" ").toLowerCase().includes(query));
  element("papers").replaceChildren(...visible.map(p=>paperRow(p,{saved:true,showAbstract:false,onToggle:button=>unsave(p,button)})));
  element("count").textContent=`${visible.length} of ${papers.length}`; element("empty").hidden=visible.length>0;}
async function unsave(paper,button){button.disabled=true;try{await repository.removeFavorite(paper.arxivId);await load();setStatus("Paper removed from the library.")}catch(error){button.disabled=false;setStatus(error.message,true)}}
function setStatus(message,error=false){element("status").textContent=message;element("status").classList.toggle("error",error)}

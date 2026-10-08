import { launchPage } from "./launcher.js";
import { RepositoryClient } from "../repository/repository-client.js";
import { getBrowserApi } from "../platform/browser-api.js";
const api = getBrowserApi();
const repository = new RepositoryClient();
const element = id => document.getElementById(id);
element("open-settings").addEventListener("click", async () => {
  await api.runtime.openOptionsPage();
  window.close();
});
let launching = false;
const launchButtons = [...document.querySelectorAll("[data-page]")];
launchButtons.forEach(button => button.addEventListener("click", async () => {
  if (launching) return;
  launching = true; launchButtons.forEach(node => { node.disabled = true; });
  try { await launchPage(api, repository, button.dataset.page); window.close(); }
  catch (error) { element("status").textContent = `Could not open Xivary: ${error.message}`; }
  finally { launching = false; launchButtons.forEach(node => { node.disabled = false; }); }
}));
try {
  const [papers, authors] = await Promise.all([
    repository.listFavorites(), repository.listFollowing(),
  ]);
  element("saved-count").textContent = papers.length;
  element("following-count").textContent = authors.length;
} catch (error) { element("status").textContent = error.message; }

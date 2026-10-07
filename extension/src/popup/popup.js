import { RepositoryClient } from "../repository/repository-client.js";
import { getBrowserApi } from "../platform/browser-api.js";
const api = getBrowserApi();
const repository = new RepositoryClient();
const element = id => document.getElementById(id);
element("open-settings").addEventListener("click", async () => {
  await api.runtime.openOptionsPage();
  window.close();
});
document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", async () => {
  await api.tabs.create({ url: api.runtime.getURL(`src/${button.dataset.page}`) });
  window.close();
}));
try {
  const [papers, authors] = await Promise.all([
    repository.listFavorites(), repository.listFollowing(),
  ]);
  element("saved-count").textContent = papers.length;
  element("following-count").textContent = authors.length;
} catch (error) { element("status").textContent = error.message; }

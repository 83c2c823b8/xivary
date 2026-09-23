import { RepositoryClient } from "../repository/repository-client.js";
const repository = new RepositoryClient();
const element = id => document.getElementById(id);
document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL(`src/${button.dataset.page}`) });
  window.close();
}));
try {
  const [papers, authors] = await Promise.all([repository.listFavorites(), repository.listFollowing()]);
  element("saved-count").textContent = papers.length;
  element("following-count").textContent = authors.length;
} catch (error) { element("status").textContent = error.message; }

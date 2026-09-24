import { RepositoryClient } from "../repository/repository-client.js";
const repository = new RepositoryClient();
const element = id => document.getElementById(id);
element("show-preferences").addEventListener("click", () => {
  const panel = element("preferences");
  panel.hidden = !panel.hidden;
  element("show-preferences").setAttribute("aria-expanded", String(!panel.hidden));
  if (!panel.hidden) element("open-arxiv-new-tab").focus();
});
element("open-arxiv-new-tab").addEventListener("change", async event => {
  const checkbox = event.currentTarget;
  checkbox.disabled = true;
  try {
    const preference = await repository.setOpenArxivLinksInNewTab(checkbox.checked);
    checkbox.checked = preference.openArxivLinksInNewTab;
    element("status").textContent = "";
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    element("status").textContent = error.message;
  } finally { checkbox.disabled = false; }
});
document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL(`src/${button.dataset.page}`) });
  window.close();
}));
try {
  const [papers, authors, preferences] = await Promise.all([
    repository.listFavorites(), repository.listFollowing(), repository.getPreferences(),
  ]);
  element("saved-count").textContent = papers.length;
  element("following-count").textContent = authors.length;
  element("open-arxiv-new-tab").checked = preferences.openArxivLinksInNewTab;
} catch (error) { element("status").textContent = error.message; }

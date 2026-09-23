// Manifest content scripts are classic scripts; load the small ES-module UI.
void import(chrome.runtime.getURL("src/content/arxiv-page.js"))
  .then(module => module.mountArxivPage())
  .catch(error => console.error("arXiv Research Library could not start:", error));

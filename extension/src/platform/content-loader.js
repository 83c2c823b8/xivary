// Manifest content scripts are classic scripts. Resolving the first module URL
// must precede importing browser-api.js; keep this bootstrap exception here.
void import((globalThis.browser ?? globalThis.chrome).runtime.getURL("src/content/arxiv-page.js"))
  .then(module => module.mountArxivPage())
  .catch(error => console.error("Xivary could not start:", error));

import { RepositoryClient } from "../repository/repository-client.js";

const repository = new RepositoryClient();
let objectUrl;
async function open() {
  const status = document.getElementById("status");
  try {
    const { copy, blob } = await repository.readOfflinePdf(new URL(location.href).searchParams.get("id"));
    document.title = `${copy.paper.title} (${copy.versionedId}) — Xivary`;
    objectUrl = URL.createObjectURL(blob);
    const frame = document.getElementById("pdf");
    frame.src = objectUrl;
    frame.hidden = false;
    status.hidden = true;
  } catch (error) { status.textContent = error.message; }
}
// The tab owns the URL, independent of service-worker suspension. Reload reconstructs it.
window.addEventListener("pagehide", event => {
  if (!event.persisted && objectUrl) URL.revokeObjectURL(objectUrl);
});
void open();

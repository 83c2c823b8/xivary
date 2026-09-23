import { RepositoryClient } from "../repository/repository-client.js";
import { normalizeAuthorName } from "../domain/author.js";
import { extractPaper } from "./extract-paper.js";

export async function mountArxivPage() {
  const heading = document.querySelector("h1.title");
  if (!heading || document.getElementById("arxiv-library-controls")) return;

  const controls = document.createElement("div");
  controls.id = "arxiv-library-controls";
  const status = document.createElement("span");
  status.className = "arxiv-library-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  controls.append(status);
  heading.after(controls);

  let paper;
  try { paper = extractPaper(document, location.href); }
  catch (error) { status.textContent = `Library: ${error.message}`; return; }

  const repository = new RepositoryClient();
  const favorite = makeButton("Favorite", paper.title);
  controls.prepend(favorite);
  const followingButtons = [];
  const unused = [...paper.authors];
  for (const link of document.querySelectorAll(".authors a")) {
    // Match names, consuming each occurrence once; ignore unrelated author links.
    if (!link.textContent.trim()) continue;
    const index = unused.findIndex(author => author.normalizedName === normalizeAuthorName(link.textContent));
    if (index < 0) continue;
    const [author] = unused.splice(index, 1);
    const button = makeButton("Follow", author.displayName);
    button.title = "Follow this author reference from this paper. Names are not unique across papers.";
    link.after(button);
    followingButtons.push({ author, button });
    button.addEventListener("click", () => act(button, async () => {
      const record = await repository.toggleFollow(author);
      setPressed(button, Boolean(record), "Follow", "Following", author.displayName);
      return record ? `Following ${author.displayName}.` : `Unfollowed ${author.displayName}.`;
    }));
  }

  favorite.addEventListener("click", () => act(favorite, async () => {
    const record = await repository.toggleFavorite(paper);
    setPressed(favorite, Boolean(record), "Favorite", "Favorited", paper.title);
    return record ? "Paper saved." : "Paper removed from favorites.";
  }));

  let busy = false;
  let refreshing = false;
  const buttons = [favorite, ...followingButtons.map(item => item.button)];
  const disable = value => buttons.forEach(button => { button.disabled = value; });

  async function act(button, operation) {
    if (busy || refreshing) return;
    busy = true;
    disable(true);
    status.textContent = "Saving…";
    try { status.textContent = await operation(); }
    catch (error) { status.textContent = `Could not save: ${error.message}`; }
    finally { busy = false; disable(false); button.focus(); }
  }

  async function refresh() {
    if (busy || refreshing) return;
    refreshing = true;
    disable(true);
    try {
      const [favorites, following] = await Promise.all([
        repository.listFavorites(), repository.listFollowing(),
      ]);
      setPressed(favorite, favorites.some(item => item.arxivId === paper.arxivId), "Favorite", "Favorited", paper.title);
      const ids = new Set(following.map(item => item.id));
      followingButtons.forEach(({ author, button }) => {
        setPressed(button, ids.has(author.id), "Follow", "Following", author.displayName);
      });
      status.textContent = "";
    } catch (error) { status.textContent = `Library unavailable: ${error.message}`; }
    finally { refreshing = false; disable(false); }
  }

  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  await refresh();
}

function makeButton(label, name) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "arxiv-library-button";
  setPressed(button, false, label, label, name);
  return button;
}

function setPressed(button, pressed, off, on, name) {
  button.textContent = pressed ? on : off;
  button.setAttribute("aria-pressed", String(pressed));
  button.setAttribute("aria-label", `${pressed ? on : off}: ${name}`);
}

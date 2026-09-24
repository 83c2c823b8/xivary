import { RepositoryClient } from "../repository/repository-client.js";
import { normalizeAuthorName } from "../domain/author.js";
import { extractPaper } from "./extract-paper.js";
import { openPaperCollectionPicker } from "../ui/paper-collection-picker.js";

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
  const favorite = makeBookmarkButton(paper.title);
  heading.append(favorite);
  const followingButtons = [];
  const unused = [...paper.authors];
  for (const link of document.querySelectorAll(".authors a")) {
    // Match names, consuming each occurrence once; ignore unrelated author links.
    if (!link.textContent.trim()) continue;
    const index = unused.findIndex(author => author.normalizedName === normalizeAuthorName(link.textContent));
    if (index < 0) continue;
    const [author] = unused.splice(index, 1);
    const button = makeButton("Follow", author.displayName);
    link.after(button);
    followingButtons.push({ author, button });
    button.addEventListener("click", () => {
      if (busy || refreshing) return;
      void act(button, async () => {
        const followed = button.getAttribute("aria-pressed") === "true";
        const record = followed ? (await repository.unfollowAuthor(author.id), null) : await repository.followAuthor(author);
        followingButtons.filter(item => item.author.id === author.id).forEach(item => {
          setPressed(item.button, Boolean(record), "Follow", "Following", item.author.displayName);
        });
        return followed ? `No longer following ${author.displayName}.` : `Following ${author.displayName}.`;
      });
    });
  }

  favorite.setAttribute("aria-haspopup", "dialog");
  favorite.setAttribute("aria-expanded", "false");
  favorite.addEventListener("click", () => {
    if (busy || refreshing) return;
    if (favorite.getAttribute("aria-pressed") === "true") {
      void openPaperCollectionPicker({ repository, paper, anchor: favorite, onChange: refresh });
      return;
    }
    void act(favorite, async () => {
      await repository.savePaper(paper);
      setBookmarkState(favorite, true, paper.title);
      return "Paper saved.";
    });
  });

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
    catch (error) { status.textContent = `Could not update the library: ${error.message}`; }
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
      setBookmarkState(favorite, favorites.some(item => item.arxivId === paper.arxivId), paper.title);
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

function makeBookmarkButton(name) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "arxiv-library-bookmark";
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.75 3.75h10.5v16.5L12 16.5l-5.25 3.75V3.75Z"/></svg>';
  setBookmarkState(button, false, name);
  return button;
}

function setBookmarkState(button, saved, name) {
  button.classList.toggle("is-saved", saved);
  button.setAttribute("aria-pressed", String(saved));
  button.setAttribute("aria-label", `${saved ? "Manage collections for" : "Save paper"}: ${name}`);
  button.title = saved ? "Manage collections" : "Save paper";
  if (saved) { button.setAttribute("aria-haspopup", "dialog"); if (!button.hasAttribute("aria-expanded")) button.setAttribute("aria-expanded", "false"); }
  else { button.removeAttribute("aria-haspopup"); button.removeAttribute("aria-expanded"); }
}

function setPressed(button, pressed, off, on, name) {
  button.textContent = pressed ? on : off;
  button.setAttribute("aria-pressed", String(pressed));
  button.setAttribute("aria-label", `${pressed ? "Unfollow" : "Follow"}: ${name}`);
  button.title = pressed ? `Unfollow ${name}` : `Follow ${name}`;
}

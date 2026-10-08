import { setFollowButton } from "../ui/follow-button.js";
import { showUndo } from "../ui/undo.js";
import { RepositoryClient } from "../repository/repository-client.js";
import { normalizeAuthorName } from "../domain/author.js";
import { extractPaper } from "./extract-paper.js";
import { openAuthorCollectionPicker } from "../ui/author-collection-picker.js";
import { openPaperCollectionPicker } from "../ui/paper-collection-picker.js";
import { getBrowserApi } from "../platform/browser-api.js";
import { authorFromArxivLink, shouldOpenAuthorInXivary } from "./author-link.js";

export async function mountArxivPage() {
  mountAuthorNavigation();
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
  let organizeAuthorCollections = false;
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
    const button = makeButton(author.displayName);
    link.after(button);
    followingButtons.push({ author, button });
    button.addEventListener("click", () => {
      if (busy || refreshing) return;
      if (button.getAttribute("aria-pressed") === "true" && organizeAuthorCollections) {
        void openAuthorCollectionPicker({ repository, author, anchor: button, onChange: refresh });
        return;
      }
      void act(button, async () => {
        const followed = button.getAttribute("aria-pressed") === "true";
        const record = followed ? (showUndo(repository, await repository.unfollowAuthor(author.id), `Unfollowed ${author.displayName}.`, refresh), null) : await repository.followAuthor(author);
        followingButtons.filter(item => item.author.id === author.id).forEach(item => {
          setFollowButton(item.button, Boolean(record), item.author.displayName, organizeAuthorCollections);
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
        setFollowButton(button, ids.has(author.id), author.displayName, organizeAuthorCollections);
      });
      status.textContent = "";
    } catch (error) { status.textContent = `Library unavailable: ${error.message}`; }
    try {
      const preferences = await repository.getPreferences();
      organizeAuthorCollections = preferences.organizeFollowedAuthorsIntoCollections === true;
      followingButtons.forEach(({ author, button }) => {
        setFollowButton(button, button.getAttribute("aria-pressed") === "true", author.displayName, organizeAuthorCollections);
      });
    } catch (error) { status.textContent = `Could not load collection preference: ${error.message}`; }
    finally { refreshing = false; disable(false); }
  }

  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  await refresh();
}

function makeButton(name) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "arxiv-library-button";
  setFollowButton(button, false, name);
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


let navigationMounted = false;
function mountAuthorNavigation() {
  if (navigationMounted) return;
  navigationMounted = true;
  document.addEventListener("click", event => {
    if (!shouldOpenAuthorInXivary(event)) return;
    const link = event.target?.closest?.("a[href]");
    const reference = authorFromArxivLink(link, location.href);
    if (!reference || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    event.preventDefault();
    void getBrowserApi().runtime.sendMessage({ channel: "xivary.author-navigation", name: reference.name })
      .then(result => { if (!result?.ok) location.assign(link.href); })
      .catch(() => location.assign(link.href));
  });

}

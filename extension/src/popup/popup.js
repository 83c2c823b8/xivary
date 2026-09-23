import { RepositoryClient } from "../repository/repository-client.js";
import { normalizeArxivId } from "../domain/identifiers.js";

const repository = new RepositoryClient();
const element = id => document.getElementById(id);
let busy = false;

for (const section of ["favorites", "following"]) {
  element(`${section}-tab`).addEventListener("click", () => {
    for (const name of ["favorites", "following"]) {
      element(`${name}-tab`).setAttribute("aria-pressed", String(name === section));
      element(`${name}-section`).hidden = name !== section;
    }
  });
}
element("refresh").addEventListener("click", () => void refresh());
window.addEventListener("focus", () => void refresh());
void refresh();

async function refresh() {
  if (busy) return;
  busy = true;
  setDisabled(true);
  try { await render(); setStatus("Your library is up to date."); }
  catch (error) { setStatus(error.message, true); }
  finally { busy = false; setDisabled(false); }
}

async function render() {
  const [favorites, following] = await Promise.all([
    repository.listFavorites(), repository.listFollowing(),
  ]);
  // Build both lists before replacing either, so rendering failures retain the UI.
  const paperRows = favorites.map(paperRow);
  const authorRows = following.map(authorRow);
  element("favorites-list").replaceChildren(...paperRows);
  element("following-list").replaceChildren(...authorRows);
  element("favorites-count").textContent = favorites.length;
  element("following-count").textContent = following.length;
  element("favorites-empty").hidden = favorites.length > 0;
  element("following-empty").hidden = following.length > 0;
}

function paperRow(paper) {
  const row = document.createElement("li");
  const id = normalizeArxivId(paper.arxivId);
  row.append(textNode("h2", paper.title), textNode("p", paper.authors.map(author => author.displayName).join(", "), "metadata"));
  row.append(textNode("p", `arXiv:${id}`, "metadata"));
  const actions = textNode("div", "", "actions");
  actions.append(link("Abstract", `https://arxiv.org/abs/${id}`), link("PDF", `https://arxiv.org/pdf/${id}`));
  actions.append(removeButton("Remove", `Remove favorite: ${paper.title}`, () => repository.removeFavorite(id)));
  row.append(actions);
  return row;
}

function authorRow(author) {
  const row = document.createElement("li");
  row.append(textNode("h2", author.displayName));
  row.append(textNode("p", `From arXiv:${author.sourceArxivId} · author ${author.sourceAuthorIndex + 1}`, "metadata"));
  const actions = textNode("div", "", "actions");
  actions.append(link("Source paper", `https://arxiv.org/abs/${normalizeArxivId(author.sourceArxivId)}`));
  actions.append(removeButton("Unfollow", `Unfollow: ${author.displayName}`, () => repository.unfollowAuthor(author.id)));
  row.append(actions);
  return row;
}

function removeButton(label, accessibleLabel, operation) {
  const button = textNode("button", label);
  button.type = "button";
  button.setAttribute("aria-label", accessibleLabel);
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    setDisabled(true);
    setStatus("Saving…");
    try {
      await operation();
      await render();
      setStatus(label === "Remove" ? "Favorite removed." : "Author unfollowed.");
    } catch (error) { setStatus(error.message, true); }
    finally {
      busy = false;
      setDisabled(false);
      if (!button.isConnected) element("refresh").focus();
    }
  });
  return button;
}

function textNode(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function link(label, url) {
  const anchor = textNode("a", label);
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

function setStatus(message, error = false) {
  element("status").textContent = message;
  element("status").classList.toggle("error", error);
}

function setDisabled(value) {
  document.querySelectorAll("main button").forEach(button => { button.disabled = value; });
}

import { RepositoryClient } from "../repository/repository-client.js";

const repository = new RepositoryClient();
const element = id => document.getElementById(id);
let busy = false;

window.addEventListener("focus", () => void load());
void load();

async function load() {
  try {
    const authors = await repository.listFollowing();
    element("authors").replaceChildren(...authors.map(authorRow));
    element("empty").hidden = authors.length > 0;
    setStatus("");
  } catch (error) { setStatus(error.message, true); }
}

function authorRow(author) {
  const row = document.createElement("li");
  row.className = "author-row";
  const heading = document.createElement("h2");
  const link = document.createElement("a");
  link.textContent = author.displayName;
  link.href = `../author/author.html?authorId=${encodeURIComponent(author.id)}`;
  heading.append(link);
  const actions = document.createElement("div");
  actions.className = "actions";
  const unfollow = document.createElement("button");
  unfollow.type = "button";
  unfollow.textContent = "Unfollow";
  unfollow.addEventListener("click", () => void unfollowAuthor(author, unfollow));
  actions.append(unfollow);
  row.append(heading, actions);
  return row;
}

async function unfollowAuthor(author, button) {
  if (busy) return;
  busy = true;
  button.disabled = true;
  try { await repository.unfollowAuthor(author.id); await load(); setStatus(`No longer following ${author.displayName}.`); }
  catch (error) { button.disabled = false; setStatus(error.message, true); }
  finally { busy = false; }
}

function setStatus(message, error = false) {
  element("status").textContent = message;
  element("status").classList.toggle("error", error);
}

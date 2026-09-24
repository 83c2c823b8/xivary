import { RepositoryClient } from "../repository/repository-client.js";

const repository = new RepositoryClient();
const element = id => document.getElementById(id);
const controls = {
  "open-arxiv-new-tab": {
    key: "openArxivLinksInNewTab",
    save: enabled => repository.setOpenArxivLinksInNewTab(enabled),
  },
  "organize-author-collections": {
    key: "organizeFollowedAuthorsIntoCollections",
    save: enabled => repository.setOrganizeFollowedAuthorsIntoCollections(enabled),
  },
};

for (const [id, preference] of Object.entries(controls)) {
  element(id).addEventListener("change", event => void update(event.currentTarget, preference));
}
void load();

async function load() {
  setDisabled(true);
  try {
    const preferences = await repository.getPreferences();
    for (const [id, preference] of Object.entries(controls)) element(id).checked = preferences[preference.key];
    setStatus("");
  } catch (error) { setStatus(error.message, true); }
  finally { setDisabled(false); }
}

async function update(input, preference) {
  const requested = input.checked;
  input.disabled = true;
  try {
    const saved = await preference.save(requested);
    input.checked = saved[preference.key];
    setStatus("");
  } catch (error) {
    input.checked = !requested;
    setStatus(error.message, true);
  } finally { input.disabled = false; }
}

function setDisabled(value) { Object.keys(controls).forEach(id => { element(id).disabled = value; }); }
function setStatus(message, error = false) { element("status").textContent = message; element("status").classList.toggle("error", error); }

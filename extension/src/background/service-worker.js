import { ChromeLocalStorage } from "../lib/storage.js";
import { LocalRepository } from "../repository/local-repository.js";
import { createRepositoryHandler } from "./repository-handler.js";

const repository = new LocalRepository(new ChromeLocalStorage());
chrome.runtime.onMessage.addListener(createRepositoryHandler(repository, chrome.runtime.id));

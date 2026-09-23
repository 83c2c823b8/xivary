export const STORAGE_KEY = "arxivResearchLibrary";

/** The only adapter allowed to access Chrome's local storage API. */
export class ChromeLocalStorage {
  constructor(area = globalThis.chrome.storage.local) {
    this.area = area;
  }

  async read() {
    const values = await this.area.get(STORAGE_KEY);
    return values[STORAGE_KEY];
  }

  async write(state) {
    await this.area.set({ [STORAGE_KEY]: state });
  }
}

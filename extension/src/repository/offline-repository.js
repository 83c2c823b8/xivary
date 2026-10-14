import { createPaper } from "../domain/paper.js";
import { normalizeArxivId } from "../domain/identifiers.js";
import { OfflineStorage } from "./offline-storage.js";

export function versionedArxivId(value) {
  const id = normalizeArxivId(value);
  const text = String(value).replace(/\.pdf(?:[?#].*)?$/, "").split(/[?#]/)[0];
  const version = text.match(/v([1-9]\d*)$/)?.[1];
  if (version && !Number.isSafeInteger(Number(version))) throw new Error("Invalid arXiv version.");
  return { arxivId: id, version: version ? Number(version) : null, versionedId: version ? `${id}v${version}` : null };
}

export async function validatePdf(response) {
  if (!response.ok) throw new Error(`arXiv PDF request failed (HTTP ${response.status}).`);
  const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/pdf" && type !== "application/octet-stream") throw new Error("arXiv did not return a PDF.");
  const blob = await response.blob();
  const header = await blob.slice(0, 8).text();
  const tail = await blob.slice(Math.max(0, blob.size - 2048)).text();
  if (!/^%PDF-\d\.\d/.test(header) || !tail.includes("%%EOF")) throw new Error("The PDF is invalid or incomplete.");
  const length = response.headers.get("content-length");
  if (!response.headers.get("content-encoding") && length && Number(length) !== blob.size) throw new Error("The PDF download was interrupted.");
  return blob.slice(0, blob.size, "application/pdf");
}

export class OfflineRepository {
  constructor({ estimate = () => globalThis.navigator?.storage?.estimate?.(), storage = new OfflineStorage(), fetch = (...args) => globalThis.fetch(...args), clock = () => new Date().toISOString(), changed = () => {} } = {}) {
    Object.assign(this, { storage, fetch, clock, changed, estimate });
    this.pending = new Map(); this.controllers = new Map(); this.states = new Map();
  }
  notify() { Promise.resolve().then(this.changed).catch(() => {}); }
  async list() {
    const copies = await this.storage.list();
    const usage = await Promise.resolve().then(this.estimate).catch(() => null);
    return { localUsage: usage?.usage ?? null, copies, operations: Object.fromEntries(this.states), count: copies.length, size: copies.reduce((n, c) => n + c.size, 0) };
  }
  get(id) { return this.storage.get(normalizeArxivId(id)); }
  serialize(id, operation) {
    const previous = this.pending.get(id) || Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    this.pending.set(id, result);
    result.finally(() => { if (this.pending.get(id) === result) this.pending.delete(id); }).catch(() => {});
    return result;
  }
  save(input, update = false) {
    const paper = createPaper(input, this.clock());
    const id = paper.arxivId;
    return this.serialize(id, async () => {
      const existing = await this.storage.get(id);
      if (existing && !update) return existing;
      const controller = new AbortController(); this.controllers.set(id, controller);
      this.states.set(id, { status: "saving" }); this.notify();
      try {
        let target = update ? versionedArxivId(id) : versionedArxivId(input.versionedId || input.arxivId);
        if (target.arxivId !== id) throw new Error("The offline version belongs to another paper.");
        if (!target.version) {
          const response = await this.fetch(`https://arxiv.org/abs/${id}`, { signal: controller.signal, credentials: "omit" });
          if (!response.ok) throw new Error(`Unable to resolve the arXiv version (HTTP ${response.status}).`);
          const html = await response.text();
          const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const versions = [...html.matchAll(new RegExp(`${escaped}v([1-9]\\d*)(?!\\d)`, "g"))].map(match => Number(match[1]));
          if (!versions.length) throw new Error("Unable to determine the exact arXiv version. Open its versioned abstract page and retry.");
          target = versionedArxivId(`${id}v${Math.max(...versions)}`);
        }
        if (existing?.versionedId === target.versionedId) { this.states.delete(id); return existing; }
        const response = await this.fetch(`https://arxiv.org/pdf/${target.versionedId}`, { signal: controller.signal, credentials: "omit" });
        if (response.url && response.url !== `https://arxiv.org/pdf/${target.versionedId}` && response.url !== `https://arxiv.org/pdf/${target.versionedId}.pdf`) throw new Error("Unexpected PDF redirect; offline copy was not changed.");
        const blob = await validatePdf(response);
        if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
        const copy = { ...target, savedAt: this.clock(), revision: crypto.randomUUID(), size: blob.size, paper };
        await this.storage.put(copy, blob);
        this.states.delete(id);
        return copy;
      } catch (error) {
        const message = error.name === "QuotaExceededError" ? "Offline storage is full. Remove a copy in Offline and retry."
          : error.name === "AbortError" ? "Offline save cancelled." : error.message;
        this.states.set(id, { status: "error", error: message });
        throw new Error(message);
      } finally { this.controllers.delete(id); this.notify(); }
    });
  }
  cancel(id) { this.controllers.get(normalizeArxivId(id))?.abort(); }
  remove(value) {
    const id = normalizeArxivId(value); this.cancel(id);
    return this.serialize(id, async () => { await this.storage.remove(id); this.states.delete(id); this.notify(); });
  }
  async chunk(id, revision, offset) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid PDF offset.");
    const { copy, blob } = await this.storage.read(normalizeArxivId(id));
    if (!copy || !blob || (copy.revision || copy.savedAt) !== revision) throw new Error("Offline copy changed. Reload and try again.");
    const bytes = new Uint8Array(await blob.slice(offset, offset + 512 * 1024).arrayBuffer());
    let text = "";
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
  }
}

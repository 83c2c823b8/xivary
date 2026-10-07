import { spawn } from "node:child_process";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** CDP pipe to one disposable profile. Never connects to the user's browser. */
export class ChromiumTestSession {
  constructor(profile) {
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = [];
    this.errors = "";
    let buffer = "";
    this.process = spawn(process.env.CHROME_BIN || "/usr/bin/google-chrome", [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--no-first-run", "--disable-background-networking", "--remote-debugging-pipe",
      "--enable-unsafe-extension-debugging", `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
    this.process.stderr.on("data", data => { this.errors += data; });
    this.process.stdio[4].on("data", data => {
      buffer += data;
      let index;
      while ((index = buffer.indexOf("\0")) >= 0) {
        const message = JSON.parse(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        if (message.id) {
          const callback = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) callback?.reject(new Error(JSON.stringify(message.error)));
          else callback?.resolve(message.result);
        } else for (const listener of this.listeners) listener(message);
      }
    });
    for (const stream of [this.process.stdio[3], this.process.stdio[4]]) {
      stream.on("error", error => { this.errors += error.message; });
    }
    this.process.on("error", error => { this.errors += error.message; });
  }

  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout: ${method}\n${this.errors.slice(-2000)}`));
      }, 15000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.process.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
    });
  }

  async evaluate(sessionId, expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }

  async page(url) {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    await this.send("Page.enable", {}, sessionId);
    await this.send("Runtime.enable", {}, sessionId);
    if (url) await this.send("Page.navigate", { url }, sessionId);
    return { targetId, sessionId };
  }

  async click(sessionId, selector, { modifiers = 0, button = "left" } = {}) {
    const point = await this.evaluate(sessionId, `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      node.scrollIntoView({ block: "center" });
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button, buttons: button === "middle" ? 4 : 1, clickCount: 1, modifiers }, sessionId);
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button, buttons: 0, clickCount: 1, modifiers }, sessionId);
  }

  async until(sessionId, expression, timeout = 15000) {
    return waitFor(() => this.evaluate(sessionId, expression), expression, timeout);
  }

  async close() {
    await this.send("Browser.close").catch(() => {});
    for (let attempt = 0; attempt < 30 && this.process.exitCode === null; attempt++) await delay(100);
    if (this.process.exitCode === null) this.process.kill();
  }
}

export async function waitFor(predicate, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Condition not met: ${description}`);
}

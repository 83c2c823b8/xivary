import assert from "node:assert/strict";
import { followingWorkflow, pickerVisualWorkflow, renameOutsideWorkflow } from "./following-workflow.mjs";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { packageExtension } from "./package-extension.mjs";

// No Selenium dependency or test-only extension permissions. Drive the generated
// Firefox package via WebDriver; an HTTPS fixture proxy preserves real arXiv URLs.
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "xivary-firefox-"));
const uuid = "59b6a7f8-6a1e-4ae3-947c-302e08e350f7";
const extensionUrl = path => `moz-extension://${uuid}/src/${path}`;
const screenshotDir = process.env.ARXIV_SCREENSHOT_DIR;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sockets = new Set();
let driver, proxy, secureServer, session, endpoint, log = "";

async function request(method, path, body) {
  const response = await fetch(`${endpoint}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result.value));
  return result.value;
}
const command = (path, body = {}) => request("POST", `/session/${session}${path}`, body);
const evaluate = expression => command("/execute/sync", { script: `return (${expression});`, args: [] });
async function evaluateAsync(expression) {
  const result = await command("/execute/async", {
    script: `const done = arguments[arguments.length - 1]; Promise.resolve().then(() => (${expression})).then(value => done({ value }), error => done({ error: String(error) }));`,
    args: [],
  });
  if (result.error) throw new Error(result.error);
  return result.value;
}
async function until(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`Condition not met: ${expression}\n${await evaluate("document.body.innerText")}`);
}
async function screenshot(name) {
  if (!screenshotDir) return;
  await evaluateAsync("document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))");
  await mkdir(screenshotDir, {recursive:true});
  const data = await request('GET', `/session/${session}/screenshot`);
  await writeFile(join(screenshotDir, `firefox-${name}`), Buffer.from(data, 'base64'));
}
async function pickerClick(selector) {
  const element = await command('/element', {using:'css selector', value:selector});
  await command('/actions',{actions:[{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',origin:element,x:0,y:0,duration:0}]}]});
  await command(`/element/${element['element-6066-11e4-a52e-4f735466cecf']}/click`);
}
async function pickerKey(key) {
  const value={Tab:'\uE004',Escape:'\uE00C',Enter:'\uE007'}[key];
  await command('/actions',{actions:[{type:'key',id:'keyboard',actions:[{type:'keyDown',value},{type:'keyUp',value}]}]});
}
async function navigate(url) { await command("/url", { url }); }
// Firefox WebDriver rejects direct moz-extension navigation. Enter through the
// real content author action, then navigate from the extension's own origin.
async function navigateExtension(path) {
  assert.equal(await evaluate("location.protocol"), "moz-extension:");
  await evaluate(`location.assign(browser.runtime.getURL(${JSON.stringify(`src/${path}`)}))`);
  await until(`location.href === ${JSON.stringify(extensionUrl(path))}`);
}
async function openAuthorFromArxiv() {
  const handles = await request("GET", `/session/${session}/window/handles`);
  await evaluate("document.querySelector('.authors a').click()");
  await switchToNewPage(handles);
  await until("document.querySelector('#name')?.textContent === 'Alex Kim'");
}
async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return server.address().port;
}
async function switchToNewPage(previousHandles) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const handles = await request("GET", `/session/${session}/window/handles`);
    const handle = handles.find(item => !previousHandles.includes(item));
    if (handle) { await command("/window", { handle }); return; }
    await delay(100);
  }
  throw new Error("The extension action did not open a new page.");
}

try {
  const { directory, manifest } = await packageExtension("firefox", join(temporary, "package"));
  const fixture = (await readFile(join(root, "tests/fixtures/arxiv-abstract.html"), "utf8"))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const atom = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/2609.01234v1</id><title>Firefox feed fixture</title><summary>Local fixture</summary><published>2026-09-20T00:00:00Z</published><author><name>Alex Kim</name></author><category term="math.AG"/></entry></feed>';
  const key = join(temporary, "key.pem"), cert = join(temporary, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key,
    "-out", cert, "-days", "1", "-subj", "/CN=arxiv.org", "-addext", "subjectAltName=DNS:arxiv.org,DNS:export.arxiv.org"], { stdio: "ignore" });
  secureServer = httpsServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => {
    const isApi = req.headers.host === "export.arxiv.org";
    res.writeHead(200, { "Content-Type": isApi ? "application/atom+xml" : "text/html; charset=utf-8" });
    res.end(isApi ? atom : req.headers.host === "arxiv.org" ? fixture : "");
  });
  proxy = httpServer((req, res) => { res.writeHead(200); res.end(""); });
  proxy.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  proxy.on("connect", (req, socket, head) => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) socket.unshift(head);
    secureServer.emit("connection", socket);
  });
  const proxyPort = await listen(proxy);
  const portReservation = httpServer();
  const driverPort = await listen(portReservation);
  await new Promise(resolve => portReservation.close(resolve));
  endpoint = `http://127.0.0.1:${driverPort}`;
  // Firefox 138+ requires this test-driver flag to inspect extension contexts.
  // The driver binds loopback and controls only the disposable profile above.
  driver = spawn(process.env.GECKODRIVER_BIN || "geckodriver", ["--allow-system-access", "--host", "127.0.0.1", "--port", String(driverPort)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let launchError;
  driver.on("error", error => { launchError = error; });
  driver.stdout.on("data", data => { log += data; });
  driver.stderr.on("data", data => { log += data; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError) throw launchError;
    if (driver.exitCode !== null) throw new Error(`geckodriver exited: ${log}`);
    try { await request("GET", "/status"); break; } catch { await delay(100); }
    if (attempt === 99) throw new Error("geckodriver did not start. Set GECKODRIVER_BIN and FIREFOX_BIN.");
  }
  const profile = join(temporary, "profile");
  await mkdir(profile);
  const started = await request("POST", "/session", {
    capabilities: { alwaysMatch: {
      browserName: "firefox", acceptInsecureCerts: true,
      proxy: { proxyType: "manual", httpProxy: `127.0.0.1:${proxyPort}`, sslProxy: `127.0.0.1:${proxyPort}`, noProxy: ["localhost", "127.0.0.1"] },
      "moz:firefoxOptions": {
        ...(process.env.FIREFOX_BIN ? { binary: process.env.FIREFOX_BIN } : {}),
        args: ["-headless", "-profile", profile],
        prefs: {
          "extensions.webextensions.uuids": JSON.stringify({ [manifest.browser_specific_settings.gecko.id]: uuid }),
          "network.proxy.allow_hijacking_localhost": false,
          "network.http.http3.enable": false,
        },
      },
    } },
  });
  session = started.sessionId;
  console.log(`Firefox ${started.capabilities.browserVersion}`);
  assert.equal(await command("/moz/addon/install", { path: directory, temporary: true }), manifest.browser_specific_settings.gecko.id);

  await navigate("https://arxiv.org/abs/2401.00001");
  await until("document.querySelectorAll('.authors .arxiv-library-button').length === 2 && !document.querySelector('.arxiv-library-bookmark').disabled");
  assert.equal(await evaluate("document.querySelectorAll('.arxiv-library-bookmark').length===1 && document.querySelector('h1.title').lastElementChild.classList.contains('arxiv-library-bookmark') && document.querySelector('h1.title').textContent==='Title:A sample paper' && getComputedStyle(document.querySelector('.arxiv-library-bookmark')).float==='none'"),true);
  await screenshot("arxiv-title-unsaved.png");
  await evaluate("document.querySelector('.arxiv-library-bookmark').click()");
  await until("document.querySelector('.arxiv-library-bookmark').getAttribute('aria-pressed') === 'true' && !document.querySelector('.arxiv-library-bookmark').disabled");
  await evaluate("document.querySelector('.authors .arxiv-library-button').click()");
  await until("document.querySelector('.authors .arxiv-library-button').getAttribute('aria-pressed') === 'true'");
  await command("/refresh");
  await until("document.querySelector('.arxiv-library-bookmark')?.getAttribute('aria-pressed') === 'true' && document.querySelector('.authors .arxiv-library-button')?.getAttribute('aria-pressed') === 'true'");

  await screenshot("arxiv-title-saved.png");
  await openAuthorFromArxiv();
  await navigateExtension("popup/popup.html");
  await until("document.querySelector('#saved-count')?.textContent === '1' && document.querySelector('#following-count')?.textContent === '1'");
  assert.equal(await evaluate("(()=>{const root=getComputedStyle(document.documentElement),body=getComputedStyle(document.body);return document.body.getBoundingClientRect().width===300&&root.borderRadius==='12px'&&body.borderRadius==='12px'&&root.overflow==='hidden'&&body.overflow==='hidden'&&getComputedStyle(document.querySelector('nav button')).borderRadius==='8px'&&document.documentElement.scrollWidth===document.documentElement.clientWidth})()"),true);
  await screenshot("popup-page.png");
  const previous = await request("GET", `/session/${session}/window/handles`);
  await evaluate("document.querySelector('[data-page=\"library/library.html\"]').click()");
  await switchToNewPage(previous);
  await until("document.querySelectorAll('#papers .paper-row').length === 1");
  assert.equal(await evaluate("location.href"), extensionUrl("library/library.html"));
  await screenshot("library.png");
  await renameOutsideWorkflow({evaluate:evaluateAsync, click:pickerClick, until, key:pickerKey});
  await pickerClick('.paper-row .bookmark');await until("document.querySelector('.arxiv-collection-picker input[type=checkbox]')");
  await pickerVisualWorkflow({evaluate:evaluateAsync,key:pickerKey,screenshot:name=>screenshot(`library-${name}`)});
  await pickerClick('.collection-picker-heading button');
  const stored = await evaluateAsync("import('../lib/storage.js').then(async ({ BrowserLocalStorage }) => new BrowserLocalStorage().read())");
  assert.equal(stored.schemaVersion, 5);
  assert.equal(stored.favorites.length, 1);
  assert.equal(stored.paperMemberships.length, 1);
  assert.equal(stored.authors.length, 1);
  assert.equal(stored.memberships.length, 1);
  assert.equal(Object.hasOwn(stored, "_chromeSync"), false);
  const rejected = await evaluateAsync("import('../repository/repository-client.js').then(async ({ RepositoryClient }) => { try { await new RepositoryClient().request('run'); return false; } catch { return true; } })");
  assert.equal(rejected, true);

  assert.equal(await evaluate("document.querySelector('.settings-link').getAttribute('aria-label')"), "Settings");
  await evaluate("document.querySelector('.settings-link').click()");
  await until("location.pathname.endsWith('/settings/settings.html') && document.querySelector('#open-arxiv-new-tab')");

  await evaluate("document.querySelector('.app-nav a[href*=authors]').click()");
  await until("document.querySelectorAll('.author-row').length === 1");
  assert.equal(await evaluate("document.querySelector('.settings-link').getAttribute('aria-label')"), "Settings");
  await evaluate("document.querySelector('.settings-link').click()");
  await until("location.pathname.endsWith('/settings/settings.html') && document.querySelector('#open-arxiv-new-tab')");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-import]')].map(node=>node.dataset.import)"), ["bookmarks", "following"]);
  await evaluate("document.querySelector('.app-nav a[href*=authors]').click()");
  await until("document.querySelectorAll('.author-row').length === 1");
  await evaluate("document.querySelector('.author-row a').click()");
  await until("document.querySelectorAll('.paper-row').length === 1");
  assert.equal(await evaluate("document.querySelector('.paper-row h2').textContent"), "Firefox feed fixture");
  await until("document.querySelector('#follow-author').textContent==='Following' && !document.querySelector('#follow-author').disabled");
  await evaluate("(()=>{document.querySelector('#follow-author').click();document.querySelector('#follow-author').click()})()");
  await until("document.querySelector('#follow-author').textContent==='Follow' && document.querySelector('.xivary-undo button')");
  await evaluate("document.querySelector('.xivary-undo button').click()");
  await until("document.querySelector('#follow-author').textContent==='Following' && !document.querySelector('.xivary-undo')");

  await navigateExtension("popup/popup.html");
  await until("document.querySelector('#saved-count')?.textContent === '1'");
  const beforeSettings = await request("GET", `/session/${session}/window/handles`);
  await evaluate("document.querySelector('#open-settings').click()");
  await switchToNewPage(beforeSettings);
  await until("document.readyState === 'complete' && document.querySelector('#open-arxiv-new-tab') && !document.querySelector('#open-arxiv-new-tab').disabled");
  assert.equal(await evaluate("document.querySelector('#open-arxiv-new-tab').checked"), false);
  await evaluate("document.querySelector('#open-arxiv-new-tab').click()");
  await until("document.querySelector('#open-arxiv-new-tab').checked && !document.querySelector('#open-arxiv-new-tab').disabled");
  await command("/refresh");
  await until("document.querySelector('#open-arxiv-new-tab')?.checked && !document.querySelector('#open-arxiv-new-tab').disabled");

  // Firefox popup-page entry (not a native toolbar popup): same-tab launcher uses
  // the native Promise API and preserves the existing Library route.
  await evaluateAsync("(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');await new RepositoryClient().setOpenXivaryFromToolbarInNewTab(false)})()");
  await navigateExtension("popup/popup.html");
  await until("document.querySelector('#saved-count')?.textContent === '1'");
  await evaluate("(()=>{window.close=()=>{};document.querySelector('[data-page=\"library/library.html\"]').click()})()");
  await until("location.pathname.endsWith('/library/library.html') && document.querySelectorAll('.paper-row').length===1");
  await evaluateAsync("(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');return (await new RepositoryClient().getPreferences()).openXivaryFromToolbarInNewTab})()").then(value=>assert.equal(value,false));
  await navigateExtension("authors/authors.html");
  await until("document.querySelectorAll('.author-row').length === 1");
  await followingWorkflow({
    screenshot: name => screenshot(name || "following.png"),
    evaluate: evaluateAsync,
    until,
    reload: () => command("/refresh"),
    click: async selector => {
      const element = await command("/element", { using: "css selector", value: selector });
      await command("/actions", { actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [
        { type: "pointerMove", origin: element, x: 0, y: 0, duration: 0 },
      ] }] });
      await command(`/element/${element["element-6066-11e4-a52e-4f735466cecf"]}/click`);
    },
    key: key => command("/actions", { actions: [{ type: "key", id: "keyboard", actions: [
      { type: "keyDown", value: {Enter:"\uE007",Escape:"\uE00C",ArrowDown:"\uE015",ArrowUp:"\uE013",Home:"\uE011",End:"\uE010",Tab:"\uE004"," ":" "}[key] },
      { type: "keyUp", value: {Enter:"\uE007",Escape:"\uE00C",ArrowDown:"\uE015",ArrowUp:"\uE013",Home:"\uE011",End:"\uE010",Tab:"\uE004"," ":" "}[key] },
    ] }] }),
  });

  await navigate("https://arxiv.org/abs/2401.00001");
  await until("document.querySelector('.authors .arxiv-library-button')?.getAttribute('aria-pressed') === 'true'");
  await evaluate("document.querySelector('.authors .arxiv-library-button').click()");
  await until("document.querySelector('.authors .arxiv-library-button').getAttribute('aria-pressed') === 'false'");
  await openAuthorFromArxiv();
  await navigateExtension("popup/popup.html");
  await until("document.querySelector('#saved-count')?.textContent === '1' && document.querySelector('#following-count')?.textContent === '0'");
  console.log("FIREFOX SMOKE PASS: generated package, background messaging, content save/follow, local-only storage, reloads, feeds, transient author entry, popup navigation, settings and both contextual gears");
} catch (error) {
  console.error(log.slice(-5000));
  throw error;
} finally {
  if (session) await request("DELETE", `/session/${session}`).catch(() => {});
  driver?.kill();
  for (const socket of sockets) socket.destroy();
  proxy?.close();
  secureServer?.close();
  await rm(temporary, { recursive: true, force: true });
}

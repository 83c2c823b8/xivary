import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));const profile=await mkdtemp(join(tmpdir(),"arxiv-smoke-"));
const chrome=spawn(process.env.CHROME_BIN||"/usr/bin/google-chrome",["--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage","--no-first-run","--disable-background-networking","--remote-debugging-pipe","--enable-unsafe-extension-debugging",`--user-data-dir=${profile}`,"about:blank"],{stdio:["ignore","ignore","pipe","pipe","pipe"]});
let nextId=0,buffer="",errors="";const pending=new Map(),listeners=[],runtimeErrors=[],asyncErrors=[];chrome.stderr.on("data",d=>errors+=d);
for(const stream of [chrome.stdio[3],chrome.stdio[4]])stream.on("error",e=>asyncErrors.push(e.message));
chrome.stdio[4].on("data",data=>{buffer+=data;let index;while((index=buffer.indexOf("\0"))>=0){const message=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);if(message.id){const callback=pending.get(message.id);pending.delete(message.id);message.error?callback?.reject(new Error(JSON.stringify(message.error))):callback?.resolve(message.result)}else listeners.forEach(listener=>listener(message))}});
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout: ${method}\n${errors.slice(-2000)}`))},15000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});chrome.stdio[3].write(JSON.stringify({id,method,params,sessionId})+"\0")})}
async function evaluate(sessionId,expression){const result=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true},sessionId);if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value}
async function until(sessionId,expression){for(let i=0;i<80;i++){if(await evaluate(sessionId,expression))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(`Condition not met: ${expression}\n${await evaluate(sessionId,"document.body.innerText")}`)}
async function page(){const {targetId}=await send("Target.createTarget",{url:"about:blank"});const {sessionId}=await send("Target.attachToTarget",{targetId,flatten:true});await send("Page.enable",{},sessionId);await send("Runtime.enable",{},sessionId);return{targetId,sessionId}}
const fixture=(await readFile(join(root,"tests/fixtures/arxiv-abstract.html"),"utf8")).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"");
const atom=`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/2609.01234v1</id><title>Recent mirror symmetry paper</title><summary>A normalized result for browser verification.</summary><published>2026-09-20T00:00:00Z</published><author><name>Alex Kim</name></author><category term="math.AG"/></entry></feed>`;
const intercepted=new Map();listeners.push(message=>{if(message.method==="Runtime.exceptionThrown")runtimeErrors.push(message.params);if(message.method==="Runtime.consoleAPICalled"&&message.params.type==="error")runtimeErrors.push(message.params.args);if(message.method==="Fetch.requestPaused"&&intercepted.has(message.sessionId)){const url=message.params.request.url;const body=url.startsWith("https://export.arxiv.org/")?atom:fixture;void send("Fetch.fulfillRequest",{requestId:message.params.requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:url.includes("export.arxiv.org")?"application/atom+xml":"text/html; charset=utf-8"}],body:Buffer.from(message.params.resourceType==="Document"||url.includes("export.arxiv.org")?body:"").toString("base64")},message.sessionId).catch(e=>asyncErrors.push(e.message))}});
async function intercept(sessionId){intercepted.set(sessionId,true);await send("Fetch.enable",{patterns:[{urlPattern:"https://*"}]},sessionId)}

try{
  const loaded=await send("Extensions.loadUnpacked",{path:join(root,"extension")});const extensionId=loaded.id;const extensionUrl=path=>`chrome-extension://${extensionId}/src/${path}`;
  const {sessionId:arxiv}=await page();await intercept(arxiv);await send("Page.navigate",{url:"https://arxiv.org/abs/2401.00001"},arxiv);
  await until(arxiv,"document.querySelector('.arxiv-library-bookmark') && document.querySelectorAll('.authors .arxiv-library-button').length===2 && !document.querySelector('.arxiv-library-bookmark').disabled");
  await evaluate(arxiv,"document.querySelector('.arxiv-library-bookmark').click()");await until(arxiv,"document.querySelector('.arxiv-library-bookmark').getAttribute('aria-pressed')==='true' && !document.querySelector('.arxiv-library-bookmark').disabled");
  await evaluate(arxiv,"document.querySelector('.authors .arxiv-library-button').click()");await until(arxiv,"document.querySelector('.authors .arxiv-library-button').getAttribute('aria-pressed')==='true'");
  assert.equal(await evaluate(arxiv,"document.querySelector('.arxiv-library-bookmark').title"),"Saved");

  const {sessionId:popup}=await page();await send("Page.navigate",{url:extensionUrl("popup/popup.html")},popup);await until(popup,"document.querySelector('#saved-count')?.textContent==='1' && document.querySelector('#following-count')?.textContent==='1'");
  await evaluate(popup,"window.close=()=>{}");
  for(const [label,path] of [["Open Library","library/library.html"],["Open Following","authors/authors.html"],["Search arXiv","search/search.html"]]){await evaluate(popup,`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);for(let i=0;i<30;i++){const targets=await send("Target.getTargets");if(targets.targetInfos.some(t=>t.url===extensionUrl(path)))break;if(i===29)assert.fail(`${label} did not open ${path}`);await new Promise(r=>setTimeout(r,100))}}

  const {sessionId:library}=await page();await send("Page.navigate",{url:extensionUrl("library/library.html")},library);await until(library,"document.querySelectorAll('#papers .paper-row').length===1");assert.equal(await evaluate(library,"document.querySelector('#papers h2').textContent"),"A sample paper");

  const {sessionId:authors}=await page();await intercept(authors);await send("Page.navigate",{url:extensionUrl("authors/authors.html")},authors);await until(authors,"document.querySelectorAll('#authors .author-row').length===1");
  await evaluate(authors,"document.querySelector('#authors h2 a').click()");await until(authors,"document.querySelector('#name')?.textContent==='Alex Kim' && document.querySelectorAll('.paper-row').length===1");
  assert.match(await evaluate(authors,"document.querySelector('.paper-row h2').textContent"),/Recent mirror symmetry/);await evaluate(authors,"document.querySelector('.paper-row .bookmark').click()");await until(authors,"document.querySelector('.paper-row .bookmark').getAttribute('aria-pressed')==='true'");
  await send("Page.reload",{},library);await until(library,"document.querySelectorAll('#papers .paper-row').length===2");

  const {sessionId:search}=await page();await intercept(search);await send("Page.navigate",{url:extensionUrl("search/search.html")},search);await until(search,"document.querySelectorAll('#field option').length===8");
  await evaluate(search,"document.querySelector('#query').value='mirror symmetry for K3';document.querySelector('#field').value='mirror-symmetry';document.querySelector('#search-form').requestSubmit()");await until(search,"document.querySelectorAll('#results .paper-row').length===1");
  const lengths=[];for(const mode of ["exact","balanced","broad"]){lengths.push(await evaluate(search,`document.querySelector('input[value=${JSON.stringify(mode)}]').click();document.querySelector('#search-form').dispatchEvent(new Event('input'));document.querySelector('#preview').textContent.length`))}assert.ok(lengths[0]<lengths[1]&&lengths[1]<lengths[2]);

  await send("Page.reload",{},arxiv);await until(arxiv,"document.querySelector('.arxiv-library-bookmark')?.getAttribute('aria-pressed')==='true' && document.querySelector('.authors .arxiv-library-button')?.getAttribute('aria-pressed')==='true'");
  const stored=await evaluate(library,"(async()=>{const {ChromeLocalStorage}=await import('../lib/storage.js');return new ChromeLocalStorage().read()})()");assert.equal(stored.schemaVersion,4);assert.equal(stored.authorPaperCaches.length,1);assert.equal(stored.favorites.length,2);
  assert.deepEqual(runtimeErrors,[]);assert.deepEqual(asyncErrors,[]);console.log("BROWSER SMOKE PASS: popup navigation, content state, full-tab pages, author cache, search, and shared saves");
}finally{await send("Browser.close").catch(()=>{});chrome.kill();await new Promise(resolve=>setTimeout(resolve,300));await rm(profile,{recursive:true,force:true})}

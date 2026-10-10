import assert from 'node:assert/strict';

const rpc = operation => `(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repo=new RepositoryClient();return ${operation}})()`;
const overlay = 'document.querySelector("[data-vim-overlay=hints]")';
const fixture = `(()=>{
  const section=document.createElement('section');section.id='vim-fixture';
  const controls=document.createElement('div');controls.style.cssText='display:flex;flex-wrap:wrap;gap:6px';
  for(let index=0;index<20;index++) {
    const button=document.createElement('button');button.type='button';button.id='vim-target-'+index;button.textContent='Action '+index;
    button.addEventListener('click',()=>section.dataset.activated=String(index));controls.append(button);
  }
  const link=document.createElement('a');link.id='vim-link';link.href='../settings/settings.html';link.textContent='Settings fixture';controls.append(link);
  for(const kind of ['hidden','disabled','occluded']) {
    const button=document.createElement('button');button.id='vim-'+kind;button.textContent=kind;
    if(kind==='hidden') button.hidden=true;
    if(kind==='disabled') {const fieldset=document.createElement('fieldset');fieldset.disabled=true;fieldset.style.cssText='border:0;margin:0;padding:0';fieldset.append(button);controls.append(fieldset);continue;}
    if(kind==='occluded') {button.style.cssText='position:fixed;top:0;left:0'; const cover=document.createElement('div');cover.style.cssText='position:fixed;top:0;left:0;width:140px;height:45px;z-index:10;background:white';cover.id='vim-cover';section.append(cover);}
    controls.append(button);
  }
  section.append(controls);
  for(const tag of ['input','textarea','div']) {const input=document.createElement(tag);input.id='vim-edit-'+tag;if(tag==='div')input.contentEditable='true';section.append(input);}
  const list=document.createElement('div');
  for(let index=0;index<150;index++){const row=document.createElement('p');row.textContent='Long list fixture '+index;list.append(row);}
  section.append(list); (document.querySelector('.library-content,.following-content')||document.querySelector('main')).prepend(section);
  document.activeElement.blur();window.scrollTo(0,0);return true;
})()`;

/** Shared real-extension workflow, with native input supplied by each browser. */
export async function vimWorkflow({ evaluate, until, key, click, navigate, reload, resize, screenshot, openLink }) {
  const nativeKey = key;
  key = async value => {
    const selectingHint = await evaluate(`Boolean(${overlay})`);
    await nativeKey(value);
    if (!selectingHint && ['j','k','d','u','g','G'].includes(value)) {
      // scrollTo changes offsets immediately, but the scroll event arrives at
      // the rendering step. Do not start hints before that event dismisses them.
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    }
  };
  await navigate('library/library.html');
  await until('document.querySelector("#count")?.textContent.includes("paper") && !document.querySelector("#show-create").disabled');
  const before = await evaluate(rpc('Promise.all([repo.exportCategory("bookmarks"),repo.exportCategory("following")])'));
  await resize(1100, 850);
  assert.equal(await evaluate(rpc('repo.getPreferences().then(p=>p.vimMode)')), false);
  await evaluate(fixture); await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
  await key('j'); assert.equal(await evaluate('window.scrollY'), 0, 'default off');
  await key('f'); assert.equal(await evaluate(`Boolean(${overlay})`), false);
  await evaluate(rpc('repo.setVimMode(true)'));
  await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
  // A notification enables the already-open page, without focus/reload.
  await key('f'); await until(overlay);
  await evaluate(rpc('repo.setVimMode(false)')); await until(`!${overlay}`);
  await key('j'); assert.equal(await evaluate('window.scrollY'), 0);
  await evaluate(rpc('repo.setVimMode(true)'));
  await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
  await reload(); await until('document.querySelector("#count")?.textContent.includes("paper")');
  await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
  await key('f'); await until(overlay); await screenshot('vim-library-native-hints.png'); await key('Escape');
  await evaluate(fixture); await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
  await key('j'); await until('window.scrollY===80');
  await key('k'); await until('window.scrollY===0');
  await key('k'); assert.equal(await evaluate('window.scrollY'), 0);
  await key('d'); await until('Math.abs(window.scrollY-innerHeight/2)<=1');
  await key('u'); await until('window.scrollY===0');
  await key('G'); await until('Math.abs(window.scrollY-(document.scrollingElement.scrollHeight-innerHeight))<=1');
  const bottom = await evaluate('window.scrollY');
  await key('j'); assert.equal(await evaluate('window.scrollY'), bottom);
  await key('g'); assert.equal(await evaluate('window.scrollY'), bottom, 'isolated g has no action');
  await evaluate('new Promise(resolve=>setTimeout(resolve,750))');
  await key('g'); assert.equal(await evaluate('window.scrollY'), bottom, 'expired sequence');
  await key('g'); await until('window.scrollY===0');
  await key('h'); assert.match(await evaluate('location.pathname'), /library\/library.html$/, 'first tab never wraps');

  const hintFor = async id => {
    return evaluate(`(async()=>{const {hintTargets,hintLabels}=await import('../ui/vim-mode.js');const targets=hintTargets(document,window);return hintLabels(targets.length)[targets.findIndex(node=>node.id===${JSON.stringify(id)})]})()`);
  };
  const choose = async (id, mode='f') => {
    const label = await hintFor(id); assert.ok(label, `visible target ${id}`);
    await key(mode); await until(overlay);
    for (const char of label) await key(char);
    await until(`!${overlay}`);
  };
  await key('f'); await until(overlay);
  assert.deepEqual(await evaluate('(async()=>{const {hintTargets}=await import("../ui/vim-mode.js");return hintTargets(document,window).filter(node=>/^vim-(hidden|disabled|occluded)$/.test(node.id)).map(node=>node.id)})()'), []);
  assert.ok(await evaluate('document.querySelectorAll(".vim-hint").length') > 8);
  assert.ok((await hintFor('vim-target-0')).length > 1);
  await screenshot('vim-library-hints.png');
  await key('Escape'); await until(`!${overlay}`);
  const label = await hintFor('vim-target-0');
  await key('f'); await key(label[0]);
  assert.equal(await evaluate('document.querySelector("#vim-fixture").dataset.activated||null'), null, 'partial label never activates');
  assert.ok(await evaluate('document.querySelectorAll(".vim-hint:not([hidden])").length') > 1);
  await key(label[1]); await until('document.querySelector("#vim-fixture").dataset.activated==="0"');
  await choose('vim-target-1', 'F');
  assert.equal(await evaluate('document.querySelector("#vim-fixture").dataset.activated'), '1', 'F preserves button action');
  await choose('vim-edit-input');
  assert.equal(await evaluate('document.activeElement.id'), 'vim-edit-input', 'input hint focuses native editing');
  await key('j'); assert.equal(await evaluate('document.querySelector("#vim-edit-input").value'), 'j');
  assert.equal(await evaluate('window.scrollY'), 0);
  for (const tag of ['textarea','div']) {
    await click('#vim-edit-'+tag); await key('f');
    assert.equal(await evaluate(`Boolean(${overlay})`), false, `${tag} typing does not show hints`);
  }
  await evaluate('(()=>{document.activeElement.blur();window.scrollTo(0,0)})()');
  // Composition events are dispatched: WebDriver/CDP do not operate an OS IME.
  assert.equal(await evaluate(`(()=>{
    document.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'日本'}));
    const event=new KeyboardEvent('keydown',{key:'j',bubbles:true,cancelable:true});document.body.dispatchEvent(event);
    document.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'日本'}));return !event.defaultPrevented&&window.scrollY===0;
  })()`), true);
  assert.equal(await evaluate(`(()=>{return [{isComposing:true},{keyCode:229},{ctrlKey:true},{altKey:true},{metaKey:true}].every(extra=>{const e=new KeyboardEvent('keydown',{key:'f',bubbles:true,cancelable:true,...extra});document.body.dispatchEvent(e);return !e.defaultPrevented&&!document.querySelector('[data-vim-overlay=hints]')})})()`), true);
  await key('?'); await until('document.querySelector(".vim-help[open]")');
  await screenshot('vim-help.png');
  await key('j'); assert.equal(await evaluate('window.scrollY'), 0, 'help blocks underlying scroll');
  await key('Escape'); await until('!document.querySelector(".vim-help")');
  await key('f'); await until(overlay);
  await evaluate('document.querySelector("#vim-target-4").remove()'); await until(`!${overlay}`);
  await key('f'); await until(overlay); await evaluate('window.scrollTo(0,80)'); await until(`!${overlay}`);
  await evaluate('window.scrollTo(0,0)'); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await key('f'); await until(overlay); await resize(900,800); await until(`!${overlay}`);
  await resize(360,700); await evaluate('window.scrollTo(0,0)'); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await key('f'); await until(overlay);
  assert.equal(await evaluate('[...document.querySelectorAll(".vim-hint:not([hidden])")].every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=document.documentElement.clientWidth&&r.top>=0&&r.bottom<=innerHeight})'), true);
  await screenshot('vim-hints-narrow.png'); await key('Escape'); await resize(1100,850);
  await evaluate('window.scrollTo(0,0)'); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await openLink(() => choose('vim-link','F'));
  assert.match(await evaluate('location.pathname'), /library\/library.html$/, 'F retains source page');
  await choose('vim-link'); await until('document.querySelector("#vim-mode") && !document.querySelector("#vim-mode").disabled');
  assert.equal(await evaluate('document.querySelector("#vim-mode").checked'), true);
  await screenshot('vim-settings.png');
  await evaluate('document.querySelector("#vim-mode").focus()');
  await key(' '); await until('!document.querySelector("#vim-mode").checked&&!document.querySelector("#vim-mode").disabled');
  assert.equal(await evaluate('document.activeElement.id==="vim-mode" && getComputedStyle(document.activeElement.nextElementSibling).outlineStyle==="solid"'), true, 'native Space toggles the accessible switch with visible focus');
  await reload(); await until('document.querySelector("#vim-mode")&&!document.querySelector("#vim-mode").disabled');
  assert.equal(await evaluate('document.querySelector("#vim-mode").checked'), false);
  assert.equal(await evaluate('document.querySelector("#support-link").href'), 'https://buymeacoffee.com/83c2c823b8');
  await click('.setting-row:has(#vim-mode)'); await until('document.querySelector("#vim-mode").checked&&!document.querySelector("#vim-mode").disabled');

  await navigate('library/library.html'); await until('document.querySelector("#count")?.textContent.includes("paper")&&!document.querySelector("#show-create").disabled');
  await click('#show-create'); await key('j'); await key('f');
  assert.equal(await evaluate('document.querySelector("#collection-name").value'), 'jf');
  assert.equal(await evaluate(`Boolean(${overlay})`), false);
  await key('Escape'); await until('document.querySelector("#create-form").hidden');
  await click('#date-range'); await key('j'); await key('f');
  assert.equal(await evaluate(`Boolean(${overlay})`), false, 'menus keep native keyboard behavior');
  await key('Escape');
  await evaluate('document.activeElement.blur()');
  await evaluate(`import('../ui/confirm-collection.js').then(({confirmCollectionDeletion})=>{confirmCollectionDeletion({id:'vim-confirm-fixture',name:'Fixture'},'Confirmation safety fixture',()=>{document.body.dataset.vimDeleted='yes'})})`);
  await key('j'); await key('f');
  assert.equal(await evaluate(`Boolean(${overlay}) || Boolean(document.body.dataset.vimDeleted)`), false);
  await key('Escape'); await until('!document.querySelector(".collection-delete-dialog")');
  await evaluate('document.activeElement.blur()');
  await evaluate('document.querySelector(".app-nav").hidden=true');
  await key('l'); assert.match(await evaluate('location.pathname'), /library\/library.html$/, 'unavailable navigation has no effect');
  await evaluate('document.querySelector(".app-nav").hidden=false');
  await evaluate('document.querySelector(".app-nav a:last-child").setAttribute("aria-disabled","true")');
  await key('l'); assert.match(await evaluate('location.pathname'), /library\/library.html$/, 'disabled tab has no effect');
  await evaluate('document.querySelector(".app-nav a:last-child").removeAttribute("aria-disabled")');
  await key('l'); await until('location.pathname.endsWith("/authors/authors.html")&&document.querySelector("#count")?.textContent.includes("author")');
  await evaluate(fixture); await evaluate('new Promise(resolve=>setTimeout(resolve,100))'); await key('j'); await until('window.scrollY===80'); await key('g'); await key('g'); await until('window.scrollY===0');
  await key('l'); assert.match(await evaluate('location.pathname'), /authors\/authors.html$/, 'last tab never wraps');
  await key('f'); await until(overlay); await screenshot('vim-following-hints.png'); await key('Escape');
  await evaluate('document.querySelector("#vim-fixture").remove()');
  await key('f'); await until(overlay); await screenshot('vim-following-native-hints.png'); await key('Escape');
  await navigate('author/author.html?name=Alex%20Kim'); await until('document.querySelector("#name")?.textContent==="Alex Kim"&&document.querySelector("#updated")?.textContent.startsWith("Updated")');
  await evaluate(fixture); await evaluate('new Promise(resolve=>setTimeout(resolve,100))'); await key('d'); await until('Math.abs(window.scrollY-innerHeight/2)<=1'); await key('g'); await key('g'); await until('window.scrollY===0');
  await key('l'); assert.match(await evaluate('location.pathname'), /author\/author.html$/, 'Author Results occupies Following');
  await key('f'); await until(overlay); await screenshot('vim-author-hints.png'); await key('Escape');
  await key('h'); await until('location.pathname.endsWith("/library/library.html")&&document.querySelector("#filter")');
  const after = await evaluate(rpc('Promise.all([repo.exportCategory("bookmarks"),repo.exportCategory("following")])'));
  for (const docs of [before,after]) for (const doc of docs) delete doc.exportedAt;
  assert.deepEqual(after,before, 'keyboard navigation never mutates Library/Following/collections');
  await evaluate(rpc('repo.setVimMode(false)'));
  console.log('VIM MODE PASS: local preference/live updates, native scrolling/tab boundaries, hints/new tabs, editing/IME guards and transient UI');
}

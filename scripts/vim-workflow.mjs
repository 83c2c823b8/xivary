import assert from 'node:assert/strict';
import { settingsVimWorkflow } from './settings-vim-workflow.mjs';

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
export async function vimWorkflow({ evaluate, until, key, click, navigate, reload, resize, screenshot, openLink, media, tabNavigation }) {
  const nativeKey = key;
  key = async value => {
    const selectingHint = await evaluate(`Boolean(${overlay})`);
    if(!selectingHint && value==='g') await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await nativeKey(value);
    if (!selectingHint && ['j','k','d','u','g','G'].includes(value)) {
      // Allow native scroll events to settle. Assertions below wait for animated
      // j/k targets separately; hint activation never waits on background frames.
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
  // Rapid native input is sent without the ordinary workflow's settling waits.
  await nativeKey('j'); await nativeKey('j'); await nativeKey('j');
  await until('window.scrollY===240');
  await nativeKey('j'); await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
  const reversal = await evaluate('window.scrollY');
  await nativeKey('k'); await until(`window.scrollY<${reversal}`);
  await evaluate('new Promise(resolve=>setTimeout(resolve,130))');
  await key('g'); await key('g'); await until('window.scrollY===0');
  assert.equal(await evaluate(`(()=>{for(let i=0;i<4;i++)document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'j',repeat:true,bubbles:true,cancelable:true}));return true})()`),true);
  await until('window.scrollY===320');
  await key('g'); await key('g'); await until('window.scrollY===0');
  if(media) {
    await media({ reducedMotion: true }); await until('matchMedia("(prefers-reduced-motion: reduce)").matches');
    await nativeKey('j'); assert.equal(await evaluate('window.scrollY'),80,'reduced motion is immediate');
    await key('g'); await key('g'); await media({ reducedMotion: false });
    await until('!matchMedia("(prefers-reduced-motion: reduce)").matches');
  }
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
  await evaluate("(()=>{history.pushState(null,'','#vim-history-one');history.pushState(null,'','#vim-history-two')})()");
  await key('h'); await until('location.hash==="#vim-history-one"');
  await key('l'); await until('location.hash==="#vim-history-two"');
  await key('l'); assert.equal(await evaluate('location.hash'),'#vim-history-two','no forward history leaves the page unchanged');
  await evaluate("history.replaceState(null,'',location.pathname)");
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');

  const hintFor = async id => {
    return evaluate(`(async()=>{const {hintTargets,hintLabels}=await import('../ui/vim-mode.js');const targets=hintTargets(document,window);return hintLabels(targets.length)[targets.findIndex(node=>node.id===${JSON.stringify(id)})]})()`);
  };
  const choose = async (id, mode='f') => {
    // Closing an F-created tab triggers the source's existing focus refresh.
    // Hint only after that rerender has settled, not while controls are disabled.
    await until('document.hasFocus()&&!document.querySelector("#show-create").disabled');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await until('!document.querySelector("#show-create").disabled');
    await evaluate('document.activeElement.blur()');
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
  const historyBeforeHints=await evaluate('location.href');
  await key('f'); await key('h'); await key('Escape');
  assert.equal(await evaluate('location.href'),historyBeforeHints,'hint h never navigates browser history');
  await key('f'); await key('l');
  assert.equal(await evaluate('location.href'),historyBeforeHints,'hint l never navigates browser history');
  const label = await hintFor('vim-target-0');
  if(media) for(const colorScheme of ['light','dark']) {
    await media({colorScheme}); await until(`matchMedia('(prefers-color-scheme: ${colorScheme})').matches`);
    await key('f'); await until(overlay);
    const plain=await evaluate(`(()=>{const n=document.querySelector('[data-hint="${label}"]'),s=getComputedStyle(n),r=n.getBoundingClientRect();return {background:s.backgroundColor,color:s.color,border:s.borderColor,left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    assert.equal(await evaluate('document.querySelectorAll(".vim-hint-match").length'),0,'default hints stay monochrome');
    await screenshot(`vim-hints-${colorScheme}.png`);
    await key(label[0]);
    const match=await evaluate(`(()=>{const n=document.querySelector('[data-hint="${label}"]'),s=getComputedStyle(n),r=n.getBoundingClientRect();return {background:s.backgroundColor,color:s.color,border:s.borderColor,left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    assert.notEqual(match.background,plain.background);
    assert.deepEqual([match.left,match.top,match.width,match.height],[plain.left,plain.top,plain.width,plain.height],'partial highlighting never shifts labels');
    assert.equal(await evaluate('[...document.querySelectorAll(".vim-hint:not([hidden])")].every(n=>n.classList.contains("vim-hint-match"))'),true);
    await screenshot(`vim-hints-${colorScheme}-partial.png`);
    // Shift+J/K while choosing a hint must only cancel, never switch tabs.
    await key('J'); await until(`!${overlay}`);
    assert.equal(await evaluate('document.querySelectorAll(".vim-hint-match").length'),0);
    await key('f'); await key(label[0]); await key('Escape'); await until(`!${overlay}`);
    assert.equal(await evaluate('document.querySelectorAll(".vim-hint-match").length'),0,'Escape clears all highlighted hints');
  }
  if(media) await media({colorScheme:'light'});
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
  await key('Escape'); assert.equal(await evaluate('document.activeElement.id'),'', 'ordinary input Escape returns to Normal Mode');
  assert.equal(await evaluate('document.querySelector("#vim-edit-input").value'),'j');
  await key('j'); await until('window.scrollY===80'); await key('g'); await key('g');
  await key('g'); await key('i'); assert.equal(await evaluate('document.activeElement.id'),'filter','gi prioritizes the real search over fixture inputs'); await key('j'); await key('Ctrl+[');
  assert.equal(await evaluate('document.querySelector("#filter").value'),'j');
  assert.notEqual(await evaluate('document.activeElement.id'),'filter');
  await key('g');await key('i');assert.equal(await evaluate('document.querySelector("#filter").selectionStart'),1,'gi places a newly focused caret at the end');
  await key('Tab');assert.notEqual(await evaluate('document.activeElement.id'),'filter');
  await key('Shift+Tab');assert.equal(await evaluate('document.activeElement.id'),'filter');await key('Ctrl+[');
  await key('g');await key('Ctrl+[');await key('i');assert.notEqual(await evaluate('document.activeElement.id'),'filter','Ctrl+[ cancels pending g');
  await evaluate('(()=>{document.querySelector("#filter").value="";document.querySelector("#filter").dispatchEvent(new Event("input",{bubbles:true}))})()');
  for (const tag of ['textarea','div']) {
    await click('#vim-edit-'+tag); await key('f');
    assert.equal(await evaluate(`Boolean(${overlay})`), false, `${tag} typing does not show hints`);
    await key('Escape'); assert.notEqual(await evaluate('document.activeElement.id'),'vim-edit-'+tag);
    assert.equal(await evaluate(`document.querySelector('#vim-edit-${tag}').value??document.querySelector('#vim-edit-${tag}').textContent`),'f');
  }
  await click('#vim-edit-input');
  assert.equal(await evaluate(`(()=>{const field=document.activeElement;document.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));const e=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});field.dispatchEvent(e);document.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));return document.activeElement===field&&!e.defaultPrevented})()`),true,'IME Escape keeps editor focus');
  await key('Escape');
  // Exclude preferred/nonwritable fields and focus a genuine rich editor fallback.
  await evaluate(`(()=>{document.querySelector('#filter').disabled=true;document.querySelector('#vim-edit-input').readOnly=true;document.querySelector('#vim-edit-textarea').readOnly=true;const field=document.querySelector('#vim-edit-div');field.innerHTML='<span>日本</span> text';window.vimRichNode=field.firstChild;return true})()`);
  await key('g');await key('i');await until('document.activeElement.id==="vim-edit-div"');
  assert.equal(await evaluate(`(()=>{const field=document.activeElement,selection=getSelection(),range=document.createRange();range.selectNodeContents(field);range.setEnd(selection.anchorNode,selection.anchorOffset);return selection.isCollapsed&&range.toString()===field.textContent&&field.firstChild===window.vimRichNode})()`),true,'rich caret moves to the end without modifying DOM');
  await key('Ctrl+[');assert.equal(await evaluate('document.querySelector("#vim-edit-div").textContent'),'日本 text');
  await evaluate(`(()=>{document.querySelector('#filter').disabled=false;document.querySelector('#vim-edit-input').readOnly=false;document.querySelector('#vim-edit-textarea').readOnly=false;return true})()`);
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
  await settingsVimWorkflow({evaluate,until,key,click,navigate,resize,screenshot});
  await screenshot('vim-settings.png');
  await evaluate('document.querySelector("#vim-mode").scrollIntoView({block:"center"})');
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
  assert.equal(await evaluate(`(()=>{const field=document.activeElement;field.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));field.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));const retained=document.activeElement===field&&!document.querySelector('#create-form').hidden;field.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));return retained})()`),true,'IME Escape keeps creation open');
  await evaluate(`(()=>{window.vimEscapeCalls=0;document.querySelector('#create-form').addEventListener('keydown',e=>{if(e.key==='Escape')window.vimEscapeCalls++});return true})()`);
  await key('Ctrl+['); await until('document.querySelector("#create-form").hidden');
  assert.equal(await evaluate('window.vimEscapeCalls'),1,'Ctrl+[ delivers one component cancellation');
  assert.equal(await evaluate('document.activeElement.id'),'show-create','creation Escape keeps component focus return');
  const rename = await evaluate('[...document.querySelectorAll(".collection-link")].find(n=>n.dataset.collectionId)?.dataset.collectionId');
  if(rename) {
    await evaluate(`document.querySelector('.collection-link[data-collection-id="${rename}"]').focus()`);
    await key('F2'); await until('document.querySelector("[data-rename-id]")');
    const originalName=await evaluate('document.querySelector("[data-rename-id]").value');
    assert.equal(await evaluate(`(()=>{const field=document.activeElement;field.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true,cancelable:true}));return document.activeElement===field&&Boolean(document.querySelector('[data-rename-id]'))})()`),true,'composition-related Escape keeps renaming open');
    await key('j'); await key('Ctrl+['); await until('!document.querySelector("[data-rename-id]")');
    assert.equal(await evaluate('document.activeElement.dataset.collectionId'),rename);
    assert.equal(await evaluate(`document.querySelector('[data-collection-id="${rename}"] .collection-label').textContent`),originalName);
  }
  await click('#date-range'); await key('j'); await key('f');
  assert.equal(await evaluate(`Boolean(${overlay})`), false, 'menus keep native keyboard behavior');
  await key('Escape');
  await evaluate('document.activeElement.blur()');
  await evaluate(`import('../ui/confirm-collection.js').then(({confirmCollectionDeletion})=>{confirmCollectionDeletion({id:'vim-confirm-fixture',name:'Fixture'},'Confirmation safety fixture',()=>{document.body.dataset.vimDeleted='yes'})})`);
  await key('j'); await key('f');
  assert.equal(await evaluate(`Boolean(${overlay}) || Boolean(document.body.dataset.vimDeleted)`), false);
  await key('Ctrl+['); await until('!document.querySelector(".collection-delete-dialog")');
  await evaluate('document.activeElement.blur()');
  // Cross-document back/forward uses actual history, independent of nav order.
  await click('.app-nav a:last-child'); await until('location.pathname.endsWith("/authors/authors.html")&&document.querySelector("#count")?.textContent.includes("author")');
  await evaluate('new Promise(resolve=>setTimeout(resolve,100)).then(()=>document.activeElement.blur())');
  await key('h'); await until('location.pathname.endsWith("/library/library.html")&&document.querySelector("#filter")');
  await evaluate('new Promise(resolve=>setTimeout(resolve,100))'); await key('l');
  await until('location.pathname.endsWith("/authors/authors.html")&&document.querySelector("#count")?.textContent.includes("author")');
  await evaluate(fixture); await evaluate('new Promise(resolve=>setTimeout(resolve,100))'); await key('j'); await until('window.scrollY===80'); await key('g'); await key('g'); await until('window.scrollY===0');

  await key('f'); await until(overlay); await screenshot('vim-following-hints.png'); await key('Ctrl+[');
  await key('g');await key('i');assert.equal(await evaluate('document.activeElement.id'),'filter');await key('Ctrl+[');
  await evaluate('document.querySelector("#vim-fixture").remove()');
  await key('f'); await until(overlay); await screenshot('vim-following-native-hints.png'); await key('Escape');
  await navigate('author/author.html?name=Alex%20Kim'); await until('document.querySelector("#name")?.textContent==="Alex Kim"&&document.querySelector("#updated")?.textContent.startsWith("Updated")');
  await evaluate(fixture); await evaluate('new Promise(resolve=>setTimeout(resolve,100))'); await key('d'); await until('Math.abs(window.scrollY-innerHeight/2)<=1'); await key('g'); await key('g'); await until('window.scrollY===0');

  await key('f'); await until(overlay); await screenshot('vim-author-hints.png'); await key('Escape');
  await navigate('library/library.html'); await until('document.querySelector("#filter")');
  const after = await evaluate(rpc('Promise.all([repo.exportCategory("bookmarks"),repo.exportCategory("following")])'));
  for (const docs of [before,after]) for (const doc of docs) delete doc.exportedAt;
  assert.deepEqual(after,before, 'keyboard navigation never mutates Library/Following/collections');
  if(tabNavigation) await tabNavigation();
  await evaluate(rpc('repo.setVimMode(false)'));
  await until(`(()=>{const event=new KeyboardEvent('keydown',{key:'g',bubbles:true,cancelable:true});document.body.dispatchEvent(event);return !event.defaultPrevented})()`);
  await click('#filter'); await until('document.activeElement.id==="filter"'); await key('Escape');
  assert.equal(await evaluate('document.activeElement.id'),'filter','disabled Vim never blurs editing');
  console.log('VIM MODE PASS: local preference/live updates, animated/reduced scrolling, browser history, partial hint styling, editing Escape/IME and transient UI');
}

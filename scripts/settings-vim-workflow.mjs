import assert from 'node:assert/strict';

/** Native keys on the installed Settings document; no substitute HTML fixture. */
export async function settingsVimWorkflow({evaluate,until,key,click,navigate,resize,screenshot}) {
  await resize(1100,650);
  await navigate('settings/settings.html#keyboard');
  await until('document.querySelector("#vim-mode")?.checked&&!document.querySelector("#latex-macros").disabled');
  await until('document.querySelector(".settings-toc [aria-current]")?.hash==="#keyboard"');
  assert.equal(await evaluate('document.querySelector("#keyboard").getBoundingClientRect().top>=0'),true);
  await navigate('settings/settings.html#latex-macros');
  await until('!document.querySelector("#latex-macros")?.disabled');
  await until('document.querySelector(".settings-toc [aria-current]")?.hash==="#latex-macros"');
  assert.equal(await evaluate('document.querySelector("#macros-heading").getBoundingClientRect().top>=0'),true);
  await evaluate('document.activeElement.blur()');
  await key('g');await key('i');
  await until('document.activeElement.id==="latex-macros"');
  await evaluate(`(()=>{window.vimDraftNode=document.activeElement;document.activeElement.value='\\\\bad-name = x';document.activeElement.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await key('j');
  const draft=await evaluate('document.querySelector("#latex-macros").value');
  for(const escape of ['Escape','Ctrl+[']) {
    await key(escape);assert.notEqual(await evaluate('document.activeElement.id'),'latex-macros');
    assert.equal(await evaluate('document.querySelector("#latex-macros").value'),draft);
    await key('g');await key('i');await until('document.activeElement.id==="latex-macros"');
  }
  await key('Tab');assert.equal(await evaluate('document.activeElement.id'),'save-macros','native focus order includes the Save button');
  await key('Shift+Tab');assert.equal(await evaluate('document.activeElement.id'),'latex-macros');
  await key('Ctrl+[');
  await click('#save-macros');await until('document.querySelector("#macros-status").textContent.length>0');
  const validation=await evaluate('document.querySelector("#macros-status").textContent');
  const history=await evaluate('({length:history.length,url:location.href})');
  await click('.settings-toc a[href="#general"]');await until('window.scrollY<130');
  assert.deepEqual(await evaluate('({length:history.length,url:location.href})'),history,'TOC never rewrites history');
  assert.equal(await evaluate('document.querySelector("#latex-macros")===window.vimDraftNode'),true,'all controls stay mounted');
  assert.equal(await evaluate('document.querySelector("#latex-macros").value'),draft);
  assert.equal(await evaluate('document.querySelector("#macros-status").textContent'),validation);
  await evaluate('document.activeElement.blur()');await key('g');await key('g');await until('window.scrollY===0');
  await key('j');await until('window.scrollY===80');await key('k');await until('window.scrollY===0');
  await key('G');await until('document.querySelector(".settings-toc [aria-current]")?.hash==="#support-xivary"');
  assert.deepEqual(await evaluate('({length:history.length,url:location.href})'),history,'scroll-spy never rewrites history');
  await key('g');await key('g');await until('window.scrollY===0');
  for(const escape of ['Escape','Ctrl+[']) {
    await key('f');await until('document.querySelector("[data-vim-overlay=hints]")');
    assert.equal(await evaluate("import('../ui/vim-mode.js').then(({hintTargets})=>hintTargets(document,window).some(n=>n.matches('label.setting-row')))"),true,'switch labels are hint targets');
    await key(escape);await until('!document.querySelector("[data-vim-overlay=hints]")');
  }
  const toggleHint=await evaluate("import('../ui/vim-mode.js').then(({hintTargets,hintLabels})=>{const targets=hintTargets(document,window);return hintLabels(targets.length)[targets.findIndex(n=>n.matches('label.setting-row')&&n.querySelector('#vim-mode'))]})");
  assert.ok(toggleHint,'Vim switch has a visible hint');
  await key('f');await until('document.querySelector("[data-vim-overlay=hints]")');
  for(const letter of toggleHint)await key(letter);
  await until('!document.querySelector("#vim-mode").checked&&!document.querySelector("#vim-mode").disabled&&!document.querySelector("[data-vim-overlay=hints]")');
  await click('.setting-row:has(#vim-mode)');await until('document.querySelector("#vim-mode").checked&&!document.querySelector("#vim-mode").disabled');
  await evaluate('document.activeElement.blur()');
  assert.equal(await evaluate('document.querySelector("#latex-macros").value'),draft,'hint toggling does not overwrite macro drafts');
  await screenshot('vim-settings-toc.png');
  await resize(360,650);await click('.settings-toc a[href="#latex-macros"]');
  await until('Math.abs(document.querySelector("#latex-macros-section").getBoundingClientRect().top-document.querySelector(".settings-toc").getBoundingClientRect().height-12)<2');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),true,'narrow settings has no horizontal overflow');
  await screenshot('vim-settings-toc-narrow.png');
  assert.equal(await evaluate('document.querySelector("#latex-macros").value'),draft);
  await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
  await key('g');await key('i');await until('document.activeElement.id==="latex-macros"');
  assert.equal(await evaluate(`(()=>{const field=document.activeElement;field.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));for(const extra of [{key:'Escape'},{key:'[',ctrlKey:true},{key:'Escape',keyCode:229}])field.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,...extra}));const focused=document.activeElement===field;field.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));return focused})()`),true,'composition preserves editor focus');
  await key('Ctrl+[');
  await evaluate(`import('../repository/repository-client.js').then(({RepositoryClient})=>new RepositoryClient().setVimMode(false))`);
  await until('!document.querySelector("#vim-mode").checked');
  await evaluate('document.querySelector("#latex-macros").focus()');await key('Ctrl+[');await key('Escape');
  assert.equal(await evaluate('document.activeElement.id'),'latex-macros','disabled Vim leaves editors alone');
  await evaluate('document.activeElement.blur()');const offset=await evaluate('scrollY');
  await key('g');await key('i');await key('j');await key('f');
  assert.equal(await evaluate('document.activeElement.id==="latex-macros"||Boolean(document.querySelector("[data-vim-overlay]"))'),false);
  assert.equal(await evaluate('scrollY'),offset);
  assert.equal(await evaluate('document.querySelector("#latex-macros").value'),draft,'live preferences never overwrite unsaved edits');
  await evaluate(`import('../repository/repository-client.js').then(({RepositoryClient})=>new RepositoryClient().setVimMode(true))`);
  await until('document.querySelector("#vim-mode").checked');
  await resize(1100,850);
  console.log('SETTINGS VIM PASS: installed continuous document, fragments/TOC/scroll-spy, gi/native Tab, Escape/Ctrl+[, drafts/validation, IME, hints, narrow viewport and live disable');
}

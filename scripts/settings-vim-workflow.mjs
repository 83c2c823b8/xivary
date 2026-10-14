import assert from 'node:assert/strict';

/** Native keys on the installed Settings document; no substitute HTML fixture. */
export async function settingsVimWorkflow({evaluate,until,key,click,navigate,resize,screenshot}) {
  // A new hint session must start after a TOC's native smooth scroll finishes;
  // otherwise the engine correctly dismisses it on the next scroll event.
  const settle = () => evaluate(`document.fonts.ready.then(()=>new Promise(resolve=>{
    let last=scrollY,stable=0;
    function frame(){stable=scrollY===last?stable+1:0;last=scrollY;if(stable>=4)resolve();else requestAnimationFrame(frame);}
    requestAnimationFrame(frame);
  }))`);
  const selectHint = async selector => {
    await settle();
    await key('f');await until('document.querySelector("[data-vim-overlay=hints]")');
    const label=await evaluate(`import('../ui/vim-mode.js').then(({hintTargets,hintLabels})=>{const targets=hintTargets(document,window);return hintLabels(targets.length)[targets.indexOf(document.querySelector(${JSON.stringify(selector)}))]})`);
    assert.ok(label,`visible hint for ${selector}`);
    for(const letter of label)await key(letter);
    await until('!document.querySelector("[data-vim-overlay=hints]")');
  };
  const switchGeometry = async () => {
    // Labels can load a font and trigger ResizeObserver after insertion. Geometry
    // must settle even when the optional screenshot helper is disabled.
    await evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
    const geometry=await evaluate(`import('../ui/vim-mode.js').then(({hintTargets,hintLabels})=>{
      const targets=hintTargets(document,window),labels=hintLabels(targets.length);
      return targets.filter(n=>n.matches('input[role="switch"]')).map(n=>{
        const control=n.nextElementSibling.getBoundingClientRect(),hint=document.querySelector('[data-hint="'+labels[targets.indexOf(n)]+'"]').getBoundingClientRect();
        return {id:n.id,gap:control.left-hint.right,dy:Math.abs(hint.top-Math.max(2,Math.min(control.top+(control.height-hint.height)/2,innerHeight-hint.height-2))),
          inside:hint.left>=0&&hint.right<=document.documentElement.clientWidth&&hint.top>=0&&hint.bottom<=innerHeight,
          copies:targets.filter(target=>target===n||target===n.closest('label')).length};
      });
    })`);
    assert.ok(geometry.length>0,'visible Settings switches have hints');
    for(const item of geometry){assert.equal(item.copies,1);assert.ok(item.gap>=3&&item.gap<=5,JSON.stringify(item));assert.ok(item.dy<=1,JSON.stringify(item));assert.equal(item.inside,true);}
  };
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
    await settle();
    await key('f');await until('document.querySelector("[data-vim-overlay=hints]")');
    await screenshot('vim-settings-hints.png');
    await switchGeometry();
    await key(escape);await until('!document.querySelector("[data-vim-overlay=hints]")');
  }
  await resize(360,650);await settle();await key('f');await until('document.querySelector("[data-vim-overlay=hints]")');
  await switchGeometry();
  await screenshot('vim-settings-hints-narrow.png');await key('Escape');await resize(1100,650);await settle();
  const originalSwitch=await evaluate(`(()=>{window.vimSwitchChanges=0;const control=document.querySelector('#open-arxiv-new-tab');control.addEventListener('change',()=>window.vimSwitchChanges++);return control.checked})()`);
  const switchOffset=await evaluate('scrollY');
  await selectHint('#open-arxiv-new-tab');await until('!document.querySelector("#open-arxiv-new-tab").disabled');
  assert.equal(await evaluate('window.vimSwitchChanges'),1,'one hinted activation produces one change');
  assert.equal(await evaluate('document.querySelector("#open-arxiv-new-tab").checked'),!originalSwitch);
  assert.equal(await evaluate('document.activeElement===document.body'),true,'no hidden checkbox focus or async focus restoration');
  assert.equal(await evaluate('scrollY'),switchOffset,'toggle activation never jumps the viewport');
  await key('j');await until(`scrollY===${switchOffset+80}`);await key('k');await until(`scrollY===${switchOffset}`);
  await selectHint('#open-arxiv-new-tab');await until('!document.querySelector("#open-arxiv-new-tab").disabled');
  assert.equal(await evaluate('window.vimSwitchChanges'),2);assert.equal(await evaluate('document.querySelector("#open-arxiv-new-tab").checked'),originalSwitch);
  await evaluate(`(()=>{window.vimModeChanges=0;document.querySelector('#vim-mode').addEventListener('change',()=>window.vimModeChanges++);return true})()`);
  await selectHint('#vim-mode');
  await until('!document.querySelector("#vim-mode").checked&&!document.querySelector("#vim-mode").disabled&&!document.querySelector("[data-vim-overlay=hints]")');
  assert.equal(await evaluate('document.activeElement===document.body'),true);
  assert.equal(await evaluate('window.vimModeChanges'),1,'own-toggle hint changes the setting once');
  await key('f');assert.equal(await evaluate('Boolean(document.querySelector("[data-vim-overlay]"))'),false,'hinting stays disabled after own-toggle activation');
  await click('.setting-row:has(#vim-mode)');await until('document.querySelector("#vim-mode").checked&&!document.querySelector("#vim-mode").disabled');
  await evaluate('document.activeElement.blur()');
  assert.equal(await evaluate('document.querySelector("#latex-macros").value'),draft,'hint toggling does not overwrite macro drafts');
  await screenshot('vim-settings-toc.png');
  await resize(360,650);await click('.settings-toc a[href="#latex-macros"]');
  await until('Math.abs(document.querySelector("#latex-macros-section").getBoundingClientRect().top-document.querySelector(".settings-toc").getBoundingClientRect().height-12)<2');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),true,'narrow settings has no horizontal overflow');
  await screenshot('vim-settings-toc-narrow.png');
  for(const escape of ['Escape','Ctrl+[']) {
    await selectHint('#latex-macros');assert.equal(await evaluate('document.activeElement.id'),'latex-macros');
    await key(escape);assert.equal(await evaluate('document.activeElement===document.body'),true);
    assert.equal(await evaluate('document.querySelector("#latex-macros").value'),draft);
  }
  await selectHint('#save-macros');assert.equal(await evaluate('document.activeElement===document.body'),true,'hinted buttons do not take focus');
  await selectHint('.settings-toc a[href="#general"]');await until('Math.abs(document.querySelector("#general").getBoundingClientRect().top-document.querySelector(".settings-toc").getBoundingClientRect().height-12)<2');
  await selectHint('.settings-toc a[href="#latex-macros"]');
  await until('Math.abs(document.querySelector("#latex-macros-section").getBoundingClientRect().top-document.querySelector(".settings-toc").getBoundingClientRect().height-12)<2');
  await settle();
  assert.equal(await evaluate('document.querySelector("#latex-macros").value'),draft);
  await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
  await key('g');await key('i');await until('document.activeElement.id==="latex-macros"');
  assert.equal(await evaluate(`(()=>{const field=document.activeElement;field.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));for(const extra of [{key:'Escape'},{key:'[',ctrlKey:true},{key:'Escape',keyCode:229}])field.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,...extra}));const focused=document.activeElement===field;field.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));return focused})()`),true,'composition preserves editor focus');
  await key('Ctrl+[');
  await evaluate(`import('../repository/repository-client.js').then(({RepositoryClient})=>new RepositoryClient().setVimMode(false))`);
  await until('!document.querySelector("#vim-mode").checked');
  await evaluate('document.querySelector("#latex-macros").focus()');await key('Ctrl+[');await key('Escape');
  assert.equal(await evaluate('document.activeElement.id'),'latex-macros','disabled Vim leaves editors alone');
  await evaluate('document.activeElement.blur()');await settle();const offset=await evaluate('scrollY');
  await key('g');await key('i');await key('j');await key('f');
  assert.equal(await evaluate('document.activeElement.id==="latex-macros"||Boolean(document.querySelector("[data-vim-overlay]"))'),false);
  assert.equal(await evaluate('scrollY'),offset);
  assert.equal(await evaluate('document.querySelector("#latex-macros").value'),draft,'live preferences never overwrite unsaved edits');
  await evaluate(`import('../repository/repository-client.js').then(({RepositoryClient})=>new RepositoryClient().setVimMode(true))`);
  await until('document.querySelector("#vim-mode").checked');
  await resize(1100,850);
  console.log('SETTINGS VIM PASS: installed continuous document, fragments/TOC/scroll-spy, gi/native Tab, Escape/Ctrl+[, drafts/validation, IME, hints, narrow viewport and live disable');
}
